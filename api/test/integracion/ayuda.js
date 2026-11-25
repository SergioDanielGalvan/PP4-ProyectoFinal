// Preparación común de las pruebas de integración: usan la base configurada
// en api/.env (la local de desarrollo, NO la de producción) y crean un
// administrador general temporal que se borra al terminar.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../../src/app');
const pool = require('../../src/config/db');
const auditoria = require('../../src/models/auditoria.model');

const PREFIJO = 'test_';   // todos los usuarios de prueba empiezan así
const sufijo = Date.now().toString(36);
const ADMIN = { usuario: `${PREFIJO}admin_${sufijo}`, clave: 'Admin-de-prueba-123' };

// Sin base configurada las pruebas se saltean en lugar de fallar
const sinBase = !process.env.DB_USER || !process.env.JWT_SECRET
  ? 'falta configurar api/.env (DB_USER y JWT_SECRET)' : false;

async function prepararAdmin() {
  await pool.query('INSERT INTO usuarios (Usuario, Nombre, ClaveHash, Rol) VALUES (?, ?, ?, ?)',
    [ADMIN.usuario, 'Administrador de prueba', bcrypt.hashSync(ADMIN.clave, 10), 'general']);
  const r = await request(app).post('/api/auth/login').send(ADMIN).expect(200);
  return r.body.token;
}

// Empresa fija para las pruebas de aislamiento entre empresas. No se borra al
// terminar (la API no tiene permiso para borrar empresas): se reusa en cada corrida
// y queda desactivada, sin usuarios.
const EMPRESA_PRUEBA = 999999;
async function prepararEmpresaPrueba() {
  await pool.query(`INSERT INTO empresa (IdEmpresa, Nombre, Activa) VALUES (?, 'Empresa de prueba (pruebas automáticas)', 1)
    ON DUPLICATE KEY UPDATE Activa = 1`, [EMPRESA_PRUEBA]);
  return EMPRESA_PRUEBA;
}

// Borra sólo los usuarios creados en esta corrida (test_..._<sufijo>) y lo que
// registraron en la auditoría (espera antes a que terminen de escribirse)
async function limpiar() {
  await auditoria.esperarPendientes();
  await pool.query("DELETE FROM usuarios WHERE Usuario LIKE 'test\\_%' AND Usuario LIKE ?", [`%\\_${sufijo}`]);
  await pool.query("DELETE FROM auditoria WHERE Usuario LIKE 'test\\_%' AND Usuario LIKE ?", [`%\\_${sufijo}`]);
  await pool.query('UPDATE empresa SET Activa = 0 WHERE IdEmpresa = ?', [EMPRESA_PRUEBA]);
}

module.exports = { app, pool, auditoria, request, PREFIJO, sufijo, ADMIN, sinBase, prepararAdmin, prepararEmpresaPrueba, EMPRESA_PRUEBA, limpiar };
