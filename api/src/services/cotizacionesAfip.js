// Tipo de cambio aduanero (cotizaciones MARIA de ARCA/AFIP).
// Portado de tipoCambio_AFIP (lecturaTiposdeCambio.php del Módulo MARIA, que a
// su vez viene de frmLiquidacion.Traer_Monedas2 del VB6).
//
// Cómo funciona el sitio:
// - www.afip.gob.ar/aduana/cotizacionesMaria/ redirige con un <meta refresh> a
//   serviciosweb.afip.gob.ar/aduana/cotizacionesMaria/default.asp. Se sigue la
//   redirección, se toma el action del <form> y sus campos ocultos, y se postea
//   ahí con las cookies de la sesión (el POST directo a www da 55 bytes).
// - Se pide por FECHA DE PUBLICACIÓN: para los despachos del día D se consulta
//   D-1 y se retrocede mientras no haya tabla (feriados, fines de semana).
// - Trae el tipo de cambio en pesos de cada moneda; el pase contra el dólar se
//   calcula como TC moneda / TC dólar.
const { HttpError } = require('../middlewares/errors');

const URL_INICIO = 'https://www.afip.gob.ar/aduana/cotizacionesMaria/';
const MAX_INTENTOS = 10;          // alcanza para Semana Santa + fin de semana + puente
const TIEMPO_MAX_MS = 30000;
const NAVEGADOR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ---------- fechas (AAAA-MM-DD, sin husos horarios) ----------
const aFecha = (d) => d.toISOString().slice(0, 10);
const desdeTexto = (s) => new Date(`${s}T12:00:00Z`);
function sumarDias(fecha, n) {
  const d = desdeTexto(fecha);
  d.setUTCDate(d.getUTCDate() + n);
  return aFecha(d);
}

// ---------- HTTP con cookies ----------
class Sesion {
  constructor(fetchImpl = globalThis.fetch) {
    this.fetch = fetchImpl;
    this.cookies = new Map();
  }

  guardarCookies(respuesta) {
    const lista = typeof respuesta.headers.getSetCookie === 'function'
      ? respuesta.headers.getSetCookie()
      : (respuesta.headers.get('set-cookie') || '').split(/,(?=\s*[^;=]+=)/).filter(Boolean);
    for (const c of lista) {
      const [par] = c.split(';');
      const i = par.indexOf('=');
      if (i > 0) this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
  }

  // Pide la URL siguiendo redirecciones HTTP a mano, para no perder cookies en el camino
  async pedir(url, { metodo = 'GET', cuerpo = null, referer = null } = {}) {
    let actual = url;
    let opciones = { metodo, cuerpo };
    for (let saltos = 0; saltos < 10; saltos++) {
      const headers = {
        'User-Agent': NAVEGADOR,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9',
      };
      if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      if (referer) headers.Referer = referer;
      if (opciones.cuerpo) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const r = await this.fetch(actual, {
        method: opciones.metodo, headers, body: opciones.cuerpo, redirect: 'manual',
        signal: AbortSignal.timeout(TIEMPO_MAX_MS),
      });
      this.guardarCookies(r);
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        actual = new URL(r.headers.get('location'), actual).href;
        opciones = { metodo: 'GET', cuerpo: null };     // como curl con FOLLOWLOCATION
        continue;
      }
      return { url: actual, estado: r.status, html: await leerTexto(r) };
    }
    throw new Error('Demasiadas redirecciones.');
  }
}

// Las páginas ASP vienen en Latin-1 / Windows-1252 salvo que digan otra cosa
async function leerTexto(respuesta) {
  const bytes = Buffer.from(await respuesta.arrayBuffer());
  const tipo = respuesta.headers.get('content-type') || '';
  let charset = (/charset=([\w-]+)/i.exec(tipo) || [])[1];
  if (!charset) charset = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(bytes.toString('latin1')) || [])[1];
  try {
    return new TextDecoder(charset && /utf-?8/i.test(charset) ? 'utf-8' : 'windows-1252').decode(bytes);
  } catch {
    return bytes.toString('latin1');
  }
}

