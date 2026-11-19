// Lupa: buscar NCM por palabras de su descripción, contra la base.
// Toma la NCM con más ítems cargados y la busca por la palabra más rara de su
// propia descripción: tiene que aparecer, con las mismas operaciones que la base.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, pool, request, sinBase, prepararAdmin, limpiar } = require('./ayuda');
const { partesDescripcion } = require('../../src/models/impo.model');

const plano = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

describe('Lupa: NCM por palabras de la descripción', { skip: sinBase }, () => {
  let token;
  let caso;       // { ncm, items, palabra }

  before(async () => {
    await limpiar();
    token = await prepararAdmin();
    const [[top]] = await pool.query(`
      SELECT p.PosicionSIM AS ncm, p.DescripcionNCM AS descripcion, COUNT(*) AS items
      FROM item i JOIN posicion p ON p.IdPosicion = i.IdPosicion
      GROUP BY p.IdPosicion, p.PosicionSIM, p.DescripcionNCM ORDER BY items DESC LIMIT 1`);
    assert.ok(top, 'la base tiene que tener al menos un mes cargado (o los datos de prueba)');
    // La palabra de su propia descripción que aparece en menos posiciones
    const palabras = [...new Set(partesDescripcion(top.descripcion).propia.match(/[\p{L}]{5,}/gu) || [])];
    let mejor = null;
    for (const palabra of palabras) {
      const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM posicion WHERE DescripcionNCM LIKE ?', [`%${palabra}%`]);
      if (!mejor || c.n < mejor.n) mejor = { palabra, n: Number(c.n) };
    }
    assert.ok(mejor, 'la NCM tiene alguna palabra de 5 letras o más');
    caso = { ncm: top.ncm, items: Number(top.items), palabra: mejor.palabra };
  });
  after(async () => { await limpiar(); await pool.end(); });

  const buscar = (query) => request(app).get('/api/impo/ncm/buscar').set('Authorization', `Bearer ${token}`).query(query);

  test('encuentra la NCM por una palabra de su descripción, con las mismas operaciones que la base', async () => {
    const r = await buscar({ q: caso.palabra, solo_importadas: '1' }).expect(200);
    const fila = r.body.resultados.find((x) => x.ncm === caso.ncm);
    assert.ok(fila, `${caso.ncm} aparece buscando "${caso.palabra}"`);
    assert.equal(fila.items, caso.items);
    assert.ok(fila.relevancia >= 1, 'la palabra está en su propia descripción');
    assert.ok(r.body.resultados.every((x) => x.items > 0), '"sólo importadas" deja sólo posiciones con ítems');
  });

  test('sin acentos ni mayúsculas encuentra lo mismo', async () => {
    const con = await buscar({ q: caso.palabra }).expect(200);
    const sin = await buscar({ q: plano(caso.palabra).toUpperCase() }).expect(200);
    assert.equal(sin.body.coincidencias, con.body.coincidencias);
  });

  test('todas las palabras tienen que estar, y la que lleva guion no', async () => {
    const r = await buscar({ q: 'para los -demas' }).expect(200);
    for (const x of r.body.resultados) {
      const texto = plano(`${x.descripcion} ${x.contexto}`);
      assert.ok(texto.includes('para') && texto.includes('los'), x.ncm);
      assert.ok(!texto.includes('demas'), `${x.ncm} no tiene "demás"`);
    }
  });

  test('una búsqueda sin palabras de 3 letras da 400', async () => {
    const r = await buscar({ q: 'de la' }).expect(400);
    assert.match(r.body.error, /3 letras/);
  });
});
