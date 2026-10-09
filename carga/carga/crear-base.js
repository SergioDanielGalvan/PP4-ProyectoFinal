// Crea la base comex y sus tablas ejecutando db/01_schema.sql.
//
//   npm run base               crea la base si no existe
//   npm run base -- --recrear  BORRA la base con todos sus datos y la vuelve a crear
//
// Requiere los usuarios de db/00_crear_usuarios.sql (eso lo ejecuta root una vez).
const fs = require('fs');
const path = require('path');
const { conectar } = require('./lib/conexion');

const ESQUEMA = path.join(__dirname, '..', 'db', '01_schema.sql');

async function main() {
  const recrear = process.argv.includes('--recrear');
  const base = process.env.DB_NAME || 'comex';
  // Sin database: puede no existir todavía
  const db = await conectar({ database: undefined, multipleStatements: true });
  try {
    const [existe] = await db.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = 'caratula'", [base]);
    if (existe.length && !recrear) {
      console.log(`La base ${base} ya existe con sus tablas; no se toca nada.`);
      console.log('Para borrarla y crearla de nuevo (se pierden los datos): npm run base -- --recrear');
      return;
    }
    if (recrear) {
      await db.query(`DROP DATABASE IF EXISTS \`${base}\``);
      console.log(`Base ${base} borrada.`);
    }
    await db.query(fs.readFileSync(ESQUEMA, 'utf8'));
    const [tablas] = await db.query(
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?', [base]);
    console.log(`Base ${base} creada con ${tablas[0].n} tablas. Siguiente paso: npm run kit`);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  if (/Access denied|denied to user/i.test(err.message)) {
    console.error('Revisá que se haya ejecutado db/00_crear_usuarios.sql y la clave en .env.');
  }
  process.exit(1);
});