// ---------- página y formulario ----------
const decodificar = (s) => s
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

// Sigue el <meta refresh> hasta la página nueva y toma el action del <form> y sus campos ocultos
async function prepararFormulario(sesion) {
  let { url, html } = await sesion.pedir(URL_INICIO);
  for (let k = 0; k < 3; k++) {
    const m = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i.exec(html);
    if (!m) break;
    url = new URL(decodificar(m[1]), url).href;
    ({ url, html } = await sesion.pedir(url));
  }
  const accion = /<form\b[^>]*\baction=["']?([^"'\s>]+)/i.exec(html);
  const urlForm = new URL(accion ? decodificar(accion[1]) : 'formulario.asp', url).href;
  const ocultos = {};
  for (const tag of html.match(/<input\b[^>]*>/gi) || []) {
    if (!/type=["']?hidden/i.test(tag)) continue;
    const nombre = /name=["']?([^"'\s>]+)/i.exec(tag);
    if (!nombre) continue;
    const valor = /value=["']([^"']*)["']/i.exec(tag);
    ocultos[nombre[1]] = valor ? decodificar(valor[1]) : '';
  }
  return { urlForm, referer: url, ocultos };
}

// ---------- tabla de cotizaciones ----------
const textoCelda = (html) => decodificar(html.replace(/<[^>]*>/g, '')).replace(/ /g, ' ').trim();
// "1.234,56" o "1234.56" -> número
function numero(texto) {
  const t = texto.replace(/\s/g, '');
  if (!/^-?[\d.,]+$/.test(t)) return NaN;
  // El último separador es el decimal; los demás son de miles
  const ultimo = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
  if (ultimo < 0) return Number(t);
  const entero = t.slice(0, ultimo).replace(/[.,]/g, '');
  return Number(`${entero}.${t.slice(ultimo + 1)}`);
}

// Igual que el VB6: el bloque entre "DISPLAY DE DATOS" y </TABLE>, cada fila con 5
// celdas: "COD - descripción", (fecha), vendedor, comprador, (resto).
function parsearTabla(html) {
  const mayus = html.toUpperCase();
  const desde = mayus.indexOf('<!-- DISPLAY DE DATOS -->');
  if (desde < 0) return [];
  const hasta = mayus.indexOf('</TABLE>', desde);
  if (hasta < 0) return [];
  const bloque = html.slice(desde, hasta).replace(/\t/g, '');
  const filas = [];
  for (const tr of bloque.split(/<tr\b[^>]*>/i).slice(1)) {
    const celdas = tr.replace(/[\r\n]/g, '').split(/<\/td>/i);
    if (celdas.length - 1 !== 4) continue;
    const primera = textoCelda(celdas[0]);
    const guion = primera.indexOf('-');
    const codigo = (guion >= 0 ? primera.slice(0, guion) : primera).trim();
    const descripcion = guion >= 0 ? primera.slice(guion + 1).trim() : '';
    const vendedor = numero(textoCelda(celdas[2]));
    const comprador = numero(textoCelda(celdas[3]));
    if (codigo && Number.isFinite(vendedor) && Number.isFinite(comprador)) {
      filas.push({ codigo: codigo.toUpperCase(), descripcion, vendedor, comprador });
    }
  }
  return filas;
}

// ---------- consulta ----------
// Cotización para los despachos del día `fecha` (AAAA-MM-DD).
async function obtener(fecha, { fetchImpl } = {}) {
  const sesion = new Sesion(fetchImpl);
  let form;
  try {
    form = await prepararFormulario(sesion);
  } catch (err) {
    throw new HttpError(502, `No se pudo abrir la página de cotizaciones de ARCA (${err.message}).`);
  }
  let consulta = fecha;
  for (let n = 0; n < MAX_INTENTOS; n++) {
    consulta = sumarDias(consulta, -1);
    const [anio, mes, dia] = consulta.split('-').map(Number);
    const cuerpo = new URLSearchParams({ ...form.ocultos, dia: String(dia), mes: String(mes), anio: String(anio) }).toString();
    let r;
    try {
      r = await sesion.pedir(form.urlForm, { metodo: 'POST', cuerpo, referer: form.referer });
    } catch (err) {
      throw new HttpError(502, `ARCA no respondió (${err.message}).`);
    }
    const mayus = r.html.toUpperCase();
    if (mayus.includes('THE PAGE CANNOT BE FOUND')) throw new HttpError(502, 'ARCA: página de cotizaciones no encontrada.');
    if (r.html.length < 500 && !mayus.includes('<TABLE')) {
      throw new HttpError(502, `ARCA no devolvió la página de cotizaciones (respuesta de ${r.html.length} bytes; posible bloqueo del sitio).`);
    }
    const filas = parsearTabla(r.html);
    if (!filas.length) continue;                       // sin publicación ese día: uno antes
    const dol = filas.find((f) => f.codigo === 'DOL');
    if (!dol || dol.vendedor <= 0 || dol.comprador <= 0) throw new HttpError(502, 'La respuesta de ARCA no trae el dólar.');
    return {
      fuente: 'ARCA · cotizaciones MARIA',
      fecha_despacho: fecha,
      fecha_publicacion: consulta,
      monedas: filas.map((f) => ({
        ...f,
        pase_vendedor: f.codigo === 'DOL' ? 1 : Math.round((f.vendedor / dol.vendedor) * 1e6) / 1e6,
        pase_comprador: f.codigo === 'DOL' ? 1 : Math.round((f.comprador / dol.comprador) * 1e6) / 1e6,
      })),
    };
  }
  throw new HttpError(404, `ARCA no publicó cotizaciones en los ${MAX_INTENTOS} días anteriores al ${fecha}.`);
}

// ---------- caché ----------
// Una fecha que ya pasó no cambia: se guarda hasta que se reinicia la API.
// La de hoy (o una futura) se vuelve a pedir después de una hora.
const cache = new Map();
const HORA = 60 * 60 * 1000;

function cotizaciones(fecha, opciones = {}) {
  const hoy = aFecha(new Date(Date.now() - 3 * HORA));       // fecha de Argentina
  const guardado = cache.get(fecha);
  if (guardado && (fecha < hoy || Date.now() - guardado.hora < HORA)) return guardado.promesa;
  if (cache.size > 400) cache.clear();
  const promesa = obtener(fecha, opciones).catch((err) => { cache.delete(fecha); throw err; });
  cache.set(fecha, { hora: Date.now(), promesa });
  return promesa;
}

// Con la variación de cada moneda contra la publicación anterior
async function cotizacionesConVariacion(fecha, opciones = {}) {
  const actual = await cotizaciones(fecha, opciones);
  let anterior = null;
  try {
    // La publicación anterior es la que corresponde a los despachos del día de esta publicación
    anterior = await cotizaciones(actual.fecha_publicacion, opciones);
  } catch { /* sin la anterior, la grilla sale sin variación */ }
  const previas = new Map((anterior?.monedas || []).map((m) => [m.codigo, m]));
  return {
    ...actual,
    fecha_publicacion_anterior: anterior?.fecha_publicacion || null,
    monedas: actual.monedas.map((m) => {
      const p = previas.get(m.codigo);
      return { ...m, variacion_vendedor: p && p.vendedor ? (m.vendedor - p.vendedor) / p.vendedor : null };
    }),
  };
}

const vaciarCache = () => cache.clear();

module.exports = { obtener, cotizaciones, cotizacionesConVariacion, parsearTabla, sumarDias, vaciarCache, URL_INICIO };
