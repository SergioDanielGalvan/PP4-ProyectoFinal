const model = require('../models/impo.model');
const { HttpError } = require('../middlewares/errors');
const { validarNroAduana } = require('../utils/nroAduana');

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

function ncmNormalizada(valor) {
  const digitos = String(valor).replace(/\./g, '');
  if (!/^\d{8}$/.test(digitos)) throw new HttpError(400, 'La NCM lleva 8 dígitos, con o sin puntos (8471.30.12).');
  return digitos;
}

// Envuelve los handlers async para que los errores lleguen a errorHandler
const handler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- endpoints ----------
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

const listarDespachos = handler(async (req, res) => {
  const filtros = {
    periodo: periodoOpcional(req.query.periodo),
    importador: (req.query.importador || '').trim(),
    destinacion: destinacionOpcional(req.query.destinacion),
    pagina: entero(req.query.pagina, 1, 1, 10000),
    tamanio: entero(req.query.tamanio, 20, 1, 100),
  };
  res.json(await model.listarDespachos(filtros));
});

const preciosPorNcm = handler(async (req, res) => {
  const ncm = ncmNormalizada(req.params.ncm);
  const resultado = await model.preciosPorNcm(ncm, periodoOpcional(req.query.periodo));
  if (!resultado) throw new HttpError(404, `La NCM ${req.params.ncm} no tiene importaciones cargadas.`);
  res.json(resultado);
});

const valoresBajos = handler(async (req, res) => {
  const ncm = ncmNormalizada(req.params.ncm);
  const umbral = req.query.umbral === undefined ? 0.5 : Number(req.query.umbral);
  if (!(umbral > 0 && umbral < 1)) throw new HttpError(400, 'El umbral va entre 0 y 1; 0.5 marca ítems a menos de la mitad del promedio.');
  const resultado = await model.valoresBajos(ncm, {
    periodo: periodoOpcional(req.query.periodo),
    umbral,
    limite: entero(req.query.limite, 50, 1, 200),
  });
  if (!resultado) throw new HttpError(404, `La NCM ${req.params.ncm} no tiene importaciones cargadas.`);
  res.json(resultado);
});

const buscarImportadores = handler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 3) throw new HttpError(400, 'Escribí al menos 3 letras del nombre del importador.');
  res.json(await model.buscarImportadores(q, periodoOpcional(req.query.periodo)));
});

const triangulaciones = handler(async (req, res) => {
  res.json(await model.triangulaciones(
    periodoOpcional(req.query.periodo),
    entero(req.query.limite, 50, 1, 200),
  ));
});

module.exports = {
  periodos,
  obtenerDespacho,
  listarDespachos,
  preciosPorNcm,
  valoresBajos,
  buscarImportadores,
  triangulaciones,
};
