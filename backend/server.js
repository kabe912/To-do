require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const errorHandler = require('./middleware/errorHandler');
const todosRouter = require('./routes/todos');
const sharesRouter = require('./routes/shares');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/todos', todosRouter);
app.use('/api/share', sharesRouter);

app.get('/share/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'share.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
