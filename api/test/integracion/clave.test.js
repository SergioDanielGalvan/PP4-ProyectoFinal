// Prueba de integración 4: cada usuario cambia su propia clave.
// Verifica la regla de la clave actual, el cambio en la base y que las
// sesiones abiertas con la clave anterior dejan de valer.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { app, pool, request, PREFIJO, sufijo, sinBase, prepararAdmin, limpiar } = require('./ayuda');

describe('Cambio de la clave propia', { skip: sinBase }, () => {
  const lector = { usuario: `${PREFIJO}clave_${sufijo}`, clave: 'Clave-inicial-123' };
  const nueva = 'Clave-cambiada-456';
  let tokenAdmin;
  let tokenViejo;     // sesión abierta antes del cambio (por ejemplo, en otra PC)
  let tokenNuevo;
  let idLector;
  const login = (usuario, clave) => request(app).post('/api/auth/login').send({ usuario, clave });
  const hashEnBase = async () => (await pool.query('SELECT ClaveHash FROM usuarios WHERE IdUsuario = ?', [idLector]))[0][0].ClaveHash;

  before(async () => {
    await limpiar();
    tokenAdmin = await prepararAdmin();
    const r = await request(app).post('/api/auth/usuarios').set({ Authorization: `Bearer ${tokenAdmin}` })
      .send({ ...lector, nombre: 'Lector de prueba' }).expect(201);
    idLector = r.body.id;
    tokenViejo = (await login(lector.usuario, lector.clave).expect(200)).body.token;
  });
  after(async () => { await limpiar(); await pool.end(); });

  test('sin sesión no se puede cambiar la clave (401)', async () => {
    await request(app).post('/api/auth/clave').send({ actual: lector.clave, nueva }).expect(401);
  });

  test('rechaza una clave actual equivocada, una nueva corta o igual a la actual (400) y no cambia nada', async () => {
    const antes = await hashEnBase();
    const auth = { Authorization: `Bearer ${tokenViejo}` };
    const mala = await request(app).post('/api/auth/clave').set(auth).send({ actual: 'no-es-la-clave', nueva }).expect(400);
    assert.match(mala.body.error, /actual no es correcta/);
    await request(app).post('/api/auth/clave').set(auth).send({ actual: lector.clave, nueva: 'corta' }).expect(400);
    const igual = await request(app).post('/api/auth/clave').set(auth).send({ actual: lector.clave, nueva: lector.clave }).expect(400);
    assert.match(igual.body.error, /distinta/);
    assert.equal(await hashEnBase(), antes, 'la clave en la base sigue igual');
  });

  test('con la clave actual correcta la cambia y devuelve un token nuevo', async () => {
    const r = await request(app).post('/api/auth/clave').set({ Authorization: `Bearer ${tokenViejo}` })
      .send({ actual: lector.clave, nueva }).expect(200);
    tokenNuevo = r.body.token;
    assert.ok(tokenNuevo);
    assert.ok(bcrypt.compareSync(nueva, await hashEnBase()), 'la base tiene el hash de la clave nueva');
    await login(lector.usuario, lector.clave).expect(401);
    await login(lector.usuario, nueva).expect(200);
  });

  test('las sesiones abiertas con la clave anterior dejan de valer; la nueva sigue', async () => {
    const vieja = await request(app).get('/api/auth/yo').set({ Authorization: `Bearer ${tokenViejo}` }).expect(401);
    assert.match(vieja.body.error, /clave cambió/);
    const r = await request(app).get('/api/auth/yo').set({ Authorization: `Bearer ${tokenNuevo}` }).expect(200);
    assert.equal(r.body.usuario, lector.usuario);
    assert.equal(r.body.huella, undefined, 'la huella de la clave no sale de la API');
  });

  test('si un administrador le resetea la clave, también se cierran sus sesiones', async () => {
    await request(app).patch(`/api/auth/usuarios/${idLector}`).set({ Authorization: `Bearer ${tokenAdmin}` })
      .send({ clave: 'Clave-del-admin-789' }).expect(200);
    await request(app).get('/api/auth/yo').set({ Authorization: `Bearer ${tokenNuevo}` }).expect(401);
    await login(lector.usuario, 'Clave-del-admin-789').expect(200);
  });
});
