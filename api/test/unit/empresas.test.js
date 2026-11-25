// Validación del CUIT de una empresa (11 dígitos y dígito verificador)
const test = require('node:test');
const assert = require('node:assert/strict');
const { cuitValido } = require('../../src/controllers/empresas.controller');
const pool = require('../../src/config/db');

test.after(() => pool.end());   // el controlador abre el pool al cargarse

test('acepta un CUIT válido, con o sin guiones, y lo guarda sin guiones', () => {
  assert.equal(cuitValido('30-71234567-1'), '30712345671');
  assert.equal(cuitValido('20123456786'), '20123456786');
  assert.equal(cuitValido(''), null, 'el CUIT es opcional');
});

test('rechaza un CUIT mal escrito o con el dígito verificador equivocado', () => {
  for (const malo of ['30-7123456-1', '3071234567X', '30-71234567-2']) {
    assert.throws(() => cuitValido(malo), { status: 400 }, malo);
  }
});
