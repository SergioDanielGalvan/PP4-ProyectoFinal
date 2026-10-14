// Consultas SQL: las guardadas (archivos .sql en src/consultas) y SQL libre (sólo admin).
// Todas corren con el usuario de la base de la API, que sólo puede leer los datos:
// aunque una consulta se escape de los controles de abajo, no puede modificar nada.
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { HttpError } = require('../middlewares/errors');

const CARPETA = path.join(__dirname, '..', 'consultas');
const LIMITE_FILAS = Number(process.env.SQL_LIMITE_FILAS || 5000);
const TIEMPO_MAX_SEG = Number(process.env.SQL_TIEMPO_MAX_SEG || 30);

// ---------- consultas guardadas ----------
// Encabezado de cada archivo:
//   -- titulo: ...
//   -- descripcion: ...
//   -- parametros: nombre:tipo:defecto, ...   (tipo periodo|entero|texto; defecto "opcional" = NULL)
// En el SQL los parámetros van como :nombre.
function leerConsulta(archivo) {
  const texto = fs.readFileSync(path.join(CARPETA, archivo), 'utf8');
  const meta = {};
  for (const linea of texto.split('\n')) {
    const m = linea.match(/^--\s*(titulo|descripcion|parametros):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  const parametros = (meta.parametros || '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
    const [nombre, tipo = 'texto', defecto = 'opcional'] = p.split(':').map((x) => x.trim());
    return { nombre, tipo, opcional: defecto === 'opcional', defecto: defecto === 'opcional' ? null : defecto };
  });
  const sql = texto.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim().replace(/;\s*$/, '');
  return { nombre: archivo.replace(/\.sql$/, ''), titulo: meta.titulo || archivo, descripcion: meta.descripcion || '', parametros, sql };
}

let catalogo = null;
function consultasGuardadas() {
  if (!catalogo) {
    catalogo = new Map(fs.readdirSync(CARPETA).filter((a) => a.endsWith('.sql')).sort()
      .map((a) => { const c = leerConsulta(a); return [c.nombre, c]; }));
  }
  return catalogo;
}

function listarGuardadas() {
  return [...consultasGuardadas().values()].map(({ sql, ...resto }) => resto);
}

function convertir(param, valor) {
  if (valor === undefined || valor === '') {
    if (param.opcional) return null;
    valor = param.defecto;
  }
  if (param.tipo === 'periodo') {
    if (!/^\d{6}$/.test(String(valor))) throw new HttpError(400, `${param.nombre} va con formato AAAAMM.`);
    return Number(valor);
  }
  if (param.tipo === 'entero') {
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 0) throw new HttpError(400, `${param.nombre} tiene que ser un entero positivo.`);
    return param.nombre === 'limite' ? Math.min(n, LIMITE_FILAS) : n;
  }
  return String(valor).slice(0, 200);
}

async function ejecutarGuardada(nombre, valores) {
  const consulta = consultasGuardadas().get(nombre);
  if (!consulta) throw new HttpError(404, `No existe la consulta "${nombre}". Ver GET /api/consultas.`);
  const params = Object.fromEntries(consulta.parametros.map((p) => [p.nombre, convertir(p, valores[p.nombre])]));
  const resultado = await ejecutarAcotado(consulta.sql, params);
  return { consulta: consulta.nombre, titulo: consulta.titulo, parametros: params, ...resultado };
}

