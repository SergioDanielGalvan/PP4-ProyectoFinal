// Copia el resultado de la carga (MariaDB local) a la base de consulta en TiDB Cloud.
//
//   npm run tidb -- --esquema                       crea base y tablas en TiDB (db/tidb_schema.sql)
//   npm run tidb -- --fijas                         KIT + posicion (una vez, o si cambió el KIT)
//   npm run tidb -- --periodos 202607,202608        importadores + caratula/item/liq de esos meses
//   npm run tidb -- --periodos 202609 --sin-liq     sin la tabla liq (ahorra espacio y RU)
//   npm run tidb -- --periodos 202609 --reemplazar  borra el mes en TiDB y lo copia de nuevo
//                                                   (obligatorio si el mes se recargó en MariaDB)
//   npm run tidb -- --verificar 202607,202608       sólo compara cantidades de filas
//
// Origen: DB_* de .env (MariaDB). Destino: TIDB_* de .env (TLS obligatorio).
// Si se corta, volver a correr lo mismo: retoma desde el último bloque copiado.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { conectar } = require('./lib/conexion');

const FIJAS = ['aduanas', 'paises', 'via', 'unidadesmedida', 'tasas', 'divisas', 'destinaciones', 'posicion'];
const FILAS_POR_INSERT = Number(process.env.TIDB_FILAS_POR_INSERT || 5000);
const PARALELO = Number(process.env.TIDB_PARALELO || 3);
// Bloques de IdOperacion: cada bloque se copia completo antes de pasar al siguiente,
// así un corte deja a lo sumo un bloque a medias, que se repite con INSERT IGNORE.
const OPERACIONES_POR_BLOQUE = { caratula: 20000, item: 4000, liq: 400 };

// ---------------------------------------------------------------------------
function leerArgumentos(argv) {
  const a = { esquema: false, fijas: false, periodos: [], verificar: [], sinLiq: false, reemplazar: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--esquema') a.esquema = true;
    else if (x === '--fijas') a.fijas = true;
    else if (x === '--sin-liq') a.sinLiq = true;
    else if (x === '--reemplazar') a.reemplazar = true;
    else if (x === '--periodos' || x === '--verificar') {
      const lista = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
      for (const p of lista) {
        if (!/^20\d{2}(0[1-9]|1[0-2])$/.test(p)) throw new Error(`Período inválido: "${p}" (formato AAAAMM)`);
      }
      a[x === '--periodos' ? 'periodos' : 'verificar'] = lista.map(Number);
    } else throw new Error(`Opción desconocida: ${x}`);
  }
  if (!a.esquema && !a.fijas && !a.periodos.length && !a.verificar.length) {
    throw new Error('Indicar --esquema, --fijas, --periodos AAAAMM[,AAAAMM] o --verificar AAAAMM[,AAAAMM]');
  }
  return a;
}

function opcionesTidb(conBase = true) {
  for (const v of ['TIDB_HOST', 'TIDB_USER', 'TIDB_PASSWORD']) {
    if (!process.env[v]) throw new Error(`Falta ${v} en carga/.env`);
  }
  return {
    host: process.env.TIDB_HOST,
    port: Number(process.env.TIDB_PORT || 4000),
    user: process.env.TIDB_USER,
    password: process.env.TIDB_PASSWORD,
    database: conBase ? process.env.TIDB_DB || 'comex' : undefined,
    charset: 'utf8mb4',
    dateStrings: true,
    // TIDB_SSL=false sólo para probar contra un MySQL/MariaDB local; TiDB Cloud exige TLS.
    ssl: process.env.TIDB_SSL === 'false' ? undefined : { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  };
}

const n = (x) => Number(x).toLocaleString('es-AR');
const reloj = () => new Date().toLocaleTimeString('es-AR');

// Columnas reales (no generadas) de una tabla, en el orden del origen.
async function columnasBase(origen, tabla) {
  const [filas] = await origen.query(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND EXTRA NOT LIKE '%GENERATED%'
      ORDER BY ORDINAL_POSITION`, [tabla]);
  if (!filas.length) throw new Error(`La tabla ${tabla} no existe en el origen`);
  return filas.map((f) => f.c);
}

async function clavePrimaria(origen, tabla) {
  const [filas] = await origen.query(
    `SELECT COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
      ORDER BY ORDINAL_POSITION`, [tabla]);
  return filas.map((f) => f.c);
}

// Inserta filas (arrays) en lotes, varios a la vez.
async function insertarEnLotes(destino, sqlInsert, filas) {
  const lotes = [];
  for (let i = 0; i < filas.length; i += FILAS_POR_INSERT) lotes.push(filas.slice(i, i + FILAS_POR_INSERT));
  for (let i = 0; i < lotes.length; i += PARALELO) {
    await Promise.all(lotes.slice(i, i + PARALELO).map((l) => destino.query(sqlInsert, [l])));
  }
}

// ---------------------------------------------------------------------------
async function crearEsquema() {
  const archivo = path.join(__dirname, '..', 'db', 'tidb_schema.sql');
  const sentencias = fs.readFileSync(archivo, 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
  const tidb = await mysql.createConnection(opcionesTidb(false));
  try {
    for (const s of sentencias) {
      await tidb.query(s);
      const m = s.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
      if (m) console.log(`  tabla ${m[1]}`);
    }
    console.log('Esquema listo en TiDB.');
  } finally {
    await tidb.end();
  }
}

// Tablas sin período: se copian enteras y se actualizan si cambiaron.
async function copiarTablaCompleta(origen, destino, tabla) {
  const cols = await columnasBase(origen, tabla);
  const pk = await clavePrimaria(origen, tabla);
  const resto = cols.filter((c) => !pk.includes(c));
  const actualizar = resto.length
    ? resto.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(', ')
    : pk.map((c) => `\`${c}\` = \`${c}\``).join(', ');
  const sql = `INSERT INTO \`${tabla}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES ?
               ON DUPLICATE KEY UPDATE ${actualizar}`;
  const [filas] = await origen.query({ sql: `SELECT ${cols.map((c) => `\`${c}\``).join(', ')} FROM \`${tabla}\``, rowsAsArray: true });
  await insertarEnLotes(destino, sql, filas);
  console.log(`  ${tabla.padEnd(15)} ${n(filas.length).padStart(10)} filas`);
}

