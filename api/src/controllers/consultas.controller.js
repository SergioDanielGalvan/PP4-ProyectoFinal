const model = require('../models/consultas.model');

const handler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// GET /api/consultas -> catálogo de consultas guardadas con sus parámetros
const listar = handler(async (req, res) => {
  res.json(model.listarGuardadas());
});

// GET /api/consultas/:nombre?periodo=202608&limite=20
const ejecutar = handler(async (req, res) => {
  res.json(await model.ejecutarGuardada(req.params.nombre, req.query));
});

// POST /api/consultas/sql  { "sql": "SELECT ...", "limite": 1000 }  (sólo admin)
const sqlLibre = handler(async (req, res) => {
  const limite = Number.parseInt(req.body?.limite, 10);
  const resultado = await model.ejecutarLibre(req.body?.sql, Number.isInteger(limite) && limite > 0 ? limite : undefined);
  console.log(`[SQL libre] ${req.usuario.usuario}: ${String(req.body.sql).replace(/\s+/g, ' ').slice(0, 300)}`);
  res.json(resultado);
});

module.exports = { listar, ejecutar, sqlLibre };
