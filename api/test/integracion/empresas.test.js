// Varias empresas en un mismo sistema: cada administrador de empresa ve y
// administra sólo lo suyo; el administrador general, todo. Usa una empresa fija
// de prueba (ver ayuda.js) y usuarios test_..._<sufijo> que se borran al terminar.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  app, pool, auditoria, request, PREFIJO, sufijo, ADMIN, sinBase, prepararAdmin, prepararEmpresaPrueba, limpiar,
} = require('./ayuda');

const ADMIN_B = { usuario: `${PREFIJO}adminb_${sufijo}`, clave: 'Admin-empresa-b-123' };
const CONSULTA_B = { usuario: `${PREFIJO}consb_${sufijo}`, clave: 'Consulta-empresa-b-1' };

describe('Empresas: cada una ve y administra sólo lo suyo', { skip: sinBase }, () => {
  let general;   // token del administrador general (empresa 1)
  let adminB;    // token del administrador de la empresa de prueba
  let empresaB;

  const con = (token) => ({ Authorization: `Bearer ${token}` });
  const login = (u) => request(app).post('/api/auth/login').send(u);

  before(async () => {
    await limpiar();
    general = await prepararAdmin();
    empresaB = await prepararEmpresaPrueba();
    for (const [u, rol] of [[ADMIN_B, 'admin'], [CONSULTA_B, 'consulta']]) {
      await request(app).post('/api/auth/usuarios').set(con(general))
        .send({ usuario: u.usuario, nombre: `Prueba ${rol}`, clave: u.clave, rol, empresa: empresaB }).expect(201);
    }
    adminB = (await login(ADMIN_B).expect(200)).body.token;
  });
  after(async () => { await limpiar(); await pool.end(); });

  test('el ingreso informa la empresa del usuario', async () => {
    const r = await request(app).get('/api/auth/yo').set(con(adminB)).expect(200);
    assert.equal(r.body.empresa, empresaB);
    assert.equal(r.body.rol, 'admin');
  });

  test('el administrador de empresa lista sólo los usuarios de la suya; el general, todos', async () => {
    const deB = (await request(app).get('/api/auth/usuarios').set(con(adminB)).expect(200)).body;
    assert.ok(deB.length >= 2);
    assert.ok(deB.every((u) => u.empresa === empresaB), 'ninguno de otra empresa');
    const todos = (await request(app).get('/api/auth/usuarios').set(con(general)).expect(200)).body;
    assert.ok(todos.some((u) => u.usuario === ADMIN.usuario) && todos.some((u) => u.usuario === ADMIN_B.usuario));
  });

  test('crea usuarios sólo en su empresa y nunca con rol general', async () => {
    const nuevo = `${PREFIJO}nuevob_${sufijo}`;
    const r = await request(app).post('/api/auth/usuarios').set(con(adminB))
      .send({ usuario: nuevo, nombre: 'Nuevo de B', clave: 'Nuevo-de-b-12345', empresa: 1 }).expect(201);
    assert.equal(r.body.empresa, empresaB, 'aunque pida otra empresa, queda en la suya');
    await request(app).post('/api/auth/usuarios').set(con(adminB))
      .send({ usuario: `${PREFIJO}genb_${sufijo}`, nombre: 'x', clave: 'Otro-de-b-123456', rol: 'general' }).expect(403);
    await request(app).patch(`/api/auth/usuarios/${r.body.id}`).set(con(adminB)).send({ rol: 'general' }).expect(403);
    await request(app).patch(`/api/auth/usuarios/${r.body.id}`).set(con(adminB)).send({ empresa: 1 }).expect(403);
  });

  test('no puede ver ni tocar usuarios de otra empresa (404)', async () => {
    const [[g]] = await pool.query('SELECT IdUsuario AS id FROM usuarios WHERE Usuario = ?', [ADMIN.usuario]);
    await request(app).patch(`/api/auth/usuarios/${g.id}`).set(con(adminB)).send({ nombre: 'Hackeado' }).expect(404);
    await request(app).delete(`/api/auth/usuarios/${g.id}`).set(con(adminB)).expect(404);
    const [[sigue]] = await pool.query('SELECT Nombre FROM usuarios WHERE IdUsuario = ?', [g.id]);
    assert.equal(sigue.Nombre, 'Administrador de prueba');
  });

  test('empresas, períodos y SQL libre son sólo del administrador general (403)', async () => {
    await request(app).get('/api/empresas').set(con(adminB)).expect(403);
    await request(app).patch(`/api/empresas/${empresaB}`).set(con(adminB)).send({ nombre: 'x' }).expect(403);
    await request(app).get('/api/periodos').set(con(adminB)).expect(403);
    await request(app).post('/api/consultas/sql').set(con(adminB)).send({ sql: 'SELECT 1' }).expect(403);
    await request(app).get('/api/empresas').set(con(general)).expect(200);
  });

  test('la actividad que ve el administrador de empresa es sólo la de la suya', async () => {
    await auditoria.esperarPendientes();
    const deB = (await request(app).get('/api/auditoria').query({ empresa: 1, limite: 1000 }).set(con(adminB)).expect(200)).body.filas;
    assert.ok(deB.length > 0);
    assert.ok(deB.every((f) => f.empresa === empresaB), 'aunque pida la empresa 1');
    const delGeneral = (await request(app).get('/api/auditoria').query({ empresa: empresaB, limite: 1000 }).set(con(general)).expect(200)).body.filas;
    assert.ok(delGeneral.some((f) => f.usuario === ADMIN_B.usuario));
  });

  test('alta y cambios de empresa validan el número y el CUIT', async () => {
    let r = await request(app).post('/api/empresas').set(con(general)).send({ id: empresaB, nombre: 'Repetida' }).expect(409);
    assert.match(r.body.error, /Ya existe la empresa/);
    r = await request(app).post('/api/empresas').set(con(general)).send({ nombre: 'Con CUIT malo', cuit: '30-71234567-2' }).expect(400);
    assert.match(r.body.error, /CUIT/);
    await request(app).post('/api/empresas').set(con(general)).send({ nombre: '' }).expect(400);
    r = await request(app).patch('/api/empresas/1').set(con(general)).send({ activa: false }).expect(400);
    assert.match(r.body.error, /tu propia empresa/);
  });

  test('con la empresa desactivada, sus usuarios no entran; al reactivarla, sí', async () => {
    await request(app).patch(`/api/empresas/${empresaB}`).set(con(general)).send({ activa: false }).expect(200);
    let r = await request(app).get('/api/auth/yo').set(con(adminB)).expect(401);
    assert.match(r.body.error, /empresa está desactivada/);
    r = await login(CONSULTA_B).expect(401);
    assert.match(r.body.error, /empresa está desactivada/);
    await request(app).patch(`/api/empresas/${empresaB}`).set(con(general)).send({ activa: true }).expect(200);
    await login(CONSULTA_B).expect(200);
    await request(app).get('/api/auth/yo').set(con(adminB)).expect(200);
  });
});
