// Administración de períodos (sólo administradores): ver qué hay cargado por mes
// y borrar un mes completo o sólo su liquidación. Ver services/borrarPeriodo.js.
const pool = require('../config/db');
const model = require('../models/impo.model');
const borrado = require('../services/borrarPeriodo');
const { verificarClavePropia } = require('./auth.controller');
const { HttpError } = require('../middlewares/errors');

const handler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const ALCANCES = { liq: 'sólo la liquidación', todo: 'el período completo' };

function periodoValido(v) {
  const s = String(v ?? '');
  if (!/^\d{6}$/.test(s) || Number(s.slice(4)) < 1 || Number(s.slice(4)) > 12) {
    throw new HttpError(400, 'El período va con formato AAAAMM, por ejemplo 202607.');
  }
  return Number(s);
}

// GET /api/periodos: cantidades por mes y el último borrado (en curso o terminado)
const listar = handler(async (req, res) => {
  res.json({ periodos: await model.resumenPeriodosAdmin(), trabajo: borrado.estado() });
});

// GET /api/periodos/trabajo: avance del borrado (la página lo consulta cada 2 segundos)
const trabajo = handler(async (req, res) => {
  res.json({ trabajo: borrado.estado() });
});

// POST /api/periodos/:periodo/borrar   { alcance: 'liq' | 'todo', confirmacion, clave }
// Responde 202 enseguida y el borrado sigue en segundo plano.
const borrar = handler(async (req, res) => {
  const periodo = periodoValido(req.params.periodo);
  const alcance = String(req.body?.alcance || '');
  if (!ALCANCES[alcance]) throw new HttpError(400, 'El alcance es "liq" (sólo la liquidación) o "todo" (el período completo).');
  res.locals.auditoria = { detalle: `${periodo}: ${ALCANCES[alcance]}` };
  // La confirmación es el período escrito a mano: evita borrar otro mes por un clic
  if (String(req.body?.confirmacion || '').trim() !== String(periodo)) {
    throw new HttpError(400, `Para confirmar, escribí el período ${periodo}.`);
  }
  await verificarClavePropia(req, req.body?.clave);
  if (borrado.enCurso()) throw new HttpError(409, `Ya hay un borrado en curso (${borrado.estado().periodo}). Esperá a que termine.`);

  const hay = (await model.resumenPeriodosAdmin()).find((p) => p.periodo === periodo);
  const filas = hay ? (alcance === 'liq' ? hay.liquidacion : hay.caratulas + hay.items + hay.liquidacion) : 0;
  if (!filas) {
    throw new HttpError(404, alcance === 'liq'
      ? `El período ${periodo} no tiene liquidación cargada.`
      : `No hay datos del período ${periodo}.`);
  }

  borrado.iniciar({
    pool, periodo, alcance, usuario: req.usuario.usuario,
    alTerminar: () => model.limpiarCaches(),
  });
  res.status(202).json({ trabajo: borrado.estado() });
});

module.exports = { listar, trabajo, borrar, periodoValido };
