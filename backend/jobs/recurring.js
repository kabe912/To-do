const cron = require('node-cron');
const pool = require('../config/db');

function calculateNextDue(currentDue, recurring) {
  const d = currentDue ? new Date(currentDue) : new Date();
  if (recurring === 'daily') d.setDate(d.getDate() + 1);
  else if (recurring === 'weekly') d.setDate(d.getDate() + 7);
  else if (recurring === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (recurring === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split('T')[0];
}

async function processRecurring(io) {
  const conn = await pool.getConnection();
  try {
    await conn.query('START TRANSACTION');

    const [todos] = await conn.query(
      `SELECT * FROM todos WHERE recurring IS NOT NULL AND completed = 1 AND next_due_date IS NOT NULL AND next_due_date <= CURDATE() FOR UPDATE`
    );

    for (const todo of todos) {
      const [existing] = await conn.query(
        'SELECT id FROM todos WHERE title = ? AND due_date = ? AND completed = 0 AND recurring IS NOT NULL',
        [todo.title, todo.next_due_date]
      );
      if (existing.length) continue;

      const [maxPos] = await conn.query('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM todos');
      const [result] = await conn.query(
        'INSERT INTO todos (title, description, category, priority, status, due_date, due_time, position, recurring, next_due_date, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [todo.title, todo.description, todo.category, todo.priority, 'pending', todo.next_due_date, todo.due_time || null, maxPos[0].pos, todo.recurring, calculateNextDue(todo.next_due_date, todo.recurring), todo.user_id]
      );

      await conn.query('UPDATE todos SET next_due_date = NULL WHERE id = ?', [todo.id]);

      const [newTodo] = await conn.query('SELECT * FROM todos WHERE id = ?', [result.insertId]);
      if (io && newTodo[0]) io.emit('todo:created', newTodo[0]);
    }

    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    console.error('[recurring] Error:', err.message);
  } finally {
    conn.release();
  }
}

function start(io) {
  cron.schedule('* * * * *', () => processRecurring(io));
  console.log('[recurring] Background job started (every minute)');
}

module.exports = { start, processRecurring, calculateNextDue };
