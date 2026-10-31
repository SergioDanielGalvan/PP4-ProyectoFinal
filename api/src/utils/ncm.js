// Validación de códigos NCM que llegan en los pedidos. Funciones puras: no
// tocan la base, por eso se prueban por separado (test/unit/ncm.test.js).
const { HttpError } = require('../middlewares/errors');

// Código completo de partida (4 dígitos), subpartida (6) o NCM (8), con o sin puntos
function ncmNormalizada(valor) {
  const digitos = String(valor).replace(/\./g, '');
  if (!/^(\d{4}|\d{6}|\d{8})$/.test(digitos)) {
    throw new HttpError(400, 'Indicá una partida completa (8471), una subpartida (8471.30) o una NCM (8471.30.12).');
  }
  return digitos;
}

// Rango de NCM: 2 (capítulo), 4 (partida), 6 (subpartida SA) u 8 dígitos (NCM).
// "desde" se completa con 0 y "hasta" con 9; sin "hasta", el rango es "desde".
function rangoNcm(desde, hasta) {
  const limpiar = (v) => String(v || '').replace(/\./g, '').trim();
  const d = limpiar(desde);
  const h = limpiar(hasta) || d;
  for (const v of [d, h]) {
    if (!/^\d{2,8}$/.test(v)) {
      throw new HttpError(400, 'El rango va de 2 a 8 dígitos: capítulo (84), partida (8471), subpartida (8471.30) o NCM (8471.30.12).');
    }
  }
  const r = { desde: d.padEnd(8, '0'), hasta: h.padEnd(8, '9') };
  if (r.desde > r.hasta) throw new HttpError(400, '"desde" tiene que ser menor o igual que "hasta".');
  return r;
}

module.exports = { ncmNormalizada, rangoNcm };
