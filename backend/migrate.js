require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const sslCaPath = process.env.SSL_CA;
const sslConfig = sslCaPath && fs.existsSync(path.resolve(sslCaPath))
  ? { ca: fs.readFileSync(path.resolve(sslCaPath)) }
  : undefined;

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: sslConfig,
});

async function migrate() {
  const conn = await pool.getConnection();
  try {
    console.log('Connected. Running migration...');

    const tryAlter = async (sql) => { try { await conn.query(sql); } catch(e) { if (!e.message.includes('Duplicate column')) console.error('  ALTER error:', e.message); } };
    await tryAlter('ALTER TABLE todos ADD COLUMN parent_id INT DEFAULT NULL');
    await tryAlter('ALTER TABLE todos ADD COLUMN recurring VARCHAR(50) DEFAULT NULL');
    console.log('  Added parent_id, recurring to todos');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS tags (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS todo_tags (
        todo_id INT NOT NULL,
        tag_id INT NOT NULL,
        PRIMARY KEY (todo_id, tag_id),
        FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS time_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        todo_id INT NOT NULL,
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP NULL DEFAULT NULL,
        duration INT DEFAULT NULL,
        FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE
      )
    `);
    console.log('  Created tags, todo_tags, time_logs tables');
    console.log('Migration complete!');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    conn.release();
    await pool.end();
  }
}

migrate();
