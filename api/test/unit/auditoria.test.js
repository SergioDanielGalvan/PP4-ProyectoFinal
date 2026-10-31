// Clasificación de los pedidos y armado del detalle de la auditoría (sin base)
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { accionDe, textoParametros, nombreSeguro } = require('../../src/middlewares/auditoria');
const { filtros } = require('../../src/controllers/auditoria.controller');
const pool = require('../../src/config/db');

after(() => pool.end());   // el modelo abre el pool al cargarse

test('clasifica cada pedido en una acción', () => {
  assert.equal(accionDe('POST', '/auth/login', 200), 'login');
  assert.equal(accionDe('POST', '/auth/login', 401), 'login_fallido');
  assert.equal(accionDe('POST', '/auth/login', 429), 'login_bloqueado');
  assert.equal(accionDe('POST', '/auth/usuarios', 201), 'alta_usuario');
  assert.equal(accionDe('PATCH', '/auth/usuarios/7', 200), 'modif_usuario');
  assert.equal(accionDe('DELETE', '/auth/usuarios/7', 409), 'baja_usuario');
  assert.equal(accionDe('GET', '/auth/usuarios', 200), 'consulta');
  assert.equal(accionDe('POST', '/auth/clave', 200), 'cambio_clave');
  assert.equal(accionDe('POST', '/consultas/sql', 200), 'sql_libre');
  assert.equal(accionDe('GET', '/impo/ncm/8471/precios', 200), 'consulta');
  assert.equal(accionDe('GET', '/auditoria/resumen', 200), 'ver_auditoria');
});

test('nunca guarda claves ni tokens de los parámetros', () => {
  const texto = textoParametros({ ncm: '8471', origen: '310', clave: 'secreta', token: 'abc', Password: 'x' });
  assert.equal(texto, 'ncm=8471 · origen=310');
  assert.equal(textoParametros({}), '');
});

test('el usuario escrito en un login fallido se guarda en ascii y hasta 40 caracteres', () => {
  assert.equal(nombreSeguro('Ñandú'), '?and?');
  assert.equal(nombreSeguro('x'.repeat(60)).length, 40);
  assert.equal(nombreSeguro(undefined), null);
});

test('valida los filtros de la consulta de actividad', () => {
  const f = filtros({ usuario: 'Profesor', accion: 'login', desde: '2026-10-01', hasta: '2026-10-31', errores: '1' });
  assert.deepEqual(f, { usuario: 'profesor', accion: 'login', desde: '2026-10-01', hasta: '2026-10-31', errores: true });
  assert.throws(() => filtros({ accion: 'borrar_todo' }), { status: 400 });
  assert.throws(() => filtros({ desde: '31/10/2026' }), { status: 400 });
  assert.throws(() => filtros({ desde: '2026-10-31', hasta: '2026-10-01' }), { status: 400 });
});
