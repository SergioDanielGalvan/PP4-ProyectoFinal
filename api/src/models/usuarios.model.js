const crypto = require('crypto');
const pool = require('../config/db');

// Nunca devuelve ClaveHash salvo en buscarParaLogin.
const COLUMNAS = `IdUsuario AS id, Usuario AS usuario, Nombre AS nombre, Rol AS rol,
  Activo = 1 AS activo, CreadoEn AS creado_en, UltimoIngreso AS ultimo_ingreso`;

async function buscarParaLogin(usuario) {
  const [rows] = await pool.query(
    `SELECT ${COLUMNAS}, ClaveHash AS clave_hash FROM usuarios WHERE Usuario = ?`, [usuario]);
  return rows[0] || null;
}

async function buscarPorId(id) {
  const [rows] = await pool.query(`SELECT ${COLUMNAS} FROM usuarios WHERE IdUsuario = ?`, [id]);
  if (!rows[0]) return null;
  return { ...rows[0], activo: Boolean(rows[0].activo) };
}

// Para validar el token: datos del usuario más una huella de su clave actual
// (los primeros 16 caracteres del SHA-256 del hash bcrypt). Cuando la clave
// cambia, la huella cambia y los tokens emitidos antes dejan de valer.
async function buscarVigente(id) {
  const [rows] = await pool.query(`SELECT ${COLUMNAS}, ClaveHash AS clave_hash FROM usuarios WHERE IdUsuario = ?`, [id]);
  if (!rows[0]) return null;
  const { clave_hash: hash, ...usuario } = rows[0];
  return { ...usuario, activo: Boolean(usuario.activo), huella: huellaClave(hash) };
}

const huellaClave = (hash) => crypto.createHash('sha256').update(String(hash)).digest('hex').slice(0, 16);

async function listar() {
  const [rows] = await pool.query(`SELECT ${COLUMNAS} FROM usuarios ORDER BY Usuario`);
  return rows.map((r) => ({ ...r, activo: Boolean(r.activo) }));
}

async function crear({ usuario, nombre, claveHash, rol }) {
  const [r] = await pool.query(
    'INSERT INTO usuarios (Usuario, Nombre, ClaveHash, Rol) VALUES (?, ?, ?, ?)',
    [usuario, nombre, claveHash, rol]);
  return buscarPorId(r.insertId);
}

async function actualizar(id, { nombre, rol, activo, claveHash }) {
  const cambios = [];
  const valores = [];
  if (nombre !== undefined) { cambios.push('Nombre = ?'); valores.push(nombre); }
  if (rol !== undefined) { cambios.push('Rol = ?'); valores.push(rol); }
  if (activo !== undefined) { cambios.push('Activo = ?'); valores.push(activo ? 1 : 0); }
  if (claveHash !== undefined) { cambios.push('ClaveHash = ?'); valores.push(claveHash); }
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

async function contarAdminsActivos() {
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM usuarios WHERE Rol = 'admin' AND Activo = 1");
  return Number(n);
}

module.exports = { buscarParaLogin, buscarPorId, buscarVigente, huellaClave, listar, crear, actualizar, eliminar, registrarIngreso, contarAdminsActivos };
