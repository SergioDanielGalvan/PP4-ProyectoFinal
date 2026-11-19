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

// ---------- lupa: palabras clave para buscar en la descripción ----------
const { terminosBusqueda } = require('../../src/utils/ncm');

test('la lupa separa palabras, frases entre comillas y exclusiones', () => {
  assert.deepEqual(terminosBusqueda('cable  cobre'), { incluir: ['cable', 'cobre'], excluir: [] });
  assert.deepEqual(terminosBusqueda('"papel higiénico" -rollos'), { incluir: ['papel higiénico'], excluir: ['rollos'] });
  assert.deepEqual(terminosBusqueda('bombas de agua -partes'), { incluir: ['bombas', 'agua'], excluir: ['partes'] },
    'las palabras de menos de 3 letras se ignoran');
});

test('la lupa pide al menos una palabra de 3 letras y no más de 6 términos', () => {
  for (const malo of ['', 'de la', '-partes', 'uno dos tres cuatro cinco seis siete']) {
    assert.throws(() => terminosBusqueda(malo), (e) => e instanceof HttpError && e.status === 400, malo);
  }
});
