// Dígito verificador del número de destinación (traducción de
// NroAduana_Valido, Rutinas.bas, VB6):
//   suma de los códigos ASCII de los 15 primeros caracteres, módulo 23, + 65
//   (letra A..W); en exportación ('MANE' en la posición 5, se calcula como
//   'MANI') se suma 1; I, O y Q (y el desborde) se reemplazan por X, Y, Z, A.
const REEMPLAZOS = { 73: 88, 79: 89, 81: 90, 91: 65 }; // I->X, O->Y, Q->Z, [->A

function digitoVerificador(nro15) {
  let s = String(nro15).toUpperCase().slice(0, 15);
  const esExpo = s.indexOf('MANE') === 4; // InStr(...) = 5 en VB6
  if (esExpo) s = s.replace('MANE', 'MANI');
  let codigo = ([...s].reduce((suma, c) => suma + c.charCodeAt(0), 0) % 23) + 65;
  if (esExpo) codigo += 1;
  return String.fromCharCode(REEMPLAZOS[codigo] || codigo);
}

// Devuelve { valido, nro, motivo }. Acepta el número sin la letra (15
// caracteres) y la completa.
function validarNroAduana(entrada) {
  const nro = String(entrada || '').trim().toUpperCase();
  if (!nro) return { valido: false, motivo: 'El número de destinación no puede estar vacío.' };
  if (nro.length !== 15 && nro.length !== 16) {
    return { valido: false, motivo: 'El número de destinación tiene 16 caracteres (o 15 sin el verificador), por ejemplo 26001IC04151676V.' };
  }
  if (!/^\d{2}$/.test(nro.slice(0, 2))) return { valido: false, motivo: 'Error en el año del número de destinación.' };
  if (!/^\d{3}$/.test(nro.slice(2, 5))) return { valido: false, motivo: 'Aduana errónea en el número de destinación.' };
  if (!/^[0-9A-Z]{4}$/.test(nro.slice(5, 9))) return { valido: false, motivo: 'Destinación errónea en el número de destinación.' };
  if (!/^\d{6}$/.test(nro.slice(9, 15))) return { valido: false, motivo: 'Número erróneo en el número de destinación.' };

  const dv = digitoVerificador(nro);
  if (nro.length === 15) return { valido: true, nro: nro + dv };
  if (nro[15] !== dv) {
    return { valido: false, motivo: `Dígito verificador erróneo: para ${nro.slice(0, 15)} corresponde la letra ${dv}.` };
  }
  return { valido: true, nro };
}

module.exports = { digitoVerificador, validarNroAduana };