async function copiarFijas(origen, destino) {
  console.log('Tablas fijas (KIT y posiciones):');
  for (const t of FIJAS) await copiarTablaCompleta(origen, destino, t);
}

async function controlarFijas(destino) {
  const faltan = [];
  for (const t of FIJAS) {
    const [[{ c }]] = await destino.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
    if (!Number(c)) faltan.push(t);
  }
  if (faltan.length) {
    throw new Error(`En TiDB están vacías: ${faltan.join(', ')}. Correr primero: npm run tidb -- --fijas`);
  }
}

// Una tabla de hechos para un período, por bloques de IdOperacion.
async function copiarPeriodo(origen, destino, tabla, periodo, rango) {
  const cols = await columnasBase(origen, tabla);
  const lista = cols.map((c) => `\`${c}\``).join(', ');
  const pk = await clavePrimaria(origen, tabla);
  const orden = pk.filter((c) => c !== 'Periodo').map((c) => `\`${c}\``).join(', ');
  const insert = `INSERT IGNORE INTO \`${tabla}\` (${lista}) VALUES ?`;
  const paso = OPERACIONES_POR_BLOQUE[tabla];

  // Retomar: el último IdOperacion que ya está en TiDB marca el bloque a repetir.
  const [[{ ultimo }]] = await destino.query(
    `SELECT MAX(IdOperacion) AS ultimo FROM \`${tabla}\` WHERE Periodo = ?`, [periodo]);
  let desde = rango.min;
  if (ultimo != null) desde = rango.min + Math.floor((Number(ultimo) - rango.min) / paso) * paso;
  if (desde > rango.min) console.log(`  ${tabla}: retoma desde IdOperacion ${n(desde)}`);

  let copiadas = 0;
  const inicio = Date.now();
  for (let lo = desde; lo <= rango.max; lo += paso) {
    const [filas] = await origen.query({
      sql: `SELECT ${lista} FROM \`${tabla}\`
             WHERE Periodo = ? AND IdOperacion >= ? AND IdOperacion < ?
             ORDER BY ${orden}`,
      values: [periodo, lo, lo + paso],
      rowsAsArray: true,
    });
    if (filas.length) await insertarEnLotes(destino, insert, filas);
    copiadas += filas.length;
    const avance = Math.min(100, ((lo + paso - rango.min) / (rango.max - rango.min + 1)) * 100);
    const seg = (Date.now() - inicio) / 1000;
    process.stdout.write(`\r  ${tabla.padEnd(8)} ${avance.toFixed(1).padStart(5)} %  ${n(copiadas).padStart(11)} filas  ${seg.toFixed(0)} s   `);
  }
  process.stdout.write('\n');
}

// Borra un período en TiDB de a pedazos (una transacción gigante superaría los límites).
async function borrarPeriodo(destino, periodo) {
  for (const t of ['liq', 'item', 'caratula']) {
    let total = 0;
    for (;;) {
      const [r] = await destino.query(`DELETE FROM \`${t}\` WHERE Periodo = ? LIMIT 20000`, [periodo]);
      total += r.affectedRows;
      if (r.affectedRows === 0) break;
      process.stdout.write(`\r  borrando ${t.padEnd(8)} ${n(total).padStart(11)} filas   `);
    }
    if (total) process.stdout.write('\n');
  }
}

