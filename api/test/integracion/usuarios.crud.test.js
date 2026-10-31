// Prueba de integración 1: CRUD de usuarios de punta a punta.
// Recorre API (rutas + middleware JWT + controlador + validaciones) y
// verifica cada paso directamente en la tabla usuarios de la base.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, pool, request, PREFIJO, sufijo, sinBase, prepararAdmin, limpiar } = require('./ayuda');

const filaDe = async (usuario) => {
  const [[fila]] = await pool.query('SELECT Usuario, Nombre, Rol, Activo, UltimoIngreso FROM usuarios WHERE Usuario = ?', [usuario]);
  return fila;
};

describe('CRUD de usuarios', { skip: sinBase }, () => {
  let token;
  const nuevo = { usuario: `${PREFIJO}ana_${sufijo}`, nombre: 'Ana Prueba', clave: 'Clave-de-prueba-1', rol: 'consulta' };
  let idNuevo;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  before(async () => { await limpiar(); token = await prepararAdmin(); });
  after(async () => { await limpiar(); await pool.end(); });

  test('sin token no se puede administrar usuarios (401)', async () => {
    await request(app).get('/api/auth/usuarios').expect(401);
  });

  test('CREATE: el alta queda guardada en la base', async () => {
    const r = await request(app).post('/api/auth/usuarios').set(auth()).send(nuevo).expect(201);
    idNuevo = r.body.id;
    assert.equal(r.body.usuario, nuevo.usuario);
    assert.equal(r.body.clave_hash, undefined, 'la API nunca devuelve el hash de la clave');
    const fila = await filaDe(nuevo.usuario);
    assert.equal(fila.Nombre, 'Ana Prueba');
    assert.equal(fila.Rol, 'consulta');
    assert.equal(fila.Activo, 1);
  });

  test('CREATE: rechaza el usuario duplicado (409) y el nombre vacío (400)', async () => {
    const dup = await request(app).post('/api/auth/usuarios').set(auth()).send(nuevo).expect(409);
    assert.match(dup.body.error, /Ya existe/);
    const vacio = await request(app).post('/api/auth/usuarios').set(auth())
      .send({ ...nuevo, usuario: `${PREFIJO}vacio_${sufijo}`, nombre: '' }).expect(400);
    assert.match(vacio.body.error, /nombre/);
    assert.equal(await filaDe(`${PREFIJO}vacio_${sufijo}`), undefined, 'no se guardó nada');
  });

  test('READ: la lista incluye el usuario creado', async () => {
    const r = await request(app).get('/api/auth/usuarios').set(auth()).expect(200);
    assert.ok(r.body.some((u) => u.usuario === nuevo.usuario));
  });

  test('UPDATE: el cambio de nombre y de clave se guarda y la clave nueva sirve para ingresar', async () => {
    await request(app).patch(`/api/auth/usuarios/${idNuevo}`).set(auth())
      .send({ nombre: 'Ana Modificada', clave: 'Clave-nueva-456' }).expect(200);
    assert.equal((await filaDe(nuevo.usuario)).Nombre, 'Ana Modificada');
    await request(app).post('/api/auth/login').send({ usuario: nuevo.usuario, clave: nuevo.clave }).expect(401);
    const login = await request(app).post('/api/auth/login').send({ usuario: nuevo.usuario, clave: 'Clave-nueva-456' }).expect(200);
    assert.equal(login.body.usuario.rol, 'consulta');
    assert.ok((await filaDe(nuevo.usuario)).UltimoIngreso, 'el login registró el ingreso');

    // Un usuario de consulta no puede administrar usuarios
    await request(app).get('/api/auth/usuarios').set({ Authorization: `Bearer ${login.body.token}` }).expect(403);
  });

  test('DELETE: un usuario que ya ingresó no se elimina (409); se desactiva', async () => {
    const r = await request(app).delete(`/api/auth/usuarios/${idNuevo}`).set(auth()).expect(409);
    assert.match(r.body.error, /se desactiva/);
    await request(app).patch(`/api/auth/usuarios/${idNuevo}`).set(auth()).send({ activo: false }).expect(200);
    assert.equal((await filaDe(nuevo.usuario)).Activo, 0);
    await request(app).post('/api/auth/login').send({ usuario: nuevo.usuario, clave: 'Clave-nueva-456' }).expect(401);
  });

  test('DELETE: un usuario que nunca ingresó se elimina de la base', async () => {
    const otro = { usuario: `${PREFIJO}borrar_${sufijo}`, nombre: 'Para borrar', clave: 'Clave-de-prueba-1' };
    const alta = await request(app).post('/api/auth/usuarios').set(auth()).send(otro).expect(201);
    await request(app).delete(`/api/auth/usuarios/${alta.body.id}`).set(auth()).expect(200);
    assert.equal(await filaDe(otro.usuario), undefined);
    await request(app).delete(`/api/auth/usuarios/${alta.body.id}`).set(auth()).expect(404);
  });
});
