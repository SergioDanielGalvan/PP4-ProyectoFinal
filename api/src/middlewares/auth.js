// Autenticación con JWT (Authorization: Bearer <token>).
//
//  requireAuth     rutas de consulta (/api/impo): sólo exige token si AUTH_ENABLED=true,
//                  para que la página de prueba siga abierta mientras el front no tenga login.
//  requireLogin    exige token SIEMPRE, sin importar AUTH_ENABLED.
//  requireRol(...) además del token, exige uno de los roles. Lo usan las rutas
//                  sensibles (SQL libre, alta de usuarios): nunca quedan abiertas.
const jwt = require('jsonwebtoken');
const usuarios = require('../models/usuarios.model');
const { HttpError } = require('./errors');

const EMISOR = 'comex-api';
const ROLES = ['admin', 'consulta'];

function secreto() {
  const s = process.env.JWT_SECRET || '';
  if (s.length < 32) {
    throw new HttpError(500, 'Falta configurar JWT_SECRET en el servidor (al menos 32 caracteres).');
  }
  return s;
}

// `huella` identifica la clave vigente (ver usuarios.buscarVigente): el token
// deja de valer si la clave cambia, la cambie el usuario o un administrador.
function firmarToken(usuario, huella) {
  return jwt.sign(
    { sub: String(usuario.id), usuario: usuario.usuario, rol: usuario.rol, cv: huella },
    secreto(),
    { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRA || '8h', issuer: EMISOR },
  );
}

// El token dice quién es; la base dice si sigue activo y con qué rol.
// Se consulta como mucho una vez por minuto por usuario.
const CACHE_MS = 60 * 1000;
const cache = new Map();

async function usuarioVigente(id) {
  const guardado = cache.get(id);
  if (guardado && Date.now() - guardado.hora < CACHE_MS) return guardado.usuario;
  const usuario = await usuarios.buscarVigente(id);
  cache.set(id, { hora: Date.now(), usuario });
  return usuario;
}

function olvidarUsuario(id) {
  cache.delete(String(id));
}

async function leerToken(req) {
  const [tipo, token] = String(req.headers.authorization || '').split(' ');
  if (tipo !== 'Bearer' || !token) throw new HttpError(401, 'Iniciá sesión: falta el token (Authorization: Bearer ...).');
  let datos;
  try {
    datos = jwt.verify(token, secreto(), { algorithms: ['HS256'], issuer: EMISOR });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, err.name === 'TokenExpiredError' ? 'La sesión venció; volvé a iniciar sesión.' : 'Token inválido.');
  }
  const usuario = await usuarioVigente(datos.sub);
  if (!usuario || !usuario.activo) throw new HttpError(401, 'El usuario no existe o está desactivado.');
  if (datos.cv !== usuario.huella) throw new HttpError(401, 'La clave cambió: volvé a iniciar sesión.');
  const { huella, ...sinHuella } = usuario;
  return sinHuella;
}

const requireLogin = (req, res, next) => {
  leerToken(req).then((u) => { req.usuario = u; next(); }).catch(next);
};

const requireAuth = (req, res, next) => {
  if (process.env.AUTH_ENABLED !== 'true') return next();
  return requireLogin(req, res, next);
};

const requireRol = (...roles) => (req, res, next) => {
  leerToken(req).then((u) => {
    req.usuario = u;   // antes del control de rol: la auditoría registra quién intentó
    if (!roles.includes(u.rol)) throw new HttpError(403, 'Tu usuario no tiene permiso para esta operación.');
    next();
  }).catch(next);
};

module.exports = { requireAuth, requireLogin, requireRol, firmarToken, olvidarUsuario, ROLES };
