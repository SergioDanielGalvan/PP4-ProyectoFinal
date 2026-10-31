// Registra cada pedido a /api en la tabla auditoria, después de responder:
// quién, qué acción, sobre qué ruta y con qué parámetros, el resultado (código
// HTTP y filas devueltas), cuánto tardó y desde qué IP.
//
// - Nunca se guardan claves ni tokens: de los cuerpos sólo se toma lo que el
//   controlador deja en res.locals.auditoria (por ejemplo "rol consulta → admin").
// - No se registran los pedidos automáticos de la página (sugerencias del
//   autocompletado, lista de períodos, catálogos, /auth/yo): son ruido.
// - AUDITORIA=false la apaga; AUDITORIA_DIAS (180) es cuánto se conserva.
const auditoria = require('../models/auditoria.model');

const SIN_REGISTRO = [
  /^\/health$/, /^\/auth\/yo$/, /^\/impo\/sugerencias\//, /^\/impo\/periodos$/, /^\/impo\/catalogos$/,
];

// Dónde viene la lista principal en las respuestas que son objetos
const LISTAS = ['filas', 'resultados', 'origenes', 'items', 'subpartidas', 'categorias'];

const DIA_MS = 24 * 60 * 60 * 1000;
let ultimaPurga = 0;

function accionDe(metodo, ruta, estado) {
  if (ruta === '/auth/login') {
    if (estado === 200) return 'login';
    return estado === 429 ? 'login_bloqueado' : 'login_fallido';
  }
  if (ruta === '/auth/clave') return 'cambio_clave';
  if (/^\/auth\/usuarios(\/|$)/.test(ruta) && metodo !== 'GET') {
    return { POST: 'alta_usuario', PATCH: 'modif_usuario', DELETE: 'baja_usuario' }[metodo] || 'otra';
  }
  if (ruta === '/consultas/sql') return 'sql_libre';
  if (/^\/auditoria(\/|$)/.test(ruta)) return 'ver_auditoria';
  return metodo === 'GET' ? 'consulta' : 'otra';
}

// Parámetros de la consulta en texto: "ncm=8471 · origen=310"
function textoParametros(query) {
  return Object.entries(query || {})
    .filter(([clave]) => !/clave|token|password/i.test(clave))
    .map(([clave, valor]) => `${clave}=${String(valor).slice(0, 100)}`)
    .join(' · ');
}

// El nombre de usuario que se escribió en el login (aunque no exista): ascii y 40 caracteres
const nombreSeguro = (v) => (v ? String(v).toLowerCase().replace(/[^\x21-\x7e]/g, '?').slice(0, 40) : null);

function armarFila(req, res, inicio, cuerpo) {
  const ruta = req.originalUrl.split('?')[0].replace(/^\/api/, '') || '/';
  const estado = res.statusCode;
  const accion = accionDe(req.method, ruta, estado);
  const extra = res.locals.auditoria || {};

  const partes = [];
  if (accion === 'sql_libre') partes.push(String(req.body?.sql || '').slice(0, 1500));
  else if (extra.detalle) partes.push(extra.detalle);
  const params = textoParametros(req.query);
  if (params) partes.push(params);
  if (estado >= 400 && cuerpo && cuerpo.error) partes.push(`Error: ${cuerpo.error}`);

  let filas = null;
  if (Array.isArray(cuerpo)) filas = cuerpo.length;
  else if (cuerpo && typeof cuerpo === 'object') {
    const lista = LISTAS.find((k) => Array.isArray(cuerpo[k]));
    if (lista) filas = cuerpo[lista].length;
  }

  return {
    idUsuario: req.usuario?.id ?? extra.idUsuario ?? null,
    usuario: nombreSeguro(req.usuario?.usuario ?? extra.usuario),
    accion,
    metodo: req.method,
    ruta: ruta.slice(0, 200),
    detalle: partes.join(' — ').slice(0, 2000) || null,
    estado,
    filas,
    duracionMs: Math.round(Number(process.hrtime.bigint() - inicio) / 1e6),
    ip: req.ip ? String(req.ip).slice(0, 45) : null,
  };
}

function purgarSiCorresponde() {
  const dias = Number(process.env.AUDITORIA_DIAS ?? 180);
  if (!(dias > 0) || Date.now() - ultimaPurga < DIA_MS) return;
  ultimaPurga = Date.now();
  auditoria.purgar(dias)
    .then((n) => { if (n) console.log(`[auditoría] se borraron ${n} registros de más de ${dias} días`); })
    .catch((err) => console.error('[auditoría] no se pudo purgar:', err.sqlMessage || err.message));
}

function auditar(req, res, next) {
  if (process.env.AUDITORIA === 'false') return next();
  const ruta = req.path;
  if (SIN_REGISTRO.some((r) => r.test(ruta))) return next();

  const inicio = process.hrtime.bigint();
  let cuerpo = null;
  const jsonOriginal = res.json.bind(res);
  res.json = (datos) => { cuerpo = datos; return jsonOriginal(datos); };

  auditoria.seguir(new Promise((terminado) => {
    res.on('finish', () => {
      try {
        auditoria.registrar(armarFila(req, res, inicio, cuerpo)).then(terminado);
        purgarSiCorresponde();
      } catch (err) {
        console.error('[auditoría] no se pudo armar el registro:', err.message);
        terminado();
      }
    });
    res.on('close', () => { if (!res.writableFinished) terminado(); });   // conexión cortada
  }));
  next();
}

module.exports = { auditar, accionDe, textoParametros, nombreSeguro };
