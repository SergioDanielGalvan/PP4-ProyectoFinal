// Prueba de integración 8: Subpartidas con los filtros de Precios.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, pool, request, sinBase, prepararAdmin, limpiar } = require('./ayuda');

describe('Subpartidas con filtros', { skip: sinBase }, () => {
  let auth;
  let caso;
  const pedir = (query) => request(app).get('/api/impo/subpartidas').query({ limite: 1000, ...query }).set(auth);
  const suma = (r) => r.body.subpartidas.reduce((s, x) => s + Number(x.fob_usd), 0);

  before(async () => {
    await limpiar();
    auth = { Authorization: `Bearer ${await prepararAdmin()}` };
    // El capítulo con más ítems, y su origen y aduana principales
    [[caso]] = await pool.query(`
      SELECT LEFT(p.PosicionSIM, 2) AS capitulo, i.PaisOrigen AS origen, c.AduanaOficializacion AS aduana
      FROM item i JOIN posicion p ON p.IdPosicion = i.IdPosicion
      JOIN caratula c ON c.IdOperacion = i.IdOperacion AND c.Periodo = i.Periodo
      GROUP BY capitulo, origen, aduana ORDER BY COUNT(*) DESC LIMIT 1`);
  });
  after(async () => { await limpiar(); await pool.end(); });

  test('sin filtros suma lo mismo que la base para el capítulo', async () => {
    const [[base]] = await pool.query(`
      SELECT SUM(i.FobTotalDolares) AS fob FROM item i JOIN posicion p ON p.IdPosicion = i.IdPosicion
      WHERE p.PosicionSIM LIKE ?`, [`${caso.capitulo}%`]);
    const r = await pedir({ desde: caso.capitulo }).expect(200);
    assert.equal(r.body.recortado, false, 'el capítulo entra completo (hasta 1.000 filas)');
    assert.ok(Math.abs(suma(r) - Number(base.fob)) < 0.01);
  });

  test('con origen y aduana suma lo mismo que la base con esos filtros', async () => {
    const [[base]] = await pool.query(`
      SELECT SUM(i.FobTotalDolares) AS fob FROM item i JOIN posicion p ON p.IdPosicion = i.IdPosicion
      JOIN caratula c ON c.IdOperacion = i.IdOperacion AND c.Periodo = i.Periodo
      WHERE p.PosicionSIM LIKE ? AND i.PaisOrigen = ? AND c.AduanaOficializacion = ?`, [`${caso.capitulo}%`, caso.origen, caso.aduana]);
    const r = await pedir({ desde: caso.capitulo, origenes: caso.origen, aduanas: caso.aduana }).expect(200);
    assert.ok(Math.abs(suma(r) - Number(base.fob)) < 0.01);
    assert.ok(r.body.subpartidas.every((x) => x.paises_origen === 1), 'un solo país de origen en cada fila');
  });

  test('el rango de períodos y la región se aplican, y los filtros mal escritos dan 400', async () => {
    const [[per]] = await pool.query('SELECT MIN(Periodo) AS p FROM item');
    const [[base]] = await pool.query(`
      SELECT SUM(i.FobTotalDolares) AS fob FROM item i JOIN posicion p ON p.IdPosicion = i.IdPosicion
      WHERE p.PosicionSIM LIKE ? AND i.Periodo BETWEEN ? AND ? AND i.PaisProcedencia LIKE ?`,
    [`${caso.capitulo}%`, per.p, per.p, `${caso.origen[0]}%`]);
    const r = await pedir({ desde: caso.capitulo, periodo_desde: per.p, periodo_hasta: per.p, region: caso.origen[0] }).expect(200);
    assert.ok(Math.abs(suma(r) - Number(base.fob || 0)) < 0.01);
    await pedir({ desde: caso.capitulo, region: 'A' }).expect(400);
    await pedir({ desde: caso.capitulo, origenes: '31' }).expect(400);
    await pedir({ desde: caso.capitulo, periodo_desde: '202609', periodo_hasta: '202606' }).expect(400);
  });
});
