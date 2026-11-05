const model = require('../models/impo.model');
const { HttpError } = require('../middlewares/errors');
const { validarNroAduana } = require('../utils/nroAduana');
const { ncmNormalizada, rangoNcm, codigoNcm } = require('../utils/ncm');

// ---------- validaciones de parámetros ----------
function periodoOpcional(valor) {
  if (valor === undefined || valor === '') return null;
  if (!/^\d{6}$/.test(valor)) throw new HttpError(400, 'El periodo va con formato AAAAMM, por ejemplo 202501.');
  return Number(valor);
}

// Código de destinación del KIT: 4 caracteres (IC04, IC06, IT14...)
function destinacionOpcional(valor) {
  if (valor === undefined || valor === '') return null;
  const codigo = String(valor).trim().toUpperCase();
  if (!/^[0-9A-Z]{4}$/.test(codigo)) throw new HttpError(400, 'La destinación es un código de 4 caracteres, por ejemplo IC04.');
  return codigo;
}

function entero(valor, porDefecto, min, max) {
  const n = Number.parseInt(valor, 10);
  if (Number.isNaN(n)) return porDefecto;
  return Math.min(Math.max(n, min), max);
}



// Filtros de Precios: período o rango de períodos, región (primer dígito del
// país), países de procedencia y aduanas (listas separadas por coma)
function listaCodigos(valor, nombre) {
  if (valor === undefined || valor === '') return [];
  const lista = String(valor).split(',').map((v) => v.trim()).filter(Boolean);
  if (lista.length > 30 || lista.some((v) => !/^\d{3}$/.test(v))) {
    throw new HttpError(400, `${nombre} es una lista de códigos de 3 dígitos separados por coma (hasta 30).`);
  }
  return lista;
}

function filtrosPrecios(q) {
  const desde = periodoOpcional(q.desde);
  const hasta = periodoOpcional(q.hasta);
  if (desde && hasta && desde > hasta) throw new HttpError(400, '"desde" tiene que ser anterior o igual a "hasta".');
  const region = q.region === undefined || q.region === '' ? null : String(q.region);
  if (region !== null && !/^[1-9]$/.test(region)) throw new HttpError(400, 'La región es el primer dígito del país: 1 África, 2 América, 3 Asia, 4 Europa, 5 Oceanía.');
  return {
    periodo: periodoOpcional(q.periodo),
    desde, hasta, region,
    origenes: listaCodigos(q.origenes, 'origenes'),
    paises: listaCodigos(q.paises, 'paises'),
    aduanas: listaCodigos(q.aduanas, 'aduanas'),
  };
}

// Envuelve los handlers async para que los errores lleguen a errorHandler
const handler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- endpoints ----------
// /matriz?nivel=seccion|capitulo&seccion=XVI&grupos=CONSUMO,TEMP,ZF
const matriz = handler(async (req, res) => {
  const nivel = req.query.nivel || 'seccion';
  if (!['seccion', 'capitulo'].includes(nivel)) throw new HttpError(400, 'nivel va "seccion" o "capitulo".');
  let seccion = null;
  if (nivel === 'capitulo') {
    seccion = String(req.query.seccion || '').trim().toUpperCase();
    if (!/^[IVX]{1,5}$/.test(seccion)) throw new HttpError(400, 'Para ver capítulos indicá la sección en números romanos, por ejemplo seccion=XVI.');
  }
  res.json(await model.matriz({ nivel, seccion, grupos: listaGrupos(req.query.grupos) }));
});

const resumenSubpartidas = handler(async (req, res) => {
  const { desde, hasta } = rangoNcm(req.query.desde, req.query.hasta);
  // Mismos filtros que Precios; el rango de NCM usa "desde"/"hasta", así que el
  // rango de períodos llega como periodo_desde / periodo_hasta
  const { periodo, desde: pDesde, hasta: pHasta, ...resto } = filtrosPrecios({
    ...req.query, desde: req.query.periodo_desde, hasta: req.query.periodo_hasta,
  });
  res.json(await model.resumenSubpartidas({
    desde, hasta, periodo,
    limite: entero(req.query.limite, 300, 1, 1000),
    filtros: { desde: pDesde, hasta: pHasta, ...resto },
  }));
});

const periodos = handler(async (req, res) => {
  res.json(await model.listarPeriodos());
});

const obtenerDespacho = handler(async (req, res) => {
  // Acepta el número sin la letra y controla el dígito verificador
  const { valido, nro, motivo } = validarNroAduana(req.params.nro);
  if (!valido) throw new HttpError(400, motivo);
  const despacho = await model.obtenerDespacho(nro);
  if (!despacho) throw new HttpError(404, `No hay datos del despacho ${nro}.`);
  res.json(despacho);
});

// Grupos de destinación (CONSUMO,TEMP,ZF,REDES,AAE); sin el parámetro, null = los de por defecto
function listaGrupos(v) {
  if (v === undefined) return null;
  const grupos = String(v).split(',').map((g) => g.trim().toUpperCase()).filter(Boolean);
  if (grupos.some((g) => !/^[A-Z]{2,10}$/.test(g))) throw new HttpError(400, 'grupos es una lista de códigos separados por coma, por ejemplo CONSUMO,TEMP.');
  return grupos;
}

