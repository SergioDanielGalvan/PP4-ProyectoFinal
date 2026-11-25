const crypto = require('crypto');
const pool = require('../config/db');

// Nunca devuelve ClaveHash salvo en buscarParaLogin y buscarVigente.
// Cada usuario pertenece a una empresa (db/10_empresas.sql); si la empresa está
// desactivada, sus usuarios no pueden entrar (salvo los de rol general).
const COLUMNAS = `u.IdUsuario AS id, u.Usuario AS usuario, u.Nombre AS nombre, u.Rol AS rol,
  u.Activo = 1 AS activo, u.CreadoEn AS creado_en, u.UltimoIngreso AS ultimo_ingreso,
  u.IdEmpresa AS empresa, e.Nombre AS empresa_nombre, COALESCE(e.Activa, 0) = 1 AS empresa_activa`;
const DESDE = 'FROM usuarios u LEFT JOIN empresa e ON e.IdEmpresa = u.IdEmpresa';

const normalizar = (r) => ({ ...r, activo: Boolean(r.activo), empresa_activa: Boolean(r.empresa_activa) });

async function buscarParaLogin(usuario) {
  const [rows] = await pool.query(`SELECT ${COLUMNAS}, u.ClaveHash AS clave_hash ${DESDE} WHERE u.Usuario = ?`, [usuario]);
  return rows[0] ? normalizar(rows[0]) : null;
}

async function buscarPorId(id) {
  const [rows] = await pool.query(`SELECT ${COLUMNAS} ${DESDE} WHERE u.IdUsuario = ?`, [id]);
  return rows[0] ? normalizar(rows[0]) : null;
}

// Para validar el token: datos del usuario más una huella de su clave actual
// (los primeros 16 caracteres del SHA-256 del hash bcrypt). Cuando la clave
// cambia, la huella cambia y los tokens emitidos antes dejan de valer.
async function buscarVigente(id) {
  const [rows] = await pool.query(`SELECT ${COLUMNAS}, u.ClaveHash AS clave_hash ${DESDE} WHERE u.IdUsuario = ?`, [id]);
  if (!rows[0]) return null;
  const { clave_hash: hash, ...usuario } = normalizar(rows[0]);
  return { ...usuario, huella: huellaClave(hash) };
}

const huellaClave = (hash) => crypto.createHash('sha256').update(String(hash)).digest('hex').slice(0, 16);

// Sin empresa: todos (rol general). Con empresa: sólo los de esa empresa.
async function listar({ empresa } = {}) {
  const [rows] = empresa
    ? await pool.query(`SELECT ${COLUMNAS} ${DESDE} WHERE u.IdEmpresa = ? ORDER BY u.Usuario`, [empresa])
    : await pool.query(`SELECT ${COLUMNAS} ${DESDE} ORDER BY e.Nombre, u.Usuario`);
  return rows.map(normalizar);
}

async function crear({ usuario, nombre, claveHash, rol, empresa = 1 }) {
  const [r] = await pool.query(
    'INSERT INTO usuarios (Usuario, IdEmpresa, Nombre, ClaveHash, Rol) VALUES (?, ?, ?, ?, ?)',
    [usuario, empresa, nombre, claveHash, rol]);
  return buscarPorId(r.insertId);
}

async function actualizar(id, { nombre, rol, activo, claveHash, empresa }) {
  const cambios = [];
  const valores = [];
  if (nombre !== undefined) { cambios.push('Nombre = ?'); valores.push(nombre); }
  if (rol !== undefined) { cambios.push('Rol = ?'); valores.push(rol); }
  if (activo !== undefined) { cambios.push('Activo = ?'); valores.push(activo ? 1 : 0); }
  if (claveHash !== undefined) { cambios.push('ClaveHash = ?'); valores.push(claveHash); }
  if (empresa !== undefined) { cambios.push('IdEmpresa = ?'); valores.push(empresa); }
  if (cambios.length) {
    await pool.query(`UPDATE usuarios SET ${cambios.join(', ')} WHERE IdUsuario = ?`, [...valores, id]);
  }
  return buscarPorId(id);
}

async function registrarIngreso(id) {
  await pool.query('UPDATE usuarios SET UltimoIngreso = NOW() WHERE IdUsuario = ?', [id]);
}

// Borra sólo usuarios que nunca ingresaron (altas por error o de prueba).
// Devuelve true si borró. Los que ya ingresaron se desactivan: así queda
// registro de quién tuvo acceso.
async function eliminar(id) {
  const [r] = await pool.query('DELETE FROM usuarios WHERE IdUsuario = ? AND UltimoIngreso IS NULL', [id]);
  return r.affectedRows === 1;
}

// Siempre tiene que quedar al menos un administrador general activo
async function contarGeneralesActivos() {
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM usuarios WHERE Rol = 'general' AND Activo = 1");
  return Number(n);
}

module.exports = {
  buscarParaLogin, buscarPorId, buscarVigente, huellaClave, listar, crear, actualizar, eliminar,
  registrarIngreso, contarGeneralesActivos,
};
