// Carga un mes de importaciones de ARCA.
//
//   npm run mes -- E:/ARCA/202609.zip            carga el mes
//   npm run mes -- E:/ARCA/impo_202609.lst       también acepta el .lst suelto
//   npm run mes -- E:/ARCA/202609.zip --validar  sólo valida, no toca las tablas
//
// Pasos: lee impo_AAAAMM.lst del ZIP sin descomprimirlo, descarta el relleno
// y los encabezados, lo manda a stg_impo con LOAD DATA, ejecuta las
// validaciones y carga caratula, item y liq en la partición del mes.
// Recargar un mes ya cargado lo reemplaza. Deja un informe en informes/.
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { PassThrough } = require('stream');
const { conectar } = require('./lib/conexion');
const { abrirArchivoImpo, LimpiadorLst } = require('./lib/lector-lst');
const { RUTINAS, LOAD_DATA, VALIDACIONES, CARGA, CONTROL_FINAL } = require('./lib/pasos-mes');

const mb = (b) => `${(b / 1024 / 1024).toLocaleString('es-AR', { maximumFractionDigits: 0 })} MB`;
const num = (n) => Number(n).toLocaleString('es-AR');
const seg = (desde) => `${((Date.now() - desde) / 1000).toFixed(1)} s`;

function tablaMarkdown(filas) {
  if (!filas.length) return '_Sin filas._\n';
  const cols = Object.keys(filas[0]);
  const fila = (vals) => `| ${vals.map((v) => String(v ?? '').replace(/\|/g, '/')).join(' | ')} |`;
  return [fila(cols), fila(cols.map(() => '---')), ...filas.map((f) => fila(cols.map((c) => f[c])))].join('\n') + '\n';
}

