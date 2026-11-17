// Borrado de un período en tandas, con una base simulada (no toca ninguna base real)
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const borrado = require('../../src/services/borrarPeriodo');
const { periodoValido } = require('../../src/controllers/periodos.controller');
const pool = require('../../src/config/db');

after(() => pool.end());   // el controlador abre el pool al cargarse

// Base simulada: cada tabla tiene N filas del período; DELETE ... LIMIT borra hasta el límite
function baseSimulada(filas, { fallaEn } = {}) {
  const pedidos = [];
  return {
    pedidos,
    query: async (sql, [periodo, lote]) => {
      const tabla = /DELETE FROM `(\w+)`/.exec(sql)[1];
      pedidos.push({ tabla, periodo, lote });
      if (tabla === fallaEn) throw new Error('se cortó la conexión');
      const n = Math.min(filas[tabla], lote);
      filas[tabla] -= n;
      return [{ affectedRows: n }];
    },
  };
}

test('sólo la liquidación: borra en tandas hasta vaciarla y no toca ítems ni carátulas', async () => {
  borrado._reiniciar();
  const filas = { liq: 25, item: 10, caratula: 3 };
  const base = baseSimulada(filas);
  const r = await borrado.iniciar({ pool: base, periodo: 202607, alcance: 'liq', usuario: 'ana', lote: 10 });
  assert.equal(r.estado, 'terminado');
  assert.deepEqual(r.borradas, { liq: 25 });
  assert.deepEqual(filas, { liq: 0, item: 10, caratula: 3 });
  assert.deepEqual(base.pedidos.map((p) => p.tabla), ['liq', 'liq', 'liq'], 'tres tandas: 10, 10 y 5');
  assert.ok(base.pedidos.every((p) => p.periodo === 202607 && p.lote === 10));
});

test('período completo: liquidación, ítems y carátulas, en ese orden', async () => {
  borrado._reiniciar();
  const filas = { liq: 12, item: 10, caratula: 3 };
  const base = baseSimulada(filas);
  let alTerminar = null;
  const r = await borrado.iniciar({ pool: base, periodo: 202606, alcance: 'todo', usuario: 'ana', lote: 10, alTerminar: (t) => { alTerminar = t; } });
  assert.deepEqual(r.borradas, { liq: 12, item: 10, caratula: 3 });
  assert.deepEqual(filas, { liq: 0, item: 0, caratula: 0 });
  const orden = base.pedidos.map((p) => p.tabla).filter((t, i, a) => t !== a[i - 1]);
  assert.deepEqual(orden, ['liq', 'item', 'caratula']);
  assert.equal(alTerminar.estado, 'terminado', 'avisa al terminar (para vaciar las cachés)');
});

test('hay un solo borrado a la vez; si falla, queda el error y lo ya borrado', async () => {
  borrado._reiniciar();
  const lenta = { query: () => new Promise((ok) => setTimeout(() => ok([{ affectedRows: 0 }]), 30)) };
  const primero = borrado.iniciar({ pool: lenta, periodo: 202606, alcance: 'liq', usuario: 'ana' });
  assert.ok(borrado.enCurso());
  assert.throws(() => borrado.iniciar({ pool: lenta, periodo: 202607, alcance: 'liq', usuario: 'ana' }), /en curso \(202606\)/);
  await primero;

  const filas = { liq: 5, item: 10, caratula: 3 };
  const r = await borrado.iniciar({ pool: baseSimulada(filas, { fallaEn: 'item' }), periodo: 202606, alcance: 'todo', usuario: 'ana', lote: 10 });
  assert.equal(r.estado, 'error');
  assert.match(r.error, /se cortó/);
  assert.equal(r.borradas.liq, 5);
  assert.equal(filas.caratula, 3, 'si falló en los ítems, las carátulas siguen');
  assert.equal(borrado.enCurso(), false, 'después de un error se puede volver a intentar');
});

test('el período va con formato AAAAMM y un mes válido', () => {
  assert.equal(periodoValido('202607'), 202607);
  for (const malo of ['20267', '2026-07', '202613', '202600', '', undefined]) {
    assert.throws(() => periodoValido(malo), { status: 400 }, String(malo));
  }
});
