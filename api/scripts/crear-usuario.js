// Crea un usuario de la API (el primer administrador, o cualquier otro).
// Usa la conexión de api/.env, así que sirve igual contra MariaDB o TiDB.
//
//   npm run usuario -- --usuario sergio --nombre "Sergio Galván" --rol admin
//
// La clave se pide por teclado (no queda en el historial de la consola).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const readline = require('readline');
const pool = require('../src/config/db');
const usuarios = require('../src/models/usuarios.model');
const { hashear, claveValida, nombreUsuario, rolValido } = require('../src/controllers/auth.controller');

function argumento(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function preguntarOculto(texto) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(texto)) rl.output.write(s); };  // no muestra lo que se escribe
    rl.question(texto, (r) => { rl.close(); process.stdout.write('\n'); resolve(r); });
  });
}

async function main() {
  const usuario = nombreUsuario(argumento('usuario'));
  const rol = rolValido(argumento('rol') || 'consulta');
  const nombre = argumento('nombre') || usuario;
  const clave = claveValida(argumento('clave') || await preguntarOculto('Clave (mínimo 10 caracteres): '));
  if (!argumento('clave')) {
    const repetida = await preguntarOculto('Repetir clave: ');
    if (repetida !== clave) throw new Error('Las claves no coinciden.');
  }
  const creado = await usuarios.crear({ usuario, nombre, rol, claveHash: await hashear(clave) });
  console.log(`Usuario ${creado.usuario} creado con rol ${creado.rol} (id ${creado.id}) en ${process.env.DB_HOST}.`);
}

main()
  .catch((e) => {
    const msg = e.code === 'ER_DUP_ENTRY' ? 'Ese usuario ya existe.'
      : e.code === 'ER_TABLEACCESS_DENIED_ERROR' ? 'El usuario de la base no tiene permiso sobre la tabla usuarios: ejecutar db/07_usuarios.sql (ver README).'
        : e.code === 'ER_NO_SUCH_TABLE' ? 'Falta la tabla usuarios: ejecutar db/07_usuarios.sql (o --esquema en TiDB).'
          : e.message;
    console.error(`Error: ${msg}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
