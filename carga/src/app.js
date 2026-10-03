const path = require('path');
const express = require('express');

const pool = require('./config/db');
const impoRoutes = require('./routes/impo.routes');
const { requireAuth } = require('./middlewares/auth');
const { notFound, errorHandler } = require('./middlewares/errors');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Chequeo rápido de que la API y la base responden
app.get('/api/health', async (req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'conectada' });
  } catch (err) {
    next(err);
  }
});

// Importación: requireAuth no hace nada mientras AUTH_ENABLED=false
app.use('/api/impo', requireAuth, impoRoutes);

app.use('/api', notFound);
app.use(errorHandler);

module.exports = app;
