const bcrypt = require('bcryptjs');
const usuarios = require('../models/usuarios.model');
const { HttpError } = require('../middlewares/errors');
const { firmarToken, olvidarUsuario, ROLES } = require('../middlewares/auth');

const handler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- validaciones ----------
const CLAVE_MIN = 10;

function nombreUsuario(v) {
  const u = String(v || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(u)) {
    throw new HttpError(400, 'El usuario va de 3 a 40 caracteres: letras, números, punto, guion o guion bajo.');
  }
  return u;
}

function claveValida(v) {
  const c = String(v || '');
  if (c.length < CLAVE_MIN) throw new HttpError(400, `La clave tiene que tener al menos ${CLAVE_MIN} caracteres.`);
  if (c.length > 72) throw new HttpError(400, 'La clave no puede superar los 72 caracteres.');  // límite de bcrypt
  return c;
}

function rolValido(v) {
  if (!ROLES.includes(v)) throw new HttpError(400, `El rol es uno de: ${ROLES.join(', ')}.`);
  return v;
}

const hashear = (clave) => bcrypt.hash(clave, 10);
// Hash de relleno: se compara contra él cuando el usuario no existe
const HASH_RELLENO = bcrypt.hashSync('relleno-no-es-una-clave', 10);

// ---------- freno a los intentos de login ----------
// 5 intentos fallidos por usuario e IP en 15 minutos. En memoria: alcanza para
// una sola instancia (Render free); se reinicia si se reinicia el servicio.
const VENTANA_MS = 15 * 60 * 1000;
const MAX_FALLOS = 5;
const fallos = new Map();

function controlarIntentos(clave) {
  const f = fallos.get(clave);
  if (f && Date.now() - f.desde < VENTANA_MS && f.n >= MAX_FALLOS) {
    const minutos = Math.ceil((VENTANA_MS - (Date.now() - f.desde)) / 60000);
    throw new HttpError(429, `Demasiados intentos fallidos. Probá de nuevo en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`);
  }
}

function registrarFallo(clave) {
  const f = fallos.get(clave);
  if (!f || Date.now() - f.desde >= VENTANA_MS) fallos.set(clave, { n: 1, desde: Date.now() });
  else f.n += 1;
}

// ---------- endpoints ----------
const login = handler(async (req, res) => {
  const usuario = String(req.body?.usuario || '').trim().toLowerCase();
  const clave = String(req.body?.clave || '');
  if (!usuario || !clave) throw new HttpError(400, 'Enviá usuario y clave.');

  const claveIntentos = `${req.ip}|${usuario}`;
  controlarIntentos(claveIntentos);

  const u = await usuarios.buscarParaLogin(usuario);
  // Se compara aunque el usuario no exista, para no revelar cuáles existen por el tiempo de respuesta
  const ok = await bcrypt.compare(clave, u ? u.clave_hash : HASH_RELLENO);
  if (!u || !ok || !u.activo) {
    registrarFallo(claveIntentos);
    throw new HttpError(401, 'Usuario o clave incorrectos.');
  }
  fallos.delete(claveIntentos);
  await usuarios.registrarIngreso(u.id);
  const token = firmarToken(u);
  res.json({
    token,
    tipo: 'Bearer',
    expira: process.env.JWT_EXPIRA || '8h',
    usuario: { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol },
  });
});

const yo = handler(async (req, res) => {
  const { id, usuario, nombre, rol, ultimo_ingreso } = req.usuario;
  res.json({ id, usuario, nombre, rol, ultimo_ingreso });
});

const cambiarClave = handler(async (req, res) => {
  const actual = String(req.body?.actual || '');
  const nueva = claveValida(req.body?.nueva);
  const u = await usuarios.buscarParaLogin(req.usuario.usuario);
  if (!u || !(await bcrypt.compare(actual, u.clave_hash))) throw new HttpError(400, 'La clave actual no es correcta.');
  await usuarios.actualizar(u.id, { claveHash: await hashear(nueva) });
  res.json({ ok: true });
});

// ----- administración (sólo rol admin) -----
const listarUsuarios = handler(async (req, res) => {
  res.json(await usuarios.listar());
});

const crearUsuario = handler(async (req, res) => {
  const datos = {
    usuario: nombreUsuario(req.body?.usuario),
    nombre: String(req.body?.nombre || '').trim().slice(0, 80),
    rol: rolValido(req.body?.rol || 'consulta'),
    claveHash: await hashear(claveValida(req.body?.clave)),
  };
  if (!datos.nombre) throw new HttpError(400, 'Falta el nombre.');
  try {
    res.status(201).json(await usuarios.crear(datos));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, `Ya existe el usuario ${datos.usuario}.`);
    throw err;
  }
});

// Cambia nombre, rol, activo o clave (reseteo por el admin). No borra usuarios.
const modificarUsuario = handler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const actual = Number.isInteger(id) ? await usuarios.buscarPorId(id) : null;
  if (!actual) throw new HttpError(404, 'No existe ese usuario.');

  const cambios = {};
  if (req.body?.nombre !== undefined) cambios.nombre = String(req.body.nombre ?? '').trim().slice(0, 80);
  if (req.body?.rol !== undefined) cambios.rol = rolValido(req.body.rol);
  if (req.body?.activo !== undefined) {
    if (typeof req.body.activo !== 'boolean') throw new HttpError(400, 'activo va true o false (sin comillas).');
    cambios.activo = req.body.activo;
  }
  if (req.body?.clave !== undefined) cambios.claveHash = await hashear(claveValida(req.body.clave));

  // No dejar el sistema sin ningún administrador activo
  const pierdeAdmin = actual.rol === 'admin' && actual.activo
    && ((cambios.rol && cambios.rol !== 'admin') || cambios.activo === false);
  if (pierdeAdmin && (await usuarios.contarAdminsActivos()) <= 1) {
    throw new HttpError(400, 'Es el único administrador activo: creá otro antes de quitarle el rol o desactivarlo.');
  }

  if (pierdeAdmin && actual.id === req.usuario.id) {
    throw new HttpError(400, 'No podés quitarte el rol de administrador ni desactivarte a vos mismo.');
  }
  if (cambios.nombre === '') throw new HttpError(400, 'El nombre no puede quedar vacío.');

  const resultado = await usuarios.actualizar(id, cambios);
  olvidarUsuario(id);
  res.json(resultado);
});

// Elimina un usuario que nunca ingresó. Si ya ingresó, responde 409 y el
// front ofrece desactivarlo: el historial de accesos no se pierde.
const eliminarUsuario = handler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const actual = Number.isInteger(id) ? await usuarios.buscarPorId(id) : null;
  if (!actual) throw new HttpError(404, 'No existe ese usuario.');
  if (actual.id === req.usuario.id) throw new HttpError(400, 'No podés eliminar tu propio usuario.');
  if (actual.rol === 'admin' && actual.activo && (await usuarios.contarAdminsActivos()) <= 1) {
    throw new HttpError(400, 'Es el único administrador activo: no se puede eliminar.');
  }
  if (actual.ultimo_ingreso) {
    throw new HttpError(409, `${actual.usuario} ya ingresó al sistema: para conservar el historial no se elimina, se desactiva.`);
  }
  await usuarios.eliminar(id);
  olvidarUsuario(id);
  res.json({ ok: true, eliminado: actual.usuario });
});

module.exports = { login, yo, cambiarClave, listarUsuarios, crearUsuario, modificarUsuario, eliminarUsuario, hashear, claveValida, nombreUsuario, rolValido };
