function errorHandler(err, req, res, next) {
  console.error(err.stack);
  const message = process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message || 'Internal Server Error';
  res.status(err.status || 500).json({ error: message });
}

module.exports = errorHandler;
