const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

router.post('/', async (req, res, next) => {
  try {
    const { todo_ids, password, expires_in_days } = req.body;

    let todoIds = todo_ids;
    if (!todoIds) {
      const [todos] = await pool.query('SELECT id FROM todos');
      todoIds = todos.map(t => t.id);
    }

    const token = uuidv4().replace(/-/g, '');
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;
    let expiresAt = null;
    if (expires_in_days) {
      const date = new Date();
      date.setDate(date.getDate() + parseInt(expires_in_days));
      expiresAt = date;
    }

    await pool.query(
      'INSERT INTO shared_links (token, todo_ids, password, expires_at) VALUES (?, ?, ?, ?)',
      [token, JSON.stringify(todoIds), hashedPassword, expiresAt]
    );

    res.status(201).json({
      token,
      url: `${req.protocol}://${req.get('host')}/share/${token}`,
    });
  } catch (err) { next(err); }
});

router.get('/:token', async (req, res, next) => {
  try {
    const [links] = await pool.query('SELECT * FROM shared_links WHERE token = ?', [req.params.token]);

    if (links.length === 0) return res.status(404).json({ error: 'Share link not found' });

    const link = links[0];

    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    const todoIds = JSON.parse(link.todo_ids);

    const placeholders = todoIds.map(() => '?').join(',');
    const [todos] = await pool.query(
      `SELECT id, title, description, category, priority, status, due_date, completed, created_at FROM todos WHERE id IN (${placeholders}) ORDER BY FIELD(id, ${placeholders})`,
      [...todoIds, ...todoIds]
    );

    res.json({
      has_password: !!link.password,
      todos: link.password ? [] : todos,
      protected: !!link.password,
    });
  } catch (err) { next(err); }
});

router.post('/:token/verify', async (req, res, next) => {
  try {
    const { password } = req.body;
    const [links] = await pool.query('SELECT * FROM shared_links WHERE token = ?', [req.params.token]);

    if (links.length === 0) return res.status(404).json({ error: 'Share link not found' });

    const link = links[0];

    if (!link.password) {
      return res.status(400).json({ error: 'This link is not password protected' });
    }

    const valid = await bcrypt.compare(password, link.password);
    if (!valid) return res.status(403).json({ error: 'Invalid password' });

    const todoIds = JSON.parse(link.todo_ids);

    const placeholders = todoIds.map(() => '?').join(',');
    const [todos] = await pool.query(
      `SELECT id, title, description, category, priority, status, due_date, completed, created_at FROM todos WHERE id IN (${placeholders}) ORDER BY FIELD(id, ${placeholders})`,
      [...todoIds, ...todoIds]
    );

    res.json({ todos });
  } catch (err) { next(err); }
});

module.exports = router;
