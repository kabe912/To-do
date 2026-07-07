const express = require('express');
const router = express.Router();
const pool = require('../config/db');

function logAction(sessionId, type, todoId, before, after) {
  return pool.query(
    'INSERT INTO action_history (session_id, action_type, todo_id, before_state, after_state) VALUES (?, ?, ?, ?, ?)',
    [sessionId, type, todoId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]
  );
}

router.post('/log', async (req, res, next) => {
  try {
    const { session_id, action_type, todo_id, before_state, after_state } = req.body;
    if (!session_id || !action_type || !todo_id) return res.status(400).json({ error: 'session_id, action_type, todo_id required' });
    await logAction(session_id, action_type, todo_id, before_state, after_state);
    res.status(201).json({ message: 'Logged' });
  } catch (err) { next(err); }
});

router.post('/undo', async (req, res, next) => {
  try {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });

    const [actions] = await pool.query(
      'SELECT * FROM action_history WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
      [session_id]
    );
    if (!actions.length) return res.json({ undone: null });

    const action = actions[0];
    const before = action.before_state ? (typeof action.before_state === 'string' ? JSON.parse(action.before_state) : action.before_state) : null;

    let result = null;
    if (action.action_type === 'create') {
      await pool.query('DELETE FROM todo_tags WHERE todo_id = ?', [action.todo_id]);
      await pool.query('DELETE FROM time_logs WHERE todo_id = ?', [action.todo_id]);
      await pool.query('DELETE FROM todo_dependencies WHERE todo_id = ? OR depends_on_id = ?', [action.todo_id, action.todo_id]);
      await pool.query('DELETE FROM todos WHERE id = ?', [action.todo_id]);
      req.app.get('io').emit('todo:deleted', { id: action.todo_id });
      result = { type: 'create', id: action.todo_id };
    } else if (action.action_type === 'delete' && before) {
      const [maxPos] = await pool.query('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM todos');
      await pool.query(
        'INSERT INTO todos (id, title, description, category, priority, status, due_date, due_time, completed, position, parent_id, recurring, next_due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [before.id, before.title, before.description, before.category, before.priority, before.status, before.due_date, before.due_time, before.completed, maxPos[0].pos, before.parent_id, before.recurring, before.next_due_date]
      );
      const [todo] = await pool.query('SELECT * FROM todos WHERE id = ?', [before.id]);
      if (todo[0]) req.app.get('io').emit('todo:created', todo[0]);
      result = { type: 'delete', todo: before };
    } else if ((action.action_type === 'update' || action.action_type === 'status_change') && before) {
      const fields = [];
      const params = [];
      if (before.title !== undefined) { fields.push('title = ?'); params.push(before.title); }
      if (before.description !== undefined) { fields.push('description = ?'); params.push(before.description); }
      if (before.category !== undefined) { fields.push('category = ?'); params.push(before.category); }
      if (before.priority !== undefined) { fields.push('priority = ?'); params.push(before.priority); }
      if (before.status !== undefined) { fields.push('status = ?'); params.push(before.status); }
      if (before.completed !== undefined) { fields.push('completed = ?'); params.push(before.completed); }
      if (before.due_date !== undefined) { fields.push('due_date = ?'); params.push(before.due_date); }
      if (before.due_time !== undefined) { fields.push('due_time = ?'); params.push(before.due_time); }
      if (fields.length) {
        params.push(action.todo_id);
        await pool.query(`UPDATE todos SET ${fields.join(', ')} WHERE id = ?`, params);
      }
      const [todo] = await pool.query('SELECT * FROM todos WHERE id = ?', [action.todo_id]);
      if (todo[0]) req.app.get('io').emit('todo:updated', todo[0]);
      result = { type: action.action_type, todo: before };
    }

    await pool.query('DELETE FROM action_history WHERE id = ?', [action.id]);
    res.json({ undone: result });
  } catch (err) { next(err); }
});

router.post('/redo', async (req, res, next) => {
  try {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });

    const [actions] = await pool.query(
      'SELECT * FROM action_history WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
      [session_id]
    );
    if (!actions.length) return res.json({ redone: null });

    const action = actions[0];
    const after = action.after_state ? (typeof action.after_state === 'string' ? JSON.parse(action.after_state) : action.after_state) : null;

    let result = null;
    if (action.action_type === 'delete') {
      await pool.query('DELETE FROM todo_tags WHERE todo_id = ?', [action.todo_id]);
      await pool.query('DELETE FROM time_logs WHERE todo_id = ?', [action.todo_id]);
      await pool.query('DELETE FROM todo_dependencies WHERE todo_id = ? OR depends_on_id = ?', [action.todo_id, action.todo_id]);
      await pool.query('DELETE FROM todos WHERE id = ?', [action.todo_id]);
      req.app.get('io').emit('todo:deleted', { id: action.todo_id });
      result = { type: 'delete', id: action.todo_id };
    } else if (action.action_type === 'create') {
      const [maxPos] = await pool.query('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM todos');
      await pool.query(
        'INSERT INTO todos (id, title, description, category, priority, status, due_date, due_time, completed, position, parent_id, recurring, next_due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [after.id, after.title, after.description, after.category, after.priority, after.status, after.due_date, after.due_time, after.completed, maxPos[0].pos, after.parent_id, after.recurring, after.next_due_date]
      );
      const [todo] = await pool.query('SELECT * FROM todos WHERE id = ?', [after.id]);
      if (todo[0]) req.app.get('io').emit('todo:created', todo[0]);
      result = { type: 'create', todo: after };
    } else if ((action.action_type === 'update' || action.action_type === 'status_change') && after) {
      const fields = [];
      const params = [];
      if (after.title !== undefined) { fields.push('title = ?'); params.push(after.title); }
      if (after.description !== undefined) { fields.push('description = ?'); params.push(after.description); }
      if (after.category !== undefined) { fields.push('category = ?'); params.push(after.category); }
      if (after.priority !== undefined) { fields.push('priority = ?'); params.push(after.priority); }
      if (after.status !== undefined) { fields.push('status = ?'); params.push(after.status); }
      if (after.completed !== undefined) { fields.push('completed = ?'); params.push(after.completed); }
      if (after.due_date !== undefined) { fields.push('due_date = ?'); params.push(after.due_date); }
      if (fields.length) {
        params.push(action.todo_id);
        await pool.query(`UPDATE todos SET ${fields.join(', ')} WHERE id = ?`, params);
      }
      const [todo] = await pool.query('SELECT * FROM todos WHERE id = ?', [action.todo_id]);
      if (todo[0]) req.app.get('io').emit('todo:updated', todo[0]);
      result = { type: action.action_type, todo: after };
    }

    await pool.query('DELETE FROM action_history WHERE id = ?', [action.id]);
    res.json({ redone: result });
  } catch (err) { next(err); }
});

router.get('/history', async (req, res, next) => {
  try {
    const { session_id, limit } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    const max = Math.min(parseInt(limit) || 20, 100);
    const [rows] = await pool.query(
      'SELECT id, action_type, todo_id, created_at FROM action_history WHERE session_id = ? ORDER BY created_at DESC LIMIT ?',
      [session_id, max]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.logAction = logAction;
