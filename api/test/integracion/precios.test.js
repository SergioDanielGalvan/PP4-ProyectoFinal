// Prueba de integración 2: lo que muestra la pantalla de Precios coincide con
// la base. Toma la partida con más ítems cargados y compara los totales de la
// API (con y sin filtro de origen) contra una suma hecha directo en SQL.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, pool, request, sinBase, prepararAdmin, limpiar } = require('./ayuda');

const redondo = (n) => Math.round(Number(n) * 100) / 100;

describe('Precios por partida contra la base', { skip: sinBase }, () => {
  let token;
  let partida;
  let origen;

  before(async () => {
    await limpiar();
    token = await prepararAdmin();
    const [[top]] = await pool.query(`
      SELECT p.Partida AS partida, i.PaisOrigen AS origen, COUNT(*) AS n
      FROM item i JOIN posicion p ON p.IdPosicion = i.IdPosicion
      GROUP BY p.Partida, i.PaisOrigen ORDER BY n DESC LIMIT 1`);
    assert.ok(top, 'la base tiene que tener al menos un mes cargado (o los datos de prueba)');
    ({ partida, origen } = top);
  });
  after(async () => { await limpiar(); await pool.end(); });

  const sumaSql = async (filtroOrigen) => {
    const [[r]] = await pool.query(`
      SELECT COUNT(*) AS items, SUM(i.FobTotalDolares) AS fob
      FROM item i JOIN posicion p ON p.IdPosicion = i.IdPosicion
      WHERE p.Partida = ?${filtroOrigen ? ' AND i.PaisOrigen = ?' : ''}`, filtroOrigen ? [partida, origen] : [partida]);
    return { items: Number(r.items), fob: redondo(r.fob) };
  };
  const sumaApi = (origenes) => ({
    items: origenes.reduce((s, o) => s + o.items, 0),
    fob: redondo(origenes.reduce((s, o) => s + o.fob_usd, 0)),
  });

  test('la partida completa suma lo mismo en la API y en la base', async () => {
    const r = await request(app).get(`/api/impo/ncm/${partida}/precios`).set({ Authorization: `Bearer ${token}` }).expect(200);
    assert.equal(r.body.nivel, 'partida');
    assert.deepEqual(sumaApi(r.body.origenes), await sumaSql(false));
  });

  test('el filtro por país de origen devuelve sólo ese origen y la misma suma', async () => {
    const r = await request(app).get(`/api/impo/ncm/${partida}/precios?origenes=${origen}`)
      .set({ Authorization: `Bearer ${token}` }).expect(200);
    assert.ok(r.body.origenes.every((o) => o.pais_origen === origen));
    assert.deepEqual(sumaApi(r.body.origenes), await sumaSql(true));
  });

  test('un código incompleto se rechaza con un mensaje claro (400)', async () => {
    const r = await request(app).get('/api/impo/ncm/84713/precios').set({ Authorization: `Bearer ${token}` }).expect(400);
    assert.match(r.body.error, /partida completa/);
  });
});
