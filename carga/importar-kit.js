// Importa las tablas del KIT desde Kit.mdb (Access) a MySQL.
//
//   npm run kit                  -> usa KIT_MDB del .env, o ./Kit.mdb
//   npm run kit -- C:\ruta\Kit.mdb
//
// Lee el .mdb directamente con mdb-reader (no hace falta Access ni ODBC) y
// hace INSERT ... ON DUPLICATE KEY UPDATE: agrega códigos nuevos y actualiza
// descripciones, pero nunca borra, porque item y liq pueden estar usándolos.
// En posicion se conserva IdPosicion de las subpartidas que ya existían.
const fs = require('fs');
const path = require('path');
const { conectar } = require('./lib/conexion');

const LOTE = 500;

// texto: recorta y corrige la Ñ que el SIM guarda como '#'
const texto = (v) => (v === null || v === undefined ? null : String(v).trim().replace(/#/g, 'Ñ') || null);
const codigo = (v) => (v === null || v === undefined ? null : String(v).trim() || null);
const numero = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const fecha = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : null);

// tabla de Access -> tabla MySQL, columnas y conversión
const TABLAS = [
  { access: 'ADUANAS', mysql: 'aduanas', clave: 'Codigo',
    columnas: { Codigo: codigo, Descrip: texto, Vias: codigo } },
  { access: 'PAISES', mysql: 'paises', clave: 'Codigo',
    columnas: { Codigo: codigo, Descrip: texto } },
  { access: 'VIA', mysql: 'via', clave: 'Codigo',
    columnas: { Codigo: codigo, Descrip: texto, Aclaracion: texto } },
  { access: 'UNIDADESMEDIDA', mysql: 'unidadesmedida', clave: 'Codigo',
    columnas: { Codigo: codigo, Descrip: texto, Abreviatura: texto } },
  { access: 'TASAS', mysql: 'tasas', clave: 'Codigo',
    columnas: { Codigo: codigo, Descrip: texto, ImpoExpo: codigo, PagaGarantiza: codigo } },
  { access: 'DIVISAS', mysql: 'divisas', clave: 'Codigo',
    columnas: { Codigo: codigo, Descrip: texto, Abreviatura: texto } },
  { access: 'DESTINACIONES', mysql: 'destinaciones', clave: 'Codigo',
    columnas: { Codigo: codigo, Descrip: texto, ImpoExpo: codigo } },
  { access: 'POSICION', mysql: 'posicion', clave: 'PosicionSIM',
    columnas: {
      PosicionSIM: codigo,
      DescripcionNCM: (v) => (v === null || v === undefined ? null : String(v).trim()),
      UnidadEstadistica: codigo,
      PorcientoDerechoImpoExtra: numero,
      PorcientoDerechoImpoIntra: numero,
      PorcientoEstadisticaExtra: numero,
      PorcientoEstadisticaIntra: numero,
      PorcientoAEC: numero,
      PorcientoIVA: numero,
      PorcientoIvaAdicional: numero,
      PorcientoImpuestosInternos: numero,
      MarcaExencionIva: codigo,
      FechaActualizacion: fecha,
    },
    preparar: reducirASubpartida },
];

// Si POSICION todavía tiene aperturas SIM (16 caracteres), deja una fila por
// subpartida (la apertura de código más bajo) y cuenta las subpartidas cuyas
// aperturas tienen porcentajes distintos.
function reducirASubpartida(filas) {
  const PORCENTAJES = ['PorcientoDerechoImpoExtra', 'PorcientoEstadisticaExtra', 'PorcientoIVA'];
  const grupos = new Map();
  for (const f of filas) {
    const sub = f.PosicionSIM.slice(0, 10);
    if (!grupos.has(sub)) grupos.set(sub, []);
    grupos.get(sub).push(f);
  }
  let divergentes = 0;
  const resultado = [];
  for (const [sub, aperturas] of grupos) {
    aperturas.sort((a, b) => a.PosicionSIM.localeCompare(b.PosicionSIM));
    if (PORCENTAJES.some((p) => new Set(aperturas.map((a) => a[p])).size > 1)) divergentes += 1;
    resultado.push({ ...aperturas[0], PosicionSIM: sub });
  }
  if (grupos.size < filas.length) {
    console.log(`  POSICION: ${filas.length} aperturas reducidas a ${grupos.size} subpartidas;`
      + ` ${divergentes} con porcentajes distintos entre aperturas (quedó la primera).`);
  }
  return resultado;
}

async function importarTabla(conexion, reader, def) {
  if (!reader.getTableNames().includes(def.access)) {
    console.log(`  ${def.access}: no está en el .mdb, se saltea.`);
    return;
  }
  const tabla = reader.getTable(def.access);
  const disponibles = new Set(tabla.getColumnNames());
  const columnas = Object.keys(def.columnas).filter((c) => disponibles.has(c));

  let filas = tabla.getData()
    .map((r) => Object.fromEntries(columnas.map((c) => [c, def.columnas[c](r[c])])))
    .filter((r) => r[def.clave]);
  if (def.preparar) filas = def.preparar(filas);

  if (filas.length === 0) {
    console.log(`  ${def.access}: vacía, no se importa nada.`);
    return;
  }

  const actualizar = columnas.filter((c) => c !== def.clave).map((c) => `${c} = VALUES(${c})`).join(', ');
  const sql = `INSERT INTO ${def.mysql} (${columnas.join(', ')}) VALUES ?`
    + (actualizar ? ` ON DUPLICATE KEY UPDATE ${actualizar}` : ` ON DUPLICATE KEY UPDATE ${def.clave} = ${def.clave}`);

  let nuevas = 0;
  let modificadas = 0;
  await conexion.beginTransaction();
  try {
    for (let i = 0; i < filas.length; i += LOTE) {
      const lote = filas.slice(i, i + LOTE).map((f) => columnas.map((c) => f[c]));
      const [res] = await conexion.query(sql, [lote]);
      // affectedRows = 1 por fila nueva + 2 por fila existente que cambió;
      // "Duplicates: d" en res.info = filas existentes que cambiaron.
      // Las que ya estaban iguales no suman en ninguno de los dos.
      const cambiadas = Number((/Duplicates:\s*(\d+)/.exec(res.info) || [])[1] || 0);
      modificadas += cambiadas;
      nuevas += res.affectedRows - 2 * cambiadas;
    }
    await conexion.commit();
  } catch (err) {
    await conexion.rollback();
    throw err;
  }
  const iguales = filas.length - nuevas - modificadas;
  console.log(`  ${def.access.padEnd(15)} -> ${def.mysql.padEnd(15)} ${String(filas.length).padStart(6)} filas:`
    + ` ${nuevas} nuevas, ${modificadas} modificadas, ${iguales} sin cambios`);
}

async function main() {
  const ruta = path.resolve(process.argv[2] || process.env.KIT_MDB || 'Kit.mdb');
  if (!fs.existsSync(ruta)) {
    console.error(`No encuentro ${ruta}. Pasá la ruta: npm run kit -- C:\\ruta\\Kit.mdb`);
    process.exit(1);
  }
  const { default: MDBReader } = await import('mdb-reader');
  const reader = new MDBReader(fs.readFileSync(ruta));

  const conexion = await conectar({ flags: ['-FOUND_ROWS'] }); // affectedRows sin las filas sin cambios

  console.log(`Importando ${ruta}`);
  try {
    for (const def of TABLAS) await importarTabla(conexion, reader, def);
  } finally {
    await conexion.end();
  }
  console.log('Listo.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

module.exports = { TABLAS, importarTabla, reducirASubpartida };
