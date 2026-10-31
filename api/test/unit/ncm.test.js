// Prueba unitaria 2: validación de códigos NCM (partida, subpartida, NCM y rangos).
const test = require('node:test');
const assert = require('node:assert/strict');
const { ncmNormalizada, rangoNcm } = require('../../src/utils/ncm');
const { HttpError } = require('../../src/middlewares/errors');

test('acepta partida, subpartida y NCM completas, con o sin puntos', () => {
  assert.equal(ncmNormalizada('8471'), '8471');
  assert.equal(ncmNormalizada('8471.30'), '847130');
  assert.equal(ncmNormalizada('8471.30.12'), '84713012');
  assert.equal(ncmNormalizada('84713012'), '84713012');
});

test('rechaza códigos incompletos con un error 400', () => {
  for (const malo of ['847', '84713', '8471301', '847130121', 'abcd', '']) {
    assert.throws(() => ncmNormalizada(malo), (err) => err instanceof HttpError && err.status === 400, malo);
  }
});

test('arma el rango completando con 0 y con 9', () => {
  assert.deepEqual(rangoNcm('84'), { desde: '84000000', hasta: '84999999' });
  assert.deepEqual(rangoNcm('8471', '8473'), { desde: '84710000', hasta: '84739999' });
  assert.deepEqual(rangoNcm('8471.30'), { desde: '84713000', hasta: '84713099' });
});

test('rechaza un rango invertido', () => {
  assert.throws(() => rangoNcm('8473', '8471'), /menor o igual/);
});
