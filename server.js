require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const pool = require('./backend/config/db');
const errorHandler = require('./backend/middleware/errorHandler');
const todosRouter = require('./backend/routes/todos');
const sharesRouter = require('./backend/routes/shares');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : undefined;
app.use(cors(allowedOrigins ? { origin: allowedOrigins } : {}));
app.use(compression());
app.use(express.json());

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use('/api', globalLimiter);

const shareVerifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts, try again later' } });
app.use('/api/share', shareVerifyLimiter);

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));

app.use('/api/todos', todosRouter);
app.use('/api/share', sharesRouter);

app.get('/share/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(errorHandler);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: allowedOrigins || '*' } });
app.set('io', io);

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

async function migrate() {
  try {
    const conn = await pool.getConnection();
    const tryAlter = async (sql) => { try { await conn.query(sql); } catch(e) { if (!e.message.includes('Duplicate column')) console.error('  ALTER error:', e.message); } };
    await tryAlter('ALTER TABLE todos ADD COLUMN parent_id INT DEFAULT NULL');
    await tryAlter('ALTER TABLE todos ADD COLUMN recurring VARCHAR(50) DEFAULT NULL');
    await conn.query(`CREATE TABLE IF NOT EXISTS tags (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE)`);
    await conn.query(`CREATE TABLE IF NOT EXISTS todo_tags (todo_id INT NOT NULL, tag_id INT NOT NULL, PRIMARY KEY (todo_id, tag_id), FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE, FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE)`);
    await conn.query(`CREATE TABLE IF NOT EXISTS time_logs (id INT AUTO_INCREMENT PRIMARY KEY, todo_id INT NOT NULL, start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, end_time TIMESTAMP NULL DEFAULT NULL, duration INT DEFAULT NULL, FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE)`);
    await conn.query(`CREATE TABLE IF NOT EXISTS shared_links (id INT AUTO_INCREMENT PRIMARY KEY, token VARCHAR(64) UNIQUE NOT NULL, todo_ids TEXT NOT NULL, password VARCHAR(255) DEFAULT NULL, expires_at TIMESTAMP NULL DEFAULT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    const tryIndex = async (sql) => { try { await conn.query(sql); } catch(e) { if (!e.message.includes('Duplicate key name')) console.error('  INDEX error:', e.message); } };
    await tryIndex('CREATE INDEX idx_todos_category ON todos(category)');
    await tryIndex('CREATE INDEX idx_todos_priority ON todos(priority)');
    await tryIndex('CREATE INDEX idx_todos_status ON todos(status)');
    await tryIndex('CREATE INDEX idx_todos_completed ON todos(completed)');
    await tryIndex('CREATE INDEX idx_todos_due_date ON todos(due_date)');
    await tryIndex('CREATE INDEX idx_todos_parent_id ON todos(parent_id)');
    await tryIndex('CREATE INDEX idx_time_logs_todo_end ON time_logs(todo_id, end_time)');
    console.log('Migration: tables ready');
    conn.release();
  } catch (err) {
    console.error('Migration failed:', err.message);
  }
}

migrate().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
