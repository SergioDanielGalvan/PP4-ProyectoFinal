// Auditoría: registro de lo que hace cada usuario en la API (tabla auditoria,
// db/08_auditoria.sql). La escritura no frena la respuesta: se hace después
// de responder y, si falla, sólo queda en el log del servidor.
const pool = require('../config/db');

const ACCIONES = [
  'consulta', 'login', 'login_fallido', 'login_bloqueado', 'cambio_clave',
  'alta_usuario', 'modif_usuario', 'baja_usuario', 'sql_libre', 'ver_auditoria', 'otra',
];

// Pedidos de escritura todavía en curso (las pruebas los esperan antes de cerrar la base)
const pendientes = new Set();
const erroresAvisados = new Set();

function registrar(fila) {
  const p = pool.query(
    `INSERT INTO auditoria (IdUsuario, Usuario, Accion, Metodo, Ruta, Detalle, Estado, Filas, DuracionMs, Ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [fila.idUsuario, fila.usuario, fila.accion, fila.metodo, fila.ruta, fila.detalle,
      fila.estado, fila.filas, fila.duracionMs, fila.ip],
  ).catch((err) => {
    // Un aviso por tipo de error, para no llenar el log (por ejemplo, si falta la tabla)
    if (!erroresAvisados.has(err.code)) {
      erroresAvisados.add(err.code);
      const ayuda = err.code === 'ER_NO_SUCH_TABLE' ? ' Falta ejecutar db/08_auditoria.sql.' : '';
      console.error(`[auditoría] no se pudo registrar: ${err.sqlMessage || err.message}.${ayuda}`);
    }
  }).finally(() => pendientes.delete(p));
  pendientes.add(p);
  return p;
}

// Un pedido que todavía no terminó también cuenta como pendiente: su registro se
// escribe al terminar de enviarse la respuesta, y el cliente (por ejemplo una
// prueba) puede recibirla antes de que eso pase.
function seguir(promesa) {
  pendientes.add(promesa);
  promesa.finally(() => pendientes.delete(promesa));
}

async function esperarPendientes() {
  while (pendientes.size) await Promise.all([...pendientes]);
}

// Borra lo más viejo que `dias`. Devuelve cuántas filas borró.
async function purgar(dias) {
  const [r] = await pool.query('DELETE FROM auditoria WHERE Fecha < NOW() - INTERVAL ? DAY', [dias]);
  return r.affectedRows;
}

// Filtros comunes: usuario, acción, rango de fechas (AAAA-MM-DD, ambos incluidos) y sólo errores
function condiciones({ usuario, accion, desde, hasta, errores }) {
  const where = [];
  const valores = [];
  if (usuario) { where.push('Usuario = ?'); valores.push(usuario); }
  if (accion) { where.push('Accion = ?'); valores.push(accion); }
  if (desde) { where.push('Fecha >= ?'); valores.push(desde); }
  if (hasta) { where.push('Fecha < ? + INTERVAL 1 DAY'); valores.push(hasta); }
  if (errores) where.push('Estado >= 400');
  return { where, valores };
}

const COLUMNAS = `IdAuditoria AS id, Fecha AS fecha, Usuario AS usuario, Accion AS accion,
  Metodo AS metodo, Ruta AS ruta, Detalle AS detalle, Estado AS estado, Filas AS filas,
  DuracionMs AS duracion_ms, Ip AS ip`;

// Más recientes primero. `antes` = último id recibido, para pedir la página siguiente.
async function buscar(filtros, { antes, limite }) {
  const { where, valores } = condiciones(filtros);
  if (antes) { where.push('IdAuditoria < ?'); valores.push(antes); }
  const [filas] = await pool.query(
    `SELECT ${COLUMNAS} FROM auditoria ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY IdAuditoria DESC LIMIT ?`, [...valores, limite + 1]);
  return { filas: filas.slice(0, limite), hay_mas: filas.length > limite };
}

// Totales por usuario en el rango: qué hizo cada uno y cuándo fue la última vez
async function resumen(filtros) {
  const { where, valores } = condiciones({ ...filtros, accion: null, errores: false });
  where.push('Usuario IS NOT NULL');
  const [filas] = await pool.query(
    `SELECT Usuario AS usuario,
       SUM(Accion = 'consulta') AS consultas,
       SUM(Accion = 'login') AS ingresos,
       SUM(Accion IN ('login_fallido', 'login_bloqueado')) AS ingresos_fallidos,
       SUM(Accion IN ('alta_usuario', 'modif_usuario', 'baja_usuario', 'cambio_clave')) AS cambios_usuarios,
       SUM(Accion = 'sql_libre') AS sql_libre,
       SUM(Estado >= 400) AS errores,
       MAX(Fecha) AS ultima
     FROM auditoria WHERE ${where.join(' AND ')}
     GROUP BY Usuario ORDER BY ultima DESC`, valores);
  return filas;
}

module.exports = { ACCIONES, registrar, seguir, esperarPendientes, purgar, buscar, resumen };