// Si el mes se recargó en MariaDB, los IdOperacion cambiaron y no se puede retomar.
async function controlarMismaCarga(origen, destino, periodo, rango) {
  const [[d]] = await destino.query(
    'SELECT MIN(IdOperacion) AS min, MAX(IdOperacion) AS max, COUNT(*) AS c FROM caratula WHERE Periodo = ?', [periodo]);
  if (!Number(d.c)) return;
  const [[o]] = await origen.query(
    'SELECT NroAduana FROM caratula WHERE Periodo = ? AND IdOperacion = ?', [periodo, Number(d.min)]);
  const [[x]] = await destino.query(
    'SELECT NroAduana FROM caratula WHERE Periodo = ? AND IdOperacion = ?', [periodo, Number(d.min)]);
  const mismo = Number(d.min) >= rango.min && Number(d.max) <= rango.max && o && x && o.NroAduana === x.NroAduana;
  if (!mismo) {
    throw new Error(`${periodo} ya está en TiDB pero de otra carga (los IdOperacion no coinciden con MariaDB).\n` +
      `       Volver a copiarlo con: npm run tidb -- --periodos ${periodo} --reemplazar`);
  }
}

async function copiarPeriodos(origen, destino, periodos, sinLiq, reemplazar) {
  await controlarFijas(destino);
  console.log('Importadores:');
  await copiarTablaCompleta(origen, destino, 'importadores');

  for (const p of periodos) {
    const [[r]] = await origen.query(
      'SELECT MIN(IdOperacion) AS min, MAX(IdOperacion) AS max, COUNT(*) AS c FROM caratula WHERE Periodo = ?', [p]);
    if (!Number(r.c)) {
      console.log(`\n${p}: no hay datos en MariaDB, se saltea.`);
      continue;
    }
    console.log(`\n${p}: ${n(r.c)} despachos  [${reloj()}]`);
    const rango = { min: Number(r.min), max: Number(r.max) };
    if (reemplazar) await borrarPeriodo(destino, p);
    else await controlarMismaCarga(origen, destino, p, rango);
    for (const t of ['caratula', 'item', ...(sinLiq ? [] : ['liq'])]) {
      await copiarPeriodo(origen, destino, t, p, rango);
    }
  }
}

async function verificar(origen, destino, periodos) {
  console.log('\nControl de cantidades (MariaDB vs TiDB):');
  let ok = true;
  for (const p of periodos) {
    for (const t of ['caratula', 'item', 'liq']) {
      const sql = `SELECT COUNT(*) AS c FROM \`${t}\` WHERE Periodo = ?`;
      const [[o]] = await origen.query(sql, [p]);
      const [[d]] = await destino.query(sql, [p]);
      const igual = Number(o.c) === Number(d.c);
      const nota = igual ? 'ok' : Number(d.c) === 0 ? 'no copiada' : 'DIFERENCIA';
      if (!igual && Number(d.c) !== 0) ok = false;
      console.log(`  ${p} ${t.padEnd(9)} ${n(o.c).padStart(12)} ${n(d.c).padStart(12)}  ${nota}`);
    }
  }
  console.log(ok ? 'Sin diferencias.' : 'Hay diferencias: volver a correr --periodos para esos meses.');
}

// ---------------------------------------------------------------------------
async function main() {
  const args = leerArgumentos(process.argv.slice(2));
  if (args.esquema) await crearEsquema();
  if (!args.fijas && !args.periodos.length && !args.verificar.length) return;

  const origen = await conectar({ dateStrings: true });
  const destino = mysql.createPool({ ...opcionesTidb(true), connectionLimit: PARALELO + 1 });
  console.log(`Origen ${process.env.DB_HOST}  ->  TiDB ${process.env.TIDB_HOST}  [${reloj()}]`);
  try {
    if (args.fijas) await copiarFijas(origen, destino);
    if (args.periodos.length) await copiarPeriodos(origen, destino, args.periodos, args.sinLiq, args.reemplazar);
    const aVerificar = [...new Set([...args.periodos, ...args.verificar])];
    if (aVerificar.length) await verificar(origen, destino, aVerificar);
    console.log(`\nListo  [${reloj()}]`);
  } finally {
    await origen.end();
    await destino.end();
  }
}

main().catch((e) => {
  console.error(`\nERROR: ${e.sqlMessage || e.message}`);
  process.exit(1);
});
