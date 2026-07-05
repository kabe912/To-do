const express = require('express');
const router = express.Router();
const pool = require('../config/db');

router.get('/', async (req, res, next) => {
  try {
    const { category, priority, search, status, completed, sort } = req.query;
    let sql = 'SELECT * FROM todos WHERE 1=1';
    const params = [];

    if (category) { sql += ' AND category = ?'; params.push(category); }
    if (priority) { sql += ' AND priority = ?'; params.push(priority); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (completed !== undefined) { sql += ' AND completed = ?'; params.push(completed === 'true' ? 1 : 0); }
    if (search) { sql += ' AND (title LIKE ? OR description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    sql += " ORDER BY FIELD(status, 'in_progress', 'pending', 'learned', 'completed'), position ASC, created_at DESC";

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { title, description, category, priority, status, due_date } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const [maxPos] = await pool.query('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM todos');
    const position = maxPos[0].pos;

    const validStatuses = ['pending', 'in_progress', 'completed', 'learned'];
    const todoStatus = validStatuses.includes(status) ? status : 'pending';

    const [result] = await pool.query(
      'INSERT INTO todos (title, description, category, priority, status, due_date, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [title.trim(), description || null, category || null, priority || 'medium', todoStatus, due_date || null, position]
    );

    const [todo] = await pool.query('SELECT * FROM todos WHERE id = ?', [result.insertId]);
    res.status(201).json(todo[0]);
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, category, priority, status, due_date, completed } = req.body;

    const fields = [];
    const params = [];

    if (title !== undefined) { fields.push('title = ?'); params.push(title.trim()); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description); }
    if (category !== undefined) { fields.push('category = ?'); params.push(category); }
    if (priority !== undefined) { fields.push('priority = ?'); params.push(priority); }
    if (status !== undefined) {
      fields.push('status = ?');
      params.push(status);
      const completedVal = (status === 'completed' || status === 'learned') ? 1 : 0;
      fields.push('completed = ?');
      params.push(completedVal);
    }
    if (due_date !== undefined) { fields.push('due_date = ?'); params.push(due_date); }

    if (completed !== undefined && status === undefined) {
      fields.push('completed = ?');
      params.push(completed ? 1 : 0);
      if (!completed) {
        fields.push("status = 'pending'");
      } else {
        fields.push("status = 'completed'");
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    await pool.query(`UPDATE todos SET ${fields.join(', ')} WHERE id = ?`, params);

    const [todo] = await pool.query('SELECT * FROM todos WHERE id = ?', [id]);
    if (!todo[0]) return res.status(404).json({ error: 'Todo not found' });
    res.json(todo[0]);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query('DELETE FROM todos WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Todo not found' });
    res.json({ message: 'Todo deleted' });
  } catch (err) { next(err); }
});

router.patch('/:id/toggle', async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query(`
      UPDATE todos
      SET completed = NOT completed,
          status = CASE WHEN completed = 1 THEN 'pending' ELSE 'completed' END
      WHERE id = ?
    `, [id]);
    const [todo] = await pool.query('SELECT * FROM todos WHERE id = ?', [id]);
    if (!todo[0]) return res.status(404).json({ error: 'Todo not found' });
    res.json(todo[0]);
  } catch (err) { next(err); }
});

router.patch('/reorder', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });

    for (let i = 0; i < ids.length; i++) {
      await pool.query('UPDATE todos SET position = ? WHERE id = ?', [i, ids[i]]);
    }
    res.json({ message: 'Reordered' });
  } catch (err) { next(err); }
});

router.get('/stats', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        COUNT(*) AS total,
        SUM(status = 'pending') AS pending,
        SUM(status = 'in_progress') AS in_progress,
        SUM(status = 'completed') AS completed,
        SUM(status = 'learned') AS learned,
        COUNT(DISTINCT category) AS categories
      FROM todos
    `);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
