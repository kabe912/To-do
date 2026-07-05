require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./backend/config/db');
const errorHandler = require('./backend/middleware/errorHandler');
const todosRouter = require('./backend/routes/todos');
const sharesRouter = require('./backend/routes/shares');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/todos', todosRouter);
app.use('/api/share', sharesRouter);

app.get('/share/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(errorHandler);

async function migrate() {
  try {
    const conn = await pool.getConnection();
    await conn.query('ALTER TABLE todos ADD COLUMN IF NOT EXISTS parent_id INT DEFAULT NULL');
    await conn.query('ALTER TABLE todos ADD COLUMN IF NOT EXISTS recurring VARCHAR(50) DEFAULT NULL');
    await conn.query(`CREATE TABLE IF NOT EXISTS tags (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE)`);
    await conn.query(`CREATE TABLE IF NOT EXISTS todo_tags (todo_id INT NOT NULL, tag_id INT NOT NULL, PRIMARY KEY (todo_id, tag_id), FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE, FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE)`);
    await conn.query(`CREATE TABLE IF NOT EXISTS time_logs (id INT AUTO_INCREMENT PRIMARY KEY, todo_id INT NOT NULL, start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, end_time TIMESTAMP NULL DEFAULT NULL, duration INT DEFAULT NULL, FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE)`);
    console.log('Migration: tables ready');
    conn.release();
  } catch (err) {
    console.error('Migration failed:', err.message);
  }
}

migrate().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