// País del KIT: 3 dígitos
function paisOpcional(v, nombre) {
  if (v === undefined || v === '') return null;
  if (!/^\d{3}$/.test(v)) throw new HttpError(400, `${nombre} es un código de país de 3 dígitos, por ejemplo 310.`);
  return v;
}

// GET /tablero?periodo&pais&ncm
const tablero = handler(async (req, res) => {
  res.json(await model.tablero({
    periodo: periodoOpcional(req.query.periodo),
    pais: paisOpcional(req.query.pais, 'pais'),
    ncm: req.query.ncm ? codigoNcm(req.query.ncm) : null,
    grupos: listaGrupos(req.query.grupos),
  }));
});

const listarDespachos = handler(async (req, res) => {
  const q = req.query;
  const anio = (q.anio || '').trim();
  if (anio && !/^\d{2}$/.test(anio)) throw new HttpError(400, 'El año va con 2 dígitos, como en el número de despacho (26).');
  const aduana = (q.aduana || '').trim();
  if (aduana && !/^\d{3}$/.test(aduana)) throw new HttpError(400, 'La aduana es un código de 3 dígitos, por ejemplo 001.');
  const orden = q.orden || 'carga';
  if (!model.ORDEN_DESPACHOS[orden]) throw new HttpError(400, 'orden va despacho, periodo, importador o carga.');
  const importador = (q.importador || '').trim();
  if (importador && importador.length < 3) throw new HttpError(400, 'Escribí al menos 3 letras del importador.');
  const filtros = {
    periodo: periodoOpcional(q.periodo),
    importador: sinComodines(importador),
    destinacion: destinacionOpcional(q.destinacion),
    anio: anio || null,
    aduana: aduana || null,
    ncm: q.ncm ? codigoNcm(q.ncm) : null,
    origen: paisOpcional(q.origen, 'origen'),
    grupos: listaGrupos(q.grupos),
    orden,
    dir: q.dir === 'asc' ? 'asc' : 'desc',
    pagina: entero(q.pagina, 1, 1, 100000),
    tamanio: entero(q.tamanio, 20, 1, 100),
  };
  res.json(await model.listarDespachos(filtros));
});

const preciosPorNcm = handler(async (req, res) => {
  const ncm = ncmNormalizada(req.params.ncm);
  const resultado = await model.preciosPorNcm(ncm, filtrosPrecios(req.query));
  if (!resultado) throw new HttpError(404, `La posición ${req.params.ncm} no existe en el KIT o no tiene importaciones cargadas.`);
  res.json(resultado);
});

const valoresBajos = handler(async (req, res) => {
  const ncm = ncmNormalizada(req.params.ncm);
  const umbral = req.query.umbral === undefined ? 0.5 : Number(req.query.umbral);
  if (!(umbral > 0 && umbral < 1)) throw new HttpError(400, 'El umbral va entre 0 y 1; 0.5 marca ítems a menos de la mitad del promedio.');
  const resultado = await model.valoresBajos(ncm, {
    filtros: filtrosPrecios(req.query),
    umbral,
    limite: entero(req.query.limite, 50, 1, 200),
  });
  if (!resultado) throw new HttpError(404, `La posición ${req.params.ncm} no existe en el KIT o no tiene importaciones cargadas.`);
  res.json(resultado);
});

const buscarImportadores = handler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 3) throw new HttpError(400, 'Escribí al menos 3 letras del nombre del importador.');
  res.json(await model.buscarImportadores(q, periodoOpcional(req.query.periodo)));
});

// Grilla de importadores: GET /importadores/ranking?periodo&q&orden&dir&desde&limite
const listarImportadores = handler(async (req, res) => {
  const q = req.query;
  const orden = q.orden || 'fob';
  if (!model.ORDEN_IMPORTADORES[orden]) throw new HttpError(400, 'orden va nombre, despachos, items o fob.');
  res.json(await model.listarImportadores({
    periodo: periodoOpcional(q.periodo),
    q: (q.q || '').trim() || null,
    orden,
    dir: q.dir === 'asc' ? 'asc' : 'desc',
    desde: entero(q.desde, 0, 0, 10_000_000),
    limite: entero(q.limite, 100, 1, 100_000),   // el CSV pide la lista completa
  }));
});

// Despachos de un importador: GET /importadores/:id/despachos?periodo&orden&dir&desde&limite
const despachosDeImportador = handler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1 || String(id) !== req.params.id) throw new HttpError(400, 'El importador se indica con su número interno.');
  const q = req.query;
  const orden = q.orden || 'fecha';
  if (!model.ORDEN_DESPACHOS_IMPORTADOR[orden]) throw new HttpError(400, 'orden va fecha, despacho, items o fob.');
  const r = await model.despachosDeImportador(id, {
    periodo: periodoOpcional(q.periodo),
    orden,
    dir: q.dir === 'asc' ? 'asc' : 'desc',
    desde: entero(q.desde, 0, 0, 10_000_000),
    limite: entero(q.limite, 100, 1, 100_000),
  });
  if (!r) throw new HttpError(404, 'No existe ese importador.');
  res.json(r);
});

