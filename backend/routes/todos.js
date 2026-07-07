const express = require('express');
const router = express.Router();
const pool = require('../config/db');

router.get('/', async (req, res, next) => {
  try {
    const { category, priority, search, status, completed, sort, due_soon } = req.query;
    let sql = 'SELECT * FROM todos WHERE 1=1';
    const params = [];

    if (category) { sql += ' AND category = ?'; params.push(category); }
    if (priority) { sql += ' AND priority = ?'; params.push(priority); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (completed !== undefined) { sql += ' AND completed = ?'; params.push(completed === 'true' ? 1 : 0); }
    if (search) { sql += ' AND (title LIKE ? OR description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (due_soon) {
      const days = parseInt(due_soon) || 3;
      sql += ' AND due_date IS NOT NULL AND due_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY) AND completed = 0';
      params.push(days);
    }

    if (sort === 'due') sql += ' ORDER BY due_date ASC, priority DESC';
    else if (sort === 'priority') sql += ' ORDER BY FIELD(priority, "high", "medium", "low"), due_date ASC';
    else if (sort === 'created') sql += ' ORDER BY created_at DESC';
    else sql += " ORDER BY FIELD(status, 'in_progress', 'pending', 'learned', 'completed'), position ASC, created_at DESC";

    const [rows] = await pool.query(sql, params);

    // Fetch tags separately to avoid MySQL 5.7 GROUP_CONCAT issues
    if (rows.length) {
      const ids = rows.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      const [tagRows] = await pool.query(
        `SELECT tt.todo_id, t.name FROM todo_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.todo_id IN (${placeholders}) ORDER BY t.name`,
        ids
      );
      const tagMap = {};
      tagRows.forEach(r => { if (!tagMap[r.todo_id]) tagMap[r.todo_id] = []; tagMap[r.todo_id].push(r.name); });
      rows.forEach(r => { r.tags = tagMap[r.id] || []; });
    } else {
      rows.forEach(r => { r.tags = []; });
    }

    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { title, description, category, priority, status, due_date, parent_id, recurring } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const [maxPos] = await pool.query('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM todos');
    const position = maxPos[0].pos;

    const validStatuses = ['pending', 'in_progress', 'completed', 'learned'];
    const todoStatus = validStatuses.includes(status) ? status : 'pending';

    const [result] = await pool.query(
      'INSERT INTO todos (title, description, category, priority, status, due_date, position, parent_id, recurring) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [title.trim(), description || null, category || null, priority || 'medium', todoStatus, due_date || null, position, parent_id || null, recurring || null]
    );

    const [todo] = await pool.query('SELECT * FROM todos WHERE id = ?', [result.insertId]);
    res.status(201).json(todo[0]);
  } catch (err) { next(err); }
});

router.get('/tags/list', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM tags ORDER BY name');
    res.json(rows);
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

router.get('/:id', async (req, res, next) => {
  try {
    const [todos] = await pool.query('SELECT * FROM todos WHERE id = ?', [req.params.id]);
    if (!todos[0]) return res.status(404).json({ error: 'Todo not found' });
    const [subtasks] = await pool.query('SELECT id, title, status, completed FROM todos WHERE parent_id = ?', [req.params.id]);
    todos[0].subtasks = subtasks;
    res.json(todos[0]);
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, category, priority, status, due_date, completed, parent_id, recurring } = req.body;

    const validStatuses = ['pending', 'in_progress', 'completed', 'learned'];
    const validPriorities = ['low', 'medium', 'high'];
    if (status !== undefined && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be: pending, in_progress, completed, or learned' });
    }
    if (priority !== undefined && !validPriorities.includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority. Must be: low, medium, or high' });
    }

    const fields = [];
    const params = [];

    if (title !== undefined) { fields.push('title = ?'); params.push(title.trim()); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description); }
    if (category !== undefined) { fields.push('category = ?'); params.push(category); }
    if (priority !== undefined) { fields.push('priority = ?'); params.push(priority); }
    if (parent_id !== undefined) { fields.push('parent_id = ?'); params.push(parent_id); }
    if (recurring !== undefined) { fields.push('recurring = ?'); params.push(recurring); }
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
      fields.push(completed ? "status = 'completed'" : "status = 'pending'");
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
    await pool.query('UPDATE todos SET parent_id = NULL WHERE parent_id = ?', [id]);
    await pool.query('DELETE FROM todo_tags WHERE todo_id = ?', [id]);
    await pool.query('DELETE FROM time_logs WHERE todo_id = ?', [id]);
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

router.patch('/:id/complete', async (req, res, next) => {
  try {
    const { id } = req.params;
    const [todo] = await pool.query('SELECT * FROM todos WHERE id = ?', [id]);
    if (!todo[0]) return res.status(404).json({ error: 'Todo not found' });

    await pool.query('UPDATE todos SET status = "completed", completed = 1 WHERE id = ?', [id]);

    let newTodo = null;
    if (todo[0].recurring) {
      const recurring = todo[0].recurring;
      let nextDue = null;
      const due = todo[0].due_date ? new Date(todo[0].due_date) : new Date();
      if (recurring === 'daily') due.setDate(due.getDate() + 1);
      else if (recurring === 'weekly') due.setDate(due.getDate() + 7);
      else if (recurring === 'monthly') due.setMonth(due.getMonth() + 1);
      else if (recurring === 'yearly') due.setFullYear(due.getFullYear() + 1);
      nextDue = due.toISOString().split('T')[0];

      const [maxPos] = await pool.query('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM todos');
      const [result] = await pool.query(
        'INSERT INTO todos (title, description, category, priority, status, due_date, position, recurring) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [todo[0].title, todo[0].description, todo[0].category, todo[0].priority, 'pending', nextDue, maxPos[0].pos, recurring]
      );
      const [nt] = await pool.query('SELECT * FROM todos WHERE id = ?', [result.insertId]);
      newTodo = nt[0];
    }

    const [updated] = await pool.query('SELECT * FROM todos WHERE id = ?', [id]);
    res.json({ todo: updated[0], recurring: newTodo });
  } catch (err) { next(err); }
});

router.post('/:id/tags', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Tag name required' });

    const [existing] = await pool.query('SELECT id FROM tags WHERE name = ?', [name.trim()]);
    let tagId;
    if (existing.length) {
      tagId = existing[0].id;
    } else {
      const [r] = await pool.query('INSERT INTO tags (name) VALUES (?)', [name.trim()]);
      tagId = r.insertId;
    }

    await pool.query('INSERT IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)', [id, tagId]);
    res.json({ message: 'Tag added' });
  } catch (err) { next(err); }
});

router.delete('/:id/tags/:name', async (req, res, next) => {
  try {
    await pool.query(
      'DELETE tt FROM todo_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.todo_id = ? AND t.name = ?',
      [req.params.id, req.params.name]
    );
    res.json({ message: 'Tag removed' });
  } catch (err) { next(err); }
});

router.post('/:id/time/start', async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE time_logs SET end_time = CURRENT_TIMESTAMP, duration = TIMESTAMPDIFF(SECOND, start_time, CURRENT_TIMESTAMP) WHERE todo_id = ? AND end_time IS NULL', [id]);
    const [r] = await pool.query('INSERT INTO time_logs (todo_id) VALUES (?)', [id]);
    const [log] = await pool.query('SELECT * FROM time_logs WHERE id = ?', [r.insertId]);
    res.status(201).json(log[0]);
  } catch (err) { next(err); }
});

router.put('/:id/time/stop', async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE time_logs SET end_time = CURRENT_TIMESTAMP, duration = TIMESTAMPDIFF(SECOND, start_time, CURRENT_TIMESTAMP) WHERE todo_id = ? AND end_time IS NULL', [id]);
    const [logs] = await pool.query('SELECT * FROM time_logs WHERE todo_id = ? ORDER BY start_time DESC', [id]);
    res.json(logs);
  } catch (err) { next(err); }
});

router.get('/:id/time', async (req, res, next) => {
  try {
    const [logs] = await pool.query('SELECT * FROM time_logs WHERE todo_id = ? ORDER BY start_time DESC', [req.params.id]);
    const [total] = await pool.query('SELECT COALESCE(SUM(duration), 0) AS total FROM time_logs WHERE todo_id = ?', [req.params.id]);
    res.json({ logs, total_seconds: total[0].total });
  } catch (err) { next(err); }
});

module.exports = router;
