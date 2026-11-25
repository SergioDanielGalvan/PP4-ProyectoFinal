// Empresas: sólo el administrador general las crea, las modifica o las desactiva.
// No se borran: una empresa desactivada conserva sus usuarios y su actividad,
// pero sus usuarios no pueden entrar.
const empresas = require('../models/empresas.model');
const { olvidarTodos } = require('../middlewares/auth');
const { HttpError } = require('../middlewares/errors');

const handler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// CUIT: 11 dígitos (con o sin guiones) y dígito verificador correcto
function cuitValido(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const c = String(v).replace(/[-\s]/g, '');
  if (!/^\d{11}$/.test(c)) throw new HttpError(400, 'El CUIT tiene 11 dígitos, por ejemplo 30-12345678-9.');
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(c[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10 || dv !== Number(c[10])) throw new HttpError(400, `El CUIT ${c} no es válido (dígito verificador).`);
  return c;
}

function nombreValido(v) {
  const n = String(v ?? '').trim().slice(0, 80);
  if (!n) throw new HttpError(400, 'Falta el nombre de la empresa.');
  return n;
}

function idValido(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 4294967295) throw new HttpError(400, 'El número de empresa es un entero positivo (el idEmpresa de MARIA).');
  return n;
}

const listar = handler(async (req, res) => {
  res.json(await empresas.listar());
});

// POST /api/empresas  { nombre, cuit?, id? }   id = el idEmpresa de MARIA (opcional)
const crear = handler(async (req, res) => {
  const datos = {
    id: req.body?.id !== undefined && req.body.id !== '' ? idValido(req.body.id) : null,
    nombre: nombreValido(req.body?.nombre),
    cuit: cuitValido(req.body?.cuit),
  };
  res.locals.auditoria = { detalle: `empresa ${datos.id ?? '(nueva)'}: ${datos.nombre}` };
  try {
    res.status(201).json(await empresas.crear(datos));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, /Cuit/i.test(err.sqlMessage || '') ? `Ya hay una empresa con el CUIT ${datos.cuit}.` : `Ya existe la empresa ${datos.id}.`);
    }
    throw err;
  }
});

// PATCH /api/empresas/:id  { nombre?, cuit?, activa? }
const modificar = handler(async (req, res) => {
  const id = idValido(req.params.id);
  const actual = await empresas.buscar(id);
  if (!actual) throw new HttpError(404, 'No existe esa empresa.');
  const cambios = {};
  if (req.body?.nombre !== undefined) cambios.nombre = nombreValido(req.body.nombre);
  if (req.body?.cuit !== undefined) cambios.cuit = cuitValido(req.body.cuit);
  if (req.body?.activa !== undefined) {
    if (typeof req.body.activa !== 'boolean') throw new HttpError(400, 'activa va true o false (sin comillas).');
    if (!req.body.activa && id === req.usuario.empresa) throw new HttpError(400, 'No podés desactivar tu propia empresa.');
    cambios.activa = req.body.activa;
  }
  const partes = [];
  if (cambios.nombre !== undefined && cambios.nombre !== actual.nombre) partes.push(`nombre "${actual.nombre}" → "${cambios.nombre}"`);
  if (cambios.cuit !== undefined && cambios.cuit !== actual.cuit) partes.push(`CUIT ${actual.cuit || '—'} → ${cambios.cuit || '—'}`);
  if (cambios.activa !== undefined && cambios.activa !== actual.activa) partes.push(cambios.activa ? 'activada' : 'desactivada');
  res.locals.auditoria = { detalle: `empresa ${id}: ${partes.join(', ') || 'sin cambios'}` };
  try {
    const r = await empresas.actualizar(id, cambios);
    if (cambios.activa !== undefined) olvidarTodos();   // sus usuarios entran o dejan de entrar ya
    res.json(r);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, `Ya hay una empresa con el CUIT ${cambios.cuit}.`);
    throw err;
  }
});

module.exports = { listar, crear, modificar, cuitValido };
