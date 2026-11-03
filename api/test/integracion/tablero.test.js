// Prueba de integración 7: tablero de importaciones.
// Compara los indicadores y rankings con sumas hechas directo en SQL.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, pool, request, sinBase, prepararAdmin, limpiar } = require('./ayuda');

const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

describe('Tablero', { skip: sinBase }, () => {
  let auth;
  const pedir = (query) => request(app).get('/api/impo/tablero').query(query || {}).set(auth);

  before(async () => {
    await limpiar();
    auth = { Authorization: `Bearer ${await prepararAdmin()}` };
  });
  after(async () => { await limpiar(); await pool.end(); });

  // Por defecto el tablero deja afuera las destinaciones de los grupos sin PorDefecto (REDES, AAE)
  const SIN_EXCLUIDOS = `c.Destinacion NOT IN (SELECT gd.Destinacion FROM grupo_destinacion gd
    JOIN grupo g ON g.Codigo = gd.Grupo WHERE g.PorDefecto = 0)`;

  test('los indicadores coinciden con la base', async () => {
    const [[base]] = await pool.query(`
      SELECT SUM(i.FobTotalDolares) AS fob, COUNT(DISTINCT i.IdOperacion, i.Periodo) AS despachos,
             COUNT(DISTINCT c.IdImportador) AS importadores, COUNT(DISTINCT i.PaisOrigen) AS paises
      FROM item i JOIN caratula c ON c.IdOperacion = i.IdOperacion AND c.Periodo = i.Periodo
      WHERE ${SIN_EXCLUIDOS}`);
    const k = (await pedir().expect(200)).body.indicadores;
    assert.ok(cerca(k.fob, base.fob));
    assert.equal(k.despachos, Number(base.despachos));
    assert.equal(k.importadores, Number(base.importadores));
    assert.equal(k.paises, Number(base.paises));
  });

  test('países: hasta 10 más el resto, y las participaciones suman 100 %', async () => {
    const d = (await pedir().expect(200)).body;
    assert.ok(d.paises.filter((p) => p.codigo).length <= 10);
    const total = d.paises.reduce((s, p) => s + p.participacion, 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
    const fob = d.paises.reduce((s, p) => s + p.fob, 0);
    assert.ok(cerca(fob, d.indicadores.fob), 'los países suman el FOB total');
  });

  test('los meses suman el total, y con un período los indicadores son los de ese mes', async () => {
    const d = (await pedir().expect(200)).body;
    assert.ok(cerca(d.meses.reduce((s, m) => s + Number(m.fob), 0), d.indicadores.fob));
    const mes = d.meses[d.meses.length - 1];
    const m = (await pedir({ periodo: mes.periodo }).expect(200)).body;
    assert.ok(cerca(m.indicadores.fob, mes.fob));
    assert.equal(m.meses.length, d.meses.length, 'la evolución mensual no se corta por el período');
  });

  test('con país y NCM, los números son los de la base con esos filtros', async () => {
    const [[uno]] = await pool.query(`
      SELECT i.PaisOrigen AS pais, LEFT(REPLACE(p.PosicionSIM, '.', ''), 4) AS partida
      FROM item i JOIN posicion p ON p.IdPosicion = i.IdPosicion
      GROUP BY i.PaisOrigen, partida ORDER BY SUM(i.FobTotalDolares) DESC LIMIT 1`);
    const [[base]] = await pool.query(`
      SELECT SUM(i.FobTotalDolares) AS fob, COUNT(DISTINCT i.IdOperacion, i.Periodo) AS despachos
      FROM item i JOIN posicion p ON p.IdPosicion = i.IdPosicion
      JOIN caratula c ON c.IdOperacion = i.IdOperacion AND c.Periodo = i.Periodo
      WHERE i.PaisOrigen = ? AND p.PosicionSIM LIKE ? AND ${SIN_EXCLUIDOS}`, [uno.pais, `${uno.partida}%`]);
    const d = (await pedir({ pais: uno.pais, ncm: uno.partida }).expect(200)).body;
    assert.ok(cerca(d.indicadores.fob, base.fob));
    assert.equal(d.indicadores.despachos, Number(base.despachos));
    assert.ok(d.ncm.every((n) => n.ncm.replace(/\./g, '').startsWith(uno.partida)));

    // La lista de despachos con los mismos filtros (lo que abre un clic en el tablero)
    const grupos = d.grupos.filter((g) => g.incluido).map((g) => g.codigo).join(',');
    const lista = await request(app).get('/api/impo/despachos').query({ ncm: uno.partida, origen: uno.pais, grupos, tamanio: 1 }).set(auth).expect(200);
    assert.equal(lista.body.total, Number(base.despachos));
  });

  test('grupos de destinación: por defecto sin energía por redes ni AAE; con todos, suma todo', async () => {
    const def = (await pedir().expect(200)).body;
    assert.deepEqual(def.grupos.filter((g) => !g.incluido).map((g) => g.codigo).sort(), ['AAE', 'REDES']);
    const todos = def.grupos.map((g) => g.codigo).join(',');
    const [[base]] = await pool.query('SELECT SUM(FobTotalDolares) AS fob FROM item');
    const t = (await pedir({ grupos: todos }).expect(200)).body;
    assert.ok(cerca(t.indicadores.fob, base.fob), 'con todos los grupos suma todo el archivo');
    const [[redes]] = await pool.query(`
      SELECT COALESCE(SUM(i.FobTotalDolares), 0) AS fob FROM item i
      JOIN caratula c ON c.IdOperacion = i.IdOperacion AND c.Periodo = i.Periodo
      JOIN grupo_destinacion gd ON gd.Destinacion = c.Destinacion WHERE gd.Grupo = 'REDES'`);
    const r = (await pedir({ grupos: 'REDES' }).expect(200)).body;
    assert.ok(cerca(r.indicadores.fob, redes.fob), 'sólo energía por redes');
    await pedir({ grupos: 'consumo;temp' }).expect(400);
  });

  test('rechaza códigos mal escritos (400)', async () => {
    assert.match((await pedir({ ncm: '847' }).expect(400)).body.error, /capítulo/);
    await pedir({ pais: '31' }).expect(400);
    await request(app).get('/api/impo/despachos').query({ origen: 'CHN' }).set(auth).expect(400);
  });
});
