// Prueba de integración 5: grilla de importadores y despachos de un importador.
// Compara lo que devuelve la API con lo que se cuenta directo en la base.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, pool, request, sinBase, prepararAdmin, limpiar } = require('./ayuda');

describe('Grilla de importadores', { skip: sinBase }, () => {
  let auth;
  const pedir = (ruta, query) => request(app).get(`/api/impo${ruta}`).query(query || {}).set(auth);

  before(async () => {
    await limpiar();
    auth = { Authorization: `Bearer ${await prepararAdmin()}` };
  });
  after(async () => { await limpiar(); await pool.end(); });

  test('el ranking cuenta los mismos importadores y el mismo FOB que la base', async () => {
    const [[base]] = await pool.query(`
      SELECT COUNT(DISTINCT c.IdImportador) AS importadores, SUM(i.FobTotalDolares) AS fob
      FROM caratula c JOIN item i ON i.IdOperacion = c.IdOperacion AND i.Periodo = c.Periodo`);
    const r = await pedir('/importadores/ranking', { limite: 100000 }).expect(200);
    assert.equal(r.body.total, Number(base.importadores));
    assert.ok(Math.abs(r.body.total_fob - Number(base.fob)) < 0.01);
    const suma = r.body.filas.reduce((s, f) => s + f.fob_usd, 0);
    assert.ok(Math.abs(suma - Number(base.fob)) < 0.01, 'la suma de las filas es el FOB total');
    const participacion = r.body.filas.reduce((s, f) => s + f.participacion, 0);
    assert.ok(Math.abs(participacion - 1) < 1e-9, 'las participaciones suman 100 %');
  });

  test('por defecto ordena por FOB de mayor a menor, y por nombre cuando se pide', async () => {
    const fob = (await pedir('/importadores/ranking').expect(200)).body.filas.map((f) => f.fob_usd);
    assert.deepEqual(fob, [...fob].sort((a, b) => b - a));
    const nombres = (await pedir('/importadores/ranking', { orden: 'nombre', dir: 'asc' }).expect(200)).body.filas.map((f) => f.nombre);
    assert.deepEqual(nombres, [...nombres].sort((a, b) => a.localeCompare(b, 'es')));
    await pedir('/importadores/ranking', { orden: 'inventado' }).expect(400);
  });

  test('la carga por partes trae todas las filas, sin repetir ni saltear ninguna', async () => {
    const completa = (await pedir('/importadores/ranking', { limite: 100000 }).expect(200)).body.filas.map((f) => f.id);
    const parte = Math.max(2, Math.ceil(completa.length / 20));   // unas 20 partes, aunque la base sea grande
    const partes = [];
    for (let desde = 0; desde < completa.length; desde += parte) {
      partes.push(...(await pedir('/importadores/ranking', { desde, limite: parte }).expect(200)).body.filas.map((f) => f.id));
    }
    assert.deepEqual(partes, completa);
  });

  test('Buscar con un texto deja sólo los importadores que lo contienen', async () => {
    const [[uno]] = await pool.query('SELECT Nombre FROM importadores ORDER BY IdImportador LIMIT 1');
    const texto = uno.Nombre.slice(0, 4).toLowerCase();
    const r = await pedir('/importadores/ranking', { q: texto, limite: 100000 }).expect(200);
    assert.ok(r.body.filas.length >= 1);
    assert.ok(r.body.filas.every((f) => f.nombre.toLowerCase().includes(texto)));
  });

  test('los despachos de un importador coinciden con la base y se cargan por partes', async () => {
    const [[imp]] = await pool.query(`
      SELECT c.IdImportador AS id, COUNT(DISTINCT c.IdOperacion) AS despachos, SUM(i.FobTotalDolares) AS fob
      FROM caratula c JOIN item i ON i.IdOperacion = c.IdOperacion AND i.Periodo = c.Periodo
      GROUP BY c.IdImportador ORDER BY despachos DESC LIMIT 1`);
    const r = await pedir(`/importadores/${imp.id}/despachos`, { limite: 100000 }).expect(200);
    assert.equal(r.body.total, Number(imp.despachos));
    assert.equal(r.body.filas.length, Number(imp.despachos));
    assert.ok(Math.abs(r.body.importador.fob_usd - Number(imp.fob)) < 0.01);
    const primera = await pedir(`/importadores/${imp.id}/despachos`, { limite: 1, orden: 'fob' }).expect(200);
    assert.equal(primera.body.filas[0].fob_usd, Math.max(...r.body.filas.map((f) => f.fob_usd)), 'orden por FOB');
    await pedir('/importadores/99999999/despachos').expect(404);
    await pedir('/importadores/abc/despachos').expect(400);
  });
});
