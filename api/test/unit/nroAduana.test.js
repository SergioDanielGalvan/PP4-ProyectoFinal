// Prueba unitaria 1: dígito verificador del número de despacho.
// Los casos válidos son despachos reales del archivo de ARCA (09/2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const { digitoVerificador, validarNroAduana } = require('../../src/utils/nroAduana');

test('calcula la letra verificadora de despachos reales', () => {
  const reales = ['26001IC04187014Z', '26052IC04010280M', '26073IC04097519M', '26038IC04010660S'];
  for (const nro of reales) {
    assert.equal(digitoVerificador(nro.slice(0, 15)), nro[15], nro);
  }
});

test('acepta el número completo y completa la letra si falta', () => {
  assert.deepEqual(validarNroAduana('26001IC04187014Z'), { valido: true, nro: '26001IC04187014Z' });
  assert.deepEqual(validarNroAduana('26001ic04187014'), { valido: true, nro: '26001IC04187014Z' });
});

test('rechaza una letra verificadora equivocada e indica la correcta', () => {
  const r = validarNroAduana('26001IC04187014A');
  assert.equal(r.valido, false);
  assert.match(r.motivo, /corresponde la letra Z/);
});

test('rechaza largo, año, aduana o número mal formados', () => {
  assert.equal(validarNroAduana('').valido, false);
  assert.equal(validarNroAduana('26001IC0418701').valido, false);   // 14 caracteres
  assert.match(validarNroAduana('2X001IC04187014').motivo, /año/);
  assert.match(validarNroAduana('26A01IC04187014').motivo, /Aduana/);
  assert.match(validarNroAduana('26001IC0418701X').motivo, /Número/);
});