const triangulaciones = handler(async (req, res) => {
  const q = req.query;
  const pais = (v, nombre) => {
    if (v === undefined || v === '') return null;
    if (!/^\d{3}$/.test(v)) throw new HttpError(400, `${nombre} es un código de país de 3 dígitos, por ejemplo 310.`);
    return v;
  };
  const orden = q.orden || 'fob';
  if (!['ncm', 'origen', 'procedencia', 'items', 'fob'].includes(orden)) {
    throw new HttpError(400, 'orden va ncm, origen, procedencia, items o fob.');
  }
  res.json(await model.triangulaciones({
    periodo: periodoOpcional(q.periodo),
    ncm: q.ncm ? ncmNormalizada(q.ncm) : null,
    origen: pais(q.origen, 'origen'),
    procedencia: pais(q.procedencia, 'procedencia'),
    // Por defecto se excluyen el AAE de Tierra del Fuego y las zonas francas argentinas
    excluirZonas: !['0', 'false', 'no'].includes(String(q.excluir_zonas ?? '').toLowerCase()),
    orden,
    dir: q.dir === 'asc' ? 'asc' : 'desc',
    limite: entero(q.limite, 50, 1, 500),
  }));
});

// Tipo de cambio aduanero de ARCA para los despachos de una fecha (AAAA-MM-DD; por defecto hoy)
const cotizacionesAfip = require('../services/cotizacionesAfip');
const cotizaciones = handler(async (req, res) => {
  const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const fecha = (req.query.fecha || hoy).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T12:00:00Z`))) {
    throw new HttpError(400, 'La fecha va como AAAA-MM-DD, por ejemplo 2026-11-05.');
  }
  if (fecha > hoy) throw new HttpError(400, 'No hay cotizaciones para fechas futuras.');
  if (fecha < '2000-01-01') throw new HttpError(400, 'La fecha es demasiado antigua.');
  const r = await cotizacionesAfip.cotizacionesConVariacion(fecha);
  // Descripción del KIT cuando ARCA no la trae
  const { divisas } = await model.catalogos();
  const kit = new Map((divisas || []).map((d) => [d.codigo, d.descrip]));
  res.json({ ...r, monedas: r.monedas.map((m) => ({ ...m, descripcion: m.descripcion || kit.get(m.codigo) || '' })) });
});

const catalogos = handler(async (req, res) => {
  res.json(await model.catalogos());
});

// ---------- sugerencias (autocompletado) ----------
// Escapa los comodines de LIKE en lo que escribe el usuario
const sinComodines = (t) => t.replace(/[\\%_]/g, (x) => `\\${x}`);

// /sugerencias/despachos?prefijo=26001IC04 : desde 5 caracteres (año + aduana)
const sugerirDespachos = handler(async (req, res) => {
  const prefijo = String(req.query.prefijo || '').trim().toUpperCase();
  if (!/^[0-9A-Z]{5,16}$/.test(prefijo)) {
    throw new HttpError(400, 'El prefijo lleva de 5 a 16 caracteres: año y aduana como mínimo, por ejemplo 26001.');
  }
  res.json(await model.sugerirDespachos(prefijo, periodoOpcional(req.query.periodo), entero(req.query.limite, 15, 1, 50)));
});

// /sugerencias/ncm?q=847130 o ?q=notebook : código (2 a 8 dígitos) o texto (3 letras o más)
const sugerirNcm = handler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limite = entero(req.query.limite, 15, 1, 50);
  const digitos = q.replace(/\./g, '');
  if (/^\d{2,8}$/.test(digitos)) {
    // Arma el prefijo con los puntos de PosicionSIM: 8471.30.12
    const prefijo = [digitos.slice(0, 4), digitos.slice(4, 6), digitos.slice(6, 8)].filter(Boolean).join('.');
    return res.json(await model.sugerirNcm({ prefijo, limite }));
  }
  if (q.length < 3) throw new HttpError(400, 'Escribí al menos 2 dígitos de la posición o 3 letras de la descripción.');
  res.json(await model.sugerirNcm({ texto: sinComodines(q), limite }));
});

// /sugerencias/importadores?q=zys : 3 letras o más
const sugerirImportadores = handler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) throw new HttpError(400, 'Escribí al menos 3 letras del nombre del importador.');
  res.json(await model.sugerirImportadores(sinComodines(q), entero(req.query.limite, 15, 1, 50)));
});

module.exports = {
  cotizaciones,
  tablero,
  listarImportadores,
  despachosDeImportador,
  matriz,
  periodos,
  resumenSubpartidas,
  obtenerDespacho,
  listarDespachos,
  preciosPorNcm,
  valoresBajos,
  buscarImportadores,
  triangulaciones,
  catalogos,
  sugerirDespachos,
  sugerirNcm,
  sugerirImportadores,
};
