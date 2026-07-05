CREATE DATABASE IF NOT EXISTS web_terminal;
USE web_terminal;

CREATE TABLE IF NOT EXISTS todos (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  description TEXT,
  category    VARCHAR(100) DEFAULT NULL,
  priority    ENUM('low','medium','high') DEFAULT 'medium',
  status      ENUM('pending','in_progress','completed','learned') NOT NULL DEFAULT 'pending',
  due_date    DATE DEFAULT NULL,
  completed   BOOLEAN DEFAULT FALSE,
  position    INT DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shared_links (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  token      VARCHAR(64) UNIQUE NOT NULL,
  todo_ids   TEXT NOT NULL,
  password   VARCHAR(255) DEFAULT NULL,
  expires_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
