const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'web-terminal-secret-dev';

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Use "login <username> <password>" or "register <username> <password>"' });
  }
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token. Please login again.' });
  }
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const token = header.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      req.userId = decoded.userId;
      req.username = decoded.username;
    } catch (err) {
      // Token invalid, continue without auth
    }
  }
  next();
}

module.exports = { requireAuth, optionalAuth, JWT_SECRET };