// ---------- SQL libre (sólo admin) ----------
const INICIOS_PERMITIDOS = /^(SELECT|WITH|SHOW|EXPLAIN|DESCRIBE|DESC)\b/i;
const PROHIBIDO = [
  [/\bINTO\s+(OUTFILE|DUMPFILE|@)/i, 'INTO OUTFILE / variables'],
  [/\b(LOAD_FILE|SLEEP|BENCHMARK|GET_LOCK|RELEASE_LOCK)\s*\(/i, 'funciones de archivo o de espera'],
  [/\bFOR\s+UPDATE\b|\bLOCK\s+IN\s+SHARE\s+MODE\b/i, 'bloqueos'],
  [/\busuarios\b/i, 'la tabla usuarios'],
];

function sinComentarios(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(--|#)[^\n]*/g, ' ').trim();
}

function validarSqlLibre(sql) {
  const texto = String(sql || '').trim().replace(/;\s*$/, '');
  if (!texto) throw new HttpError(400, 'Falta la consulta (campo "sql").');
  if (texto.length > 20000) throw new HttpError(400, 'La consulta es demasiado larga.');
  const limpio = sinComentarios(texto);
  if (limpio.includes(';')) throw new HttpError(400, 'Una sola sentencia por vez (sin ";" en el medio).');
  if (!INICIOS_PERMITIDOS.test(limpio)) {
    throw new HttpError(400, 'Sólo se permiten consultas de lectura: SELECT, WITH, SHOW, EXPLAIN o DESCRIBE.');
  }
  for (const [patron, que] of PROHIBIDO) {
    if (patron.test(limpio)) throw new HttpError(400, `No se permite usar ${que} en el SQL libre.`);
  }
  return texto;
}

async function ejecutarLibre(sql, limite) {
  const texto = validarSqlLibre(sql);
  return ejecutarAcotado(texto, undefined, Math.min(limite || LIMITE_FILAS, LIMITE_FILAS));
}

// ---------- ejecución con tope de tiempo y de filas ----------
// Las filas se leen de a una: al llegar al tope se corta la conexión, sin
// traer a memoria un resultado de millones de filas.
async function fijarTiempoMaximo(conn, segundos) {
  try {
    await conn.query(`SET SESSION max_execution_time = ${segundos * 1000}`);   // MySQL y TiDB (ms)
  } catch {
    await conn.query(`SET SESSION max_statement_time = ${segundos}`);          // MariaDB (s)
  }
}

async function ejecutarAcotado(sql, params, limite = LIMITE_FILAS) {
  const conn = await pool.getConnection();
  let cortar = false;
  try {
    await fijarTiempoMaximo(conn, TIEMPO_MAX_SEG);
    const inicio = Date.now();
    const resultado = await new Promise((resolve, reject) => {
      const columnas = [];
      const filas = [];
      let terminado = false;
      const q = conn.connection.query({ sql, values: params, namedPlaceholders: Boolean(params), rowsAsArray: true });
      q.on('fields', (f) => { if (f && !columnas.length) columnas.push(...f.map((c) => c.name)); });
      q.on('result', (fila) => {
        if (terminado) return;
        if (!Array.isArray(fila)) return;   // paquete OK de sentencias que no devuelven filas
        if (filas.length < limite) { filas.push(fila); return; }
        terminado = true;
        cortar = true;
        resolve({ columnas, filas, recortado: true });
      });
      q.on('error', (err) => { if (!terminado) { terminado = true; reject(err); } });
      q.on('end', () => { if (!terminado) { terminado = true; resolve({ columnas, filas, recortado: false }); } });
    });
    return { ...resultado, cantidad: resultado.filas.length, limite, milisegundos: Date.now() - inicio };
  } catch (err) {
    if (/max_execution_time|max_statement_time|interrupted|Query execution was interrupted/i.test(err.message)) {
      throw new HttpError(408, `La consulta superó el tiempo máximo de ${TIEMPO_MAX_SEG} segundos.`);
    }
    if (err.sqlMessage) {
      cortar = true;
      throw new HttpError(400, `Error de SQL: ${err.sqlMessage}`);
    }
    throw err;
  } finally {
    if (cortar) conn.destroy();
    else {
      await fijarTiempoMaximo(conn, 0).catch(() => {});
      conn.release();
    }
  }
}

module.exports = { listarGuardadas, ejecutarGuardada, ejecutarLibre, validarSqlLibre, LIMITE_FILAS };
