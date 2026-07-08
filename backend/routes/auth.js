const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { JWT_SECRET, requireAuth } = require('../middleware/auth');

router.post('/register', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const u = username.trim().toLowerCase();
    if (u.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

    const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [u]);
    if (existing.length) return res.status(409).json({ error: 'Username already exists' });

    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', [u, hash]);

    const token = jwt.sign({ userId: result.insertId, username: u }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: { id: result.insertId, username: u } });
  } catch (err) { next(err); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const u = username.trim().toLowerCase();

    const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [u]);
    if (!users.length) return res.status(401).json({ error: 'Invalid username or password' });

    const valid = await bcrypt.compare(password, users[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

    const token = jwt.sign({ userId: users[0].id, username: users[0].username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: users[0].id, username: users[0].username } });
  } catch (err) { next(err); }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [users] = await pool.query('SELECT id, username, created_at FROM users WHERE id = ?', [req.userId]);
    if (!users.length) return res.status(404).json({ error: 'User not found' });
    res.json(users[0]);
  } catch (err) { next(err); }
});

module.exports = router;
