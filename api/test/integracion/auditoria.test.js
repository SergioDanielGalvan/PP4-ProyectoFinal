// Prueba de integración 3: la auditoría registra lo que hace cada usuario.
// Hace pedidos reales a la API y verifica en la tabla auditoria qué quedó.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, pool, auditoria, request, PREFIJO, sufijo, ADMIN, sinBase, prepararAdmin, limpiar } = require('./ayuda');

const registros = async (usuario) => {
  await auditoria.esperarPendientes();
  const [filas] = await pool.query(
    'SELECT Accion, Ruta, Detalle, Estado, Filas FROM auditoria WHERE Usuario = ? ORDER BY IdAuditoria', [usuario]);
  return filas;
};

describe('Auditoría de actividad', { skip: sinBase }, () => {
  let token;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const otro = { usuario: `${PREFIJO}lector_${sufijo}`, nombre: 'Lector', clave: 'Clave-del-lector-1', rol: 'consulta' };

  before(async () => { await limpiar(); token = await prepararAdmin(); });
  after(async () => { await limpiar(); await pool.end(); });

  test('registra el ingreso y el ingreso fallido, sin guardar la clave', async () => {
    await request(app).post('/api/auth/login').send({ usuario: ADMIN.usuario, clave: 'clave-equivocada' }).expect(401);
    const filas = await registros(ADMIN.usuario);
    const acciones = filas.map((f) => f.Accion);
    assert.ok(acciones.includes('login'), 'el ingreso de prepararAdmin quedó registrado');
    const fallido = filas.find((f) => f.Accion === 'login_fallido');
    assert.equal(fallido.Estado, 401);
    assert.ok(!filas.some((f) => String(f.Detalle).includes('clave-equivocada')), 'la clave no se guarda');
  });

  test('registra las consultas con sus parámetros y las filas devueltas; no las sugerencias', async () => {
    await request(app).get('/api/impo/despachos?tamanio=3').set(auth()).expect(200);
    await request(app).get('/api/impo/sugerencias/ncm?q=84').set(auth()).expect(200);
    const filas = await registros(ADMIN.usuario);
    const consulta = filas.find((f) => f.Ruta === '/impo/despachos');
    assert.equal(consulta.Accion, 'consulta');
    assert.match(consulta.Detalle, /tamanio=3/);
    assert.ok(consulta.Filas <= 3);
    assert.ok(!filas.some((f) => f.Ruta.startsWith('/impo/sugerencias')), 'el autocompletado no se registra');
  });

  test('registra alta, cambio y baja de usuarios con lo que cambió (nunca la clave)', async () => {
    const r = await request(app).post('/api/auth/usuarios').set(auth()).send(otro).expect(201);
    await request(app).patch(`/api/auth/usuarios/${r.body.id}`).set(auth())
      .send({ rol: 'admin', clave: 'Otra-clave-nueva-1' }).expect(200);
    await request(app).delete(`/api/auth/usuarios/${r.body.id}`).set(auth()).expect(200);
    const filas = await registros(ADMIN.usuario);
    const de = (accion) => filas.find((f) => f.Accion === accion);
    assert.match(de('alta_usuario').Detalle, new RegExp(`${otro.usuario} \\(Lector\\), rol consulta`));
    assert.match(de('modif_usuario').Detalle, /rol consulta → admin, clave cambiada/);
    assert.match(de('baja_usuario').Detalle, new RegExp(otro.usuario));
    assert.ok(!filas.some((f) => /Clave-del-lector|Otra-clave-nueva/.test(String(f.Detalle))), 'las claves no se guardan');
  });

  test('sólo un administrador puede ver la actividad, con filtros', async () => {
    await request(app).get('/api/auditoria').expect(401);
    await auditoria.esperarPendientes();
    const r = await request(app).get('/api/auditoria')
      .query({ usuario: ADMIN.usuario, accion: 'login_fallido' }).set(auth()).expect(200);
    assert.equal(r.body.filas.length, 1);
    assert.equal(r.body.filas[0].estado, 401);
    const resumen = await request(app).get('/api/auditoria/resumen').query({ usuario: ADMIN.usuario }).set(auth()).expect(200);
    assert.equal(resumen.body[0].ingresos_fallidos, 1);
    assert.equal(resumen.body[0].cambios_usuarios, 3);
    await request(app).get('/api/auditoria').query({ accion: 'inventada' }).set(auth()).expect(400);
  });
});
