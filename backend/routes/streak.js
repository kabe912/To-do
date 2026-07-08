const express = require('express');
const router = express.Router();
const pool = require('../config/db');

async function updateStreak(userId) {
  const today = new Date().toISOString().split('T')[0];
  const [rows] = await pool.query('SELECT * FROM user_streaks WHERE user_id = ?', [userId]);

  if (rows.length) {
    const streak = rows[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    let newStreak;
    if (streak.last_active_date === today) {
      return streak;
    } else if (streak.last_active_date === yesterday) {
      newStreak = streak.current_streak + 1;
    } else {
      newStreak = 1;
    }

    const longest = Math.max(newStreak, streak.longest_streak);
    await pool.query(
      'UPDATE user_streaks SET current_streak = ?, longest_streak = ?, last_active_date = ? WHERE user_id = ?',
      [newStreak, longest, today, userId]
    );
    return { current_streak: newStreak, longest_streak: longest, last_active_date: today };
  } else {
    await pool.query(
      'INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_active_date) VALUES (?, 1, 1, ?)',
      [userId, today]
    );
    return { current_streak: 1, longest_streak: 1, last_active_date: today };
  }
}

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM user_streaks WHERE user_id = ?', [req.userId]);
    if (!rows.length) {
      return res.json({ current_streak: 0, longest_streak: 0, last_active_date: null });
    }
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = { router, updateStreak };
