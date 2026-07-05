const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sslCaPath = process.env.SSL_CA;
const sslConfig = sslCaPath && fs.existsSync(path.resolve(sslCaPath))
  ? { ca: fs.readFileSync(path.resolve(sslCaPath)) }
  : undefined;

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'web_terminal',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: sslConfig,
});

pool.getConnection()
  .then(conn => {
    console.log('MySQL connected successfully');
    conn.release();
  })
  .catch(err => {
    console.error('MySQL connection failed:', err.message);
  });

module.exports = pool;
