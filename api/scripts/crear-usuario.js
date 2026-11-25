// Crea un usuario de la API (el primer administrador, o cualquier otro).
// Usa la conexión de api/.env, así que sirve igual contra MariaDB o TiDB.
//
//   node scripts/crear-usuario.js --usuario sergio --nombre "Sergio Galván" --rol general
//   node scripts/crear-usuario.js --usuario ana --rol admin --empresa 2
//
// Roles: general (administra todo el sistema), admin (administra su empresa) y
// consulta. --empresa es el IdEmpresa (por defecto 1); la empresa tiene que existir.
//
// La clave se pide por teclado (no queda en el historial de la consola).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const readline = require('readline');
const pool = require('../src/config/db');
const usuarios = require('../src/models/usuarios.model');
const { hashear, claveValida, nombreUsuario, rolValido, empresaValida } = require('../src/controllers/auth.controller');
const empresas = require('../src/models/empresas.model');

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
  const empresa = empresaValida(argumento('empresa') || 1);
  if (!(await empresas.buscar(empresa))) throw new Error(`No existe la empresa ${empresa}: creala primero (db/10_empresas.sql crea la 1).`);
  const clave = claveValida(argumento('clave') || await preguntarOculto('Clave (mínimo 10 caracteres): '));
  if (!argumento('clave')) {
    const repetida = await preguntarOculto('Repetir clave: ');
    if (repetida !== clave) throw new Error('Las claves no coinciden.');
  }
  const creado = await usuarios.crear({ usuario, nombre, rol, empresa, claveHash: await hashear(clave) });
  console.log(`Usuario ${creado.usuario} creado con rol ${creado.rol} en la empresa ${creado.empresa} (id ${creado.id}) en ${process.env.DB_HOST}.`);
}

main()
  .catch((e) => {
    const msg = e.code === 'ER_DUP_ENTRY' ? 'Ese usuario ya existe.'
      : e.code === 'ER_TABLEACCESS_DENIED_ERROR' ? 'El usuario de la base no tiene permiso sobre la tabla usuarios: ejecutar db/07_usuarios.sql (ver README).'
        : e.code === 'ER_NO_SUCH_TABLE' ? 'Falta la tabla usuarios o empresa: ejecutar db/07_usuarios.sql y db/10_empresas.sql (o --esquema en TiDB).'
          : e.message;
    console.error(`Error: ${msg}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
