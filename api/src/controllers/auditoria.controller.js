const auditoria = require('../models/auditoria.model');
const { HttpError } = require('../middlewares/errors');

const handler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function fechaOpcional(v, nombre) {
  if (v === undefined || v === '') return null;
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
  if (!ok) throw new HttpError(400, `${nombre} es una fecha AAAA-MM-DD, por ejemplo 2026-10-31.`);
  return v;
}

function filtros(q) {
  const f = {
    usuario: q.usuario ? String(q.usuario).trim().toLowerCase() : null,
    accion: q.accion || null,
    desde: fechaOpcional(q.desde, 'desde'),
    hasta: fechaOpcional(q.hasta, 'hasta'),
    errores: q.errores === '1' || q.errores === 'true',
  };
  if (f.usuario && !/^[\x21-\x7e]{1,40}$/.test(f.usuario)) throw new HttpError(400, 'Usuario inválido.');
  if (f.accion && !auditoria.ACCIONES.includes(f.accion)) {
    throw new HttpError(400, `La acción es una de: ${auditoria.ACCIONES.join(', ')}.`);
  }
  if (f.desde && f.hasta && f.desde > f.hasta) throw new HttpError(400, 'La fecha "desde" es posterior a "hasta".');
  return f;
}

function entero(v, defecto, min, max) {
  if (v === undefined || v === '') return defecto;
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `Valor fuera de rango: ${v} (de ${min} a ${max}).`);
  return n;
}

// GET /api/auditoria?usuario=&accion=&desde=&hasta=&errores=1&limite=100&antes=<id>
const listar = handler(async (req, res) => {
  res.json(await auditoria.buscar(filtros(req.query), {
    antes: entero(req.query.antes, null, 1, Number.MAX_SAFE_INTEGER),
    limite: entero(req.query.limite, 100, 1, 1000),
  }));
});

// GET /api/auditoria/resumen?usuario=&desde=&hasta=
const resumen = handler(async (req, res) => {
  res.json(await auditoria.resumen(filtros(req.query)));
});

module.exports = { listar, resumen, filtros };
