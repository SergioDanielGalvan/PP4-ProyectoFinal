// Prueba de integración 6: lista de despachos con filtros, orden y carga por partes.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, pool, request, sinBase, prepararAdmin, limpiar } = require('./ayuda');

describe('Lista de despachos', { skip: sinBase }, () => {
  let auth;
  const pedir = (query) => request(app).get('/api/impo/despachos').query(query).set(auth);

  before(async () => {
    await limpiar();
    auth = { Authorization: `Bearer ${await prepararAdmin()}` };
  });
  after(async () => { await limpiar(); await pool.end(); });

  test('el filtro por año y aduana cuenta lo mismo que la base', async () => {
    const [[uno]] = await pool.query('SELECT AnioRegistro AS anio, AduanaOficializacion AS aduana FROM caratula LIMIT 1');
    const [[base]] = await pool.query('SELECT COUNT(*) AS n FROM caratula WHERE AnioRegistro = ? AND AduanaOficializacion = ?', [uno.anio, uno.aduana]);
    const r = await pedir({ anio: uno.anio, aduana: uno.aduana, tamanio: 100 }).expect(200);
    assert.equal(r.body.total, Number(base.n));
    assert.ok(r.body.resultados.every((d) => d.nro_despacho.startsWith(`${uno.anio}${uno.aduana}`)));
    const [[soloAduana]] = await pool.query('SELECT COUNT(*) AS n FROM caratula WHERE AduanaOficializacion = ?', [uno.aduana]);
    assert.equal((await pedir({ aduana: uno.aduana }).expect(200)).body.total, Number(soloAduana.n));
  });

  test('ordena por número de despacho de mayor a menor y cambia de sentido', async () => {
    const desc = (await pedir({ orden: 'despacho', tamanio: 50 }).expect(200)).body.resultados.map((d) => d.nro_despacho);
    assert.deepEqual(desc, [...desc].sort().reverse());
    const asc = (await pedir({ orden: 'despacho', dir: 'asc', tamanio: 50 }).expect(200)).body.resultados.map((d) => d.nro_despacho);
    assert.deepEqual(asc, [...asc].sort());
  });

  test('las páginas siguientes no repiten ni saltean despachos', async () => {
    const total = (await pedir({ orden: 'despacho', tamanio: 1 }).expect(200)).body.total;
    const tamanio = Math.max(2, Math.ceil(Math.min(total, 400) / 8));
    const juntos = (await pedir({ orden: 'despacho', tamanio: 100 }).expect(200)).body.resultados.map((d) => d.nro_despacho);
    const partes = [];
    for (let pagina = 1; partes.length < juntos.length; pagina++) {
      const r = await pedir({ orden: 'despacho', tamanio, pagina }).expect(200);
      if (!r.body.resultados.length) break;
      partes.push(...r.body.resultados.map((d) => d.nro_despacho));
    }
    assert.deepEqual(partes.slice(0, juntos.length), juntos);
  });

  test('rechaza filtros mal escritos con un mensaje claro (400)', async () => {
    assert.match((await pedir({ anio: '2026' }).expect(400)).body.error, /2 dígitos/);
    assert.match((await pedir({ aduana: '1' }).expect(400)).body.error, /3 dígitos/);
    await pedir({ orden: 'inventado' }).expect(400);
    await pedir({ importador: 'ab' }).expect(400);
  });
});