// Antes de leer gigas: que estén las tablas y el KIT
async function controlarRequisitos(db) {
  const [tablas] = await db.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('stg_impo','caratula','item','liq')");
  if (tablas[0].n < 4) throw new Error('Faltan tablas. Ejecutá primero: npm run base');
  const [[kit]] = await db.query(`SELECT
    (SELECT COUNT(*) FROM aduanas) AS aduanas, (SELECT COUNT(*) FROM paises) AS paises,
    (SELECT COUNT(*) FROM tasas) AS tasas, (SELECT COUNT(*) FROM posicion) AS posicion`);
  const vacias = ['aduanas', 'paises', 'tasas'].filter((t) => kit[t] === 0);
  if (vacias.length) throw new Error(`Faltan las tablas del KIT (${vacias.join(', ')} vacías). Ejecutá primero: npm run kit`);
  if (kit.posicion === 0) {
    console.log('Aviso: posicion está vacía; las subpartidas se agregan sin descripción.'
      + ' Se completan después con npm run kit (cuando POSICION tenga datos) o con db/02_tablas_sim_kit.sql.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const soloValidar = args.includes('--validar');
  const ruta = args.find((a) => !a.startsWith('--'));
  if (!ruta || !fs.existsSync(ruta)) {
    console.error('Uso: npm run mes -- E:/ARCA/202609.zip [--validar]');
    process.exit(1);
  }

  const inicio = Date.now();
  const archivo = await abrirArchivoImpo(path.resolve(ruta));
  console.log(`Archivo: ${archivo.nombre} (${mb(archivo.bytes)})${soloValidar ? ' - sólo validación' : ''}`);

  const informe = [`# Carga ${archivo.nombre}\n`, `Origen: \`${path.resolve(ruta)}\`  `,
    `Fecha: ${new Date().toLocaleString('es-AR')}  `, `Modo: ${soloValidar ? 'sólo validación' : 'carga completa'}\n`];
  let problemas = 0;

  const db = await conectar({ flags: ['LOCAL_FILES'] }).catch((err) => {
    if (/Unknown database/i.test(err.message)) throw new Error('Falta la base. Ejecutá primero: npm run base');
    throw err;
  });
  try {
    await controlarRequisitos(db);
    for (const sql of RUTINAS) await db.query(sql);

    // 1. Staging
    await db.query('TRUNCATE stg_impo');
    const [idx] = await db.query(
      "SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'stg_impo' AND index_name = 'ix_stg' LIMIT 1");
    if (idx.length) await db.query('DROP INDEX ix_stg ON stg_impo');

    const limpiador = new LimpiadorLst();
    const salida = new PassThrough();
    const avance = setInterval(() => {
      const pct = archivo.bytes ? ` (${Math.round((100 * limpiador.bytesLeidos) / archivo.bytes)} %)` : '';
      process.stdout.write(`\r  Leyendo: ${mb(limpiador.bytesLeidos)}${pct}, ${num(limpiador.lineas)} líneas   `);
    }, 2000);
    let t = Date.now();
    const lectura = pipeline(archivo.stream, limpiador, salida);
    try {
      await Promise.all([
        lectura,
        db.query({ sql: LOAD_DATA, infileStreamFactory: () => salida }),
      ]);
    } finally {
      clearInterval(avance);
    }
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
    console.log(`1. Lectura: ${num(limpiador.lineas)} líneas de datos, ${num(limpiador.descartadas)} de encabezado o vacías,`
      + ` ${num(limpiador.malformadas)} malformadas (${seg(t)})`);
    informe.push('## Lectura\n', tablaMarkdown([{
      lineas_datos: limpiador.lineas, encabezados_o_vacias: limpiador.descartadas,
      malformadas: limpiador.malformadas, bytes_leidos: limpiador.bytesLeidos }]));
    if (limpiador.malformadas) problemas += 1;

    t = Date.now();
    await db.query('CREATE INDEX ix_stg ON stg_impo (NroAduana, Item, Codigo)');
    console.log(`   Índice de staging (${seg(t)})`);

    // 2. Periodo: uno solo y el mismo del nombre del archivo
    const [periodos] = await db.query('SELECT Periodo, COUNT(*) AS lineas FROM stg_impo GROUP BY Periodo');
    if (periodos.length !== 1) {
      throw new Error(`El archivo trae ${periodos.length} periodos: ${periodos.map((p) => p.Periodo).join(', ')}`);
    }
    const periodo = Number(periodos[0].Periodo);
    if (archivo.periodo && archivo.periodo !== periodo) {
      throw new Error(`El nombre dice ${archivo.periodo} pero los datos son de ${periodo}`);
    }
    console.log(`2. Periodo ${periodo}`);

    // 3. Validaciones
    console.log('3. Validaciones');
    informe.push('## Validaciones\n');
    for (const v of VALIDACIONES) {
      t = Date.now();
      const [filas] = await db.query(v.sql);
      const marca = v.tipo === 'info' ? 'info' : (filas.length ? 'REVISAR' : 'ok');
      if (marca === 'REVISAR') problemas += 1;
      console.log(`   ${v.id.padEnd(3)} ${marca.padEnd(8)} ${v.titulo}${filas.length && v.tipo === 'control' ? ` (${filas.length} filas)` : ''} (${seg(t)})`);
      informe.push(`### ${v.id}) ${v.titulo} - ${marca}\n`, tablaMarkdown(filas));
    }

    // 4. Carga
    if (!soloValidar) {
      console.log('4. Carga');
      for (const paso of CARGA) {
        t = Date.now();
        const [res] = await db.query(paso.sql, paso.params ? [periodo] : []);
        const filas = Array.isArray(res) || /^\s*CALL/i.test(paso.sql) ? '' : ` ${num(res.affectedRows)} filas`;
        console.log(`   ${paso.titulo}:${filas} (${seg(t)})`);
      }
      const [[final]] = await db.query(CONTROL_FINAL, [periodo, periodo, periodo]);
      console.log(`5. En la base: ${num(final.caratulas)} carátulas, ${num(final.items)} ítems, ${num(final.liquidaciones)} líneas de liquidación`);
      informe.push('## Resultado\n', tablaMarkdown([{ periodo, ...final }]));
    }

    // Libera el espacio del staging
    await db.query('DROP INDEX ix_stg ON stg_impo');
    await db.query('TRUNCATE stg_impo');
  } finally {
    await db.end();
  }

  const carpeta = path.join(__dirname, 'informes');
  fs.mkdirSync(carpeta, { recursive: true });
  const destino = path.join(carpeta, archivo.nombre.replace(/\.lst$/i, '.md'));
  fs.writeFileSync(destino, informe.join('\n'), 'utf8');
  console.log(`Listo en ${seg(inicio)}. ${problemas ? `${problemas} validaciones para revisar.` : 'Sin observaciones.'}`
    + ` Informe: ${path.relative(process.cwd(), destino)}`);
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
