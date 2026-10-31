// Prueba unitaria 4: validaciones de los datos de usuario antes de guardarlos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { claveValida, nombreUsuario, rolValido } = require('../../src/controllers/auth.controller');
const pool = require('../../src/config/db');

test.after(() => pool.end());

test('normaliza el nombre de usuario a minúsculas y valida los caracteres', () => {
  assert.equal(nombreUsuario('  VMScattolini '), 'vmscattolini');
  assert.equal(nombreUsuario('a.perez_2'), 'a.perez_2');
  assert.throws(() => nombreUsuario('ab'), /3 a 40/);
  assert.throws(() => nombreUsuario('con espacio'), /3 a 40/);
  assert.throws(() => nombreUsuario(''), /3 a 40/);
});

test('exige claves de 10 a 72 caracteres', () => {
  assert.equal(claveValida('1234567890'), '1234567890');
  assert.throws(() => claveValida('corta'), /al menos 10/);
  assert.throws(() => claveValida('x'.repeat(73)), /72/);
});

test('sólo acepta los roles admin y consulta', () => {
  assert.equal(rolValido('admin'), 'admin');
  assert.equal(rolValido('consulta'), 'consulta');
  assert.throws(() => rolValido('root'), /admin, consulta/);
});
