// Empresas (db/10_empresas.sql). IdEmpresa es el mismo número que usa el Módulo
// MARIA (idEmpresa en CARATULA, CONFIGURACIONMARIA, etc.).
const pool = require('../config/db');

const COLUMNAS = `e.IdEmpresa AS id, e.Nombre AS nombre, e.Cuit AS cuit, e.Activa = 1 AS activa, e.CreadaEn AS creada_en,
  (SELECT COUNT(*) FROM usuarios u WHERE u.IdEmpresa = e.IdEmpresa) AS usuarios,
  (SELECT COUNT(*) FROM usuarios u WHERE u.IdEmpresa = e.IdEmpresa AND u.Activo = 1) AS usuarios_activos`;

const normalizar = (r) => ({ ...r, activa: Boolean(r.activa), usuarios: Number(r.usuarios), usuarios_activos: Number(r.usuarios_activos) });

async function listar() {
  const [rows] = await pool.query(`SELECT ${COLUMNAS} FROM empresa e ORDER BY e.Nombre`);
  return rows.map(normalizar);
}

async function buscar(id) {
  const [rows] = await pool.query(`SELECT ${COLUMNAS} FROM empresa e WHERE e.IdEmpresa = ?`, [id]);
  return rows[0] ? normalizar(rows[0]) : null;
}

// Sin número, toma el siguiente libre
async function crear({ id, nombre, cuit }) {
  let nuevo = id;
  if (!nuevo) {
    const [[{ siguiente }]] = await pool.query('SELECT COALESCE(MAX(IdEmpresa), 0) + 1 AS siguiente FROM empresa');
    nuevo = Number(siguiente);
  }
  await pool.query('INSERT INTO empresa (IdEmpresa, Nombre, Cuit) VALUES (?, ?, ?)', [nuevo, nombre, cuit || null]);
  return buscar(nuevo);
}

async function actualizar(id, { nombre, cuit, activa }) {
  const cambios = [];
  const valores = [];
  if (nombre !== undefined) { cambios.push('Nombre = ?'); valores.push(nombre); }
  if (cuit !== undefined) { cambios.push('Cuit = ?'); valores.push(cuit || null); }
  if (activa !== undefined) { cambios.push('Activa = ?'); valores.push(activa ? 1 : 0); }
  if (cambios.length) await pool.query(`UPDATE empresa SET ${cambios.join(', ')} WHERE IdEmpresa = ?`, [...valores, id]);
  return buscar(id);
}

module.exports = { listar, buscar, crear, actualizar };
