// Pestaña Períodos: cantidades por mes y resguardos del borrado.
// No borra datos: se prueban los controles que frenan un borrado (permisos,
// confirmación, clave, período inexistente). El borrado en sí está probado con
// una base simulada en test/unit/borrarPeriodo.test.js.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { app, pool, auditoria, request, PREFIJO, sufijo, ADMIN, sinBase, prepararAdmin, limpiar } = require('./ayuda');

const CONSULTA = { usuario: `${PREFIJO}consulta_${sufijo}`, clave: 'Consulta-de-prueba-123' };
const INEXISTENTE = 209912;

describe('Períodos: cantidades y resguardos del borrado', { skip: sinBase }, () => {
  let admin;
  let consulta;
  let periodo;      // un período real, para probar que los resguardos lo protegen
  let antes;        // sus cantidades antes de los intentos

  const contar = async (p) => {
    const [[c]] = await pool.query(`SELECT
      (SELECT COUNT(*) FROM caratula WHERE Periodo = ?) AS caratulas,
      (SELECT COUNT(*) FROM item WHERE Periodo = ?) AS items,
      (SELECT COUNT(*) FROM liq WHERE Periodo = ?) AS liquidacion`, [p, p, p]);
    return { caratulas: Number(c.caratulas), items: Number(c.items), liquidacion: Number(c.liquidacion) };
  };
  const borrar = (token, p, cuerpo) => request(app).post(`/api/periodos/${p}/borrar`)
    .set('Authorization', `Bearer ${token}`).send(cuerpo);

  before(async () => {
    await limpiar();
    admin = await prepararAdmin();
    await pool.query('INSERT INTO usuarios (Usuario, Nombre, ClaveHash, Rol) VALUES (?, ?, ?, ?)',
      [CONSULTA.usuario, 'Consulta de prueba', bcrypt.hashSync(CONSULTA.clave, 10), 'consulta']);
    consulta = (await request(app).post('/api/auth/login').send(CONSULTA).expect(200)).body.token;
    [[{ periodo }]] = await pool.query('SELECT MAX(Periodo) AS periodo FROM caratula');
    periodo = Number(periodo);
    antes = await contar(periodo);
  });
  after(async () => { await limpiar(); await pool.end(); });

  test('sólo un administrador ve la pestaña y puede borrar (401 sin sesión, 403 con rol consulta)', async () => {
    await request(app).get('/api/periodos').expect(401);
    await request(app).get('/api/periodos').set('Authorization', `Bearer ${consulta}`).expect(403);
    await borrar(consulta, periodo, { alcance: 'liq', confirmacion: String(periodo), clave: CONSULTA.clave }).expect(403);
  });

  test('las cantidades de cada mes coinciden con la base', async () => {
    const r = await request(app).get('/api/periodos').set('Authorization', `Bearer ${admin}`).expect(200);
    const fila = r.body.periodos.find((p) => p.periodo === periodo);
    assert.ok(fila, 'el período aparece');
    assert.deepEqual({ caratulas: fila.caratulas, items: fila.items, liquidacion: fila.liquidacion }, antes);
  });

  test('sin el período escrito, con la clave equivocada o con datos mal escritos no se borra nada (400)', async () => {
    const intentos = [
      [{ alcance: 'liq', confirmacion: '', clave: ADMIN.clave }, /escribí el período/],
      [{ alcance: 'liq', confirmacion: String(periodo - 1), clave: ADMIN.clave }, /escribí el período/],
      [{ alcance: 'liq', confirmacion: String(periodo), clave: 'otra-clave-123' }, /clave no es correcta/],
      [{ alcance: 'items', confirmacion: String(periodo), clave: ADMIN.clave }, /alcance/],
    ];
    for (const [cuerpo, mensaje] of intentos) {
      const r = await borrar(admin, periodo, cuerpo).expect(400);
      assert.match(r.body.error, mensaje);
    }
    await borrar(admin, '2026-07', { alcance: 'liq' }).expect(400);
    assert.deepEqual(await contar(periodo), antes, 'el período quedó intacto');
  });

  test('un período que no está cargado da 404', async () => {
    const r = await borrar(admin, INEXISTENTE, { alcance: 'todo', confirmacion: String(INEXISTENTE), clave: ADMIN.clave }).expect(404);
    assert.match(r.body.error, /No hay datos del período/);
  });

  test('cada intento queda en la auditoría como borrar_periodo, sin la clave', async () => {
    await auditoria.esperarPendientes();
    const [filas] = await pool.query("SELECT Detalle, Estado FROM auditoria WHERE Usuario = ? AND Accion = 'borrar_periodo'", [ADMIN.usuario]);
    assert.ok(filas.length >= 5);
    assert.ok(filas.some((f) => f.Estado === 404 && f.Detalle.includes(`${INEXISTENTE}: el período completo`)));
    assert.ok(filas.every((f) => !f.Detalle.includes(ADMIN.clave) && !f.Detalle.includes('otra-clave-123')));
  });
});
