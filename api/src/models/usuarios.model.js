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

async function contarAdminsActivos() {
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM usuarios WHERE Rol = 'admin' AND Activo = 1");
  return Number(n);
}

module.exports = { buscarParaLogin, buscarPorId, listar, crear, actualizar, registrarIngreso, contarAdminsActivos };
