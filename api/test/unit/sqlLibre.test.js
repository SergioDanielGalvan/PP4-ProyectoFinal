// Prueba unitaria 3: control del SQL libre (sólo admin). Tiene que dejar pasar
// consultas de lectura y frenar cualquier intento de modificar o de leer claves.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validarSqlLibre } = require('../../src/models/consultas.model');
const pool = require('../../src/config/db');

test.after(() => pool.end());   // el modelo crea el pool al cargarse; no se usa acá

test('permite consultas de lectura', () => {
  for (const sql of ['SELECT 1', 'select * from caratula limit 5;', 'WITH t AS (SELECT 1) SELECT * FROM t', 'SHOW TABLES', 'EXPLAIN SELECT 1']) {
    assert.doesNotThrow(() => validarSqlLibre(sql), sql);
  }
});

test('rechaza sentencias que modifican datos', () => {
  for (const sql of ['DELETE FROM caratula', 'UPDATE item SET Item = 1', 'DROP TABLE liq', 'INSERT INTO paises VALUES (1)']) {
    assert.throws(() => validarSqlLibre(sql), /Sólo se permiten consultas de lectura/, sql);
  }
});

test('rechaza dos sentencias juntas, aunque la segunda esté después de un comentario', () => {
  assert.throws(() => validarSqlLibre('SELECT 1; DELETE FROM caratula'), /Una sola sentencia/);
  assert.throws(() => validarSqlLibre('SELECT 1 /* x */; DROP TABLE liq'), /Una sola sentencia/);
});

test('rechaza leer la tabla de usuarios y las funciones peligrosas', () => {
  assert.throws(() => validarSqlLibre('SELECT * FROM usuarios'), /tabla usuarios/);
  assert.throws(() => validarSqlLibre('SELECT SLEEP(10)'), /espera/);
  assert.throws(() => validarSqlLibre("SELECT LOAD_FILE('/etc/passwd')"), /archivo/);
  assert.throws(() => validarSqlLibre("SELECT 1 INTO OUTFILE '/tmp/x'"), /OUTFILE/);
});

test('rechaza una consulta vacía', () => {
  assert.throws(() => validarSqlLibre('   '), /Falta la consulta/);
});
