const path = require('path');
const express = require('express');

const pool = require('./config/db');
const impoRoutes = require('./routes/impo.routes');
const authRoutes = require('./routes/auth.routes');
const consultasRoutes = require('./routes/consultas.routes');
const { requireAuth } = require('./middlewares/auth');
const { notFound, errorHandler } = require('./middlewares/errors');
const { auditar } = require('./middlewares/auditoria');
const auditoriaRoutes = require('./routes/auditoria.routes');

const app = express();

// Detrás del proxy de Render: req.ip es la IP real del cliente (freno de intentos de login)
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// La raíz lleva a la página de consulta
app.get('/', (req, res) => res.redirect('/impo.html'));

// Auditoría: registra cada pedido a /api después de responder (ver middlewares/auditoria.js)
app.use('/api', auditar);

// Chequeo rápido de que la API y la base responden
app.get('/api/health', async (req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'conectada' });
  } catch (err) {
    next(err);
  }
});

// Login y administración de usuarios (JWT)
app.use('/api/auth', authRoutes);

// Importación: requireAuth no hace nada mientras AUTH_ENABLED=false
app.use('/api/impo', requireAuth, impoRoutes);

// Consultas SQL guardadas y SQL libre (este último, sólo admin)
app.use('/api/consultas', consultasRoutes);

// Actividad de los usuarios (sólo admin)
app.use('/api/auditoria', auditoriaRoutes);

app.use('/api', notFound);
app.use(errorHandler);

module.exports = app;
