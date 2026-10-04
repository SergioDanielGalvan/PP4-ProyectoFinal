// Lee el .lst de importación de ARCA (desde el ZIP o suelto) y lo convierte
// en líneas limpias para LOAD DATA, sin descomprimir nada a disco.
//
// El archivo es un listado de mainframe: salto de página (\f) al inicio,
// encabezado y línea de guiones (que pueden repetirse), CRLF y cada línea
// rellena con espacios hasta ~700 caracteres. Por eso 5,7 GB de archivo son
// bastante menos de datos: acá se descarta el relleno antes de enviarlo.
const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');
const yauzl = require('yauzl');

const PATRON_IMPO = /^impo_(\d{6})\.lst$/i;
const CAMPOS = 16;

// Devuelve { stream, nombre, periodo, bytes } del archivo de importación.
function abrirArchivoImpo(ruta) {
  const nombre = path.basename(ruta);
  if (/\.lst$/i.test(nombre)) {
    const m = PATRON_IMPO.exec(nombre);
    return Promise.resolve({
      stream: fs.createReadStream(ruta),
      nombre,
      periodo: m ? Number(m[1]) : null,
      bytes: fs.statSync(ruta).size,
    });
  }
  return new Promise((resolve, reject) => {
    yauzl.open(ruta, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const vistos = [];
      zip.on('entry', (entrada) => {
        const base = path.basename(entrada.fileName);
        vistos.push(base);
        const m = PATRON_IMPO.exec(base);
        if (!m) return zip.readEntry();
        zip.openReadStream(entrada, (e, stream) => {
          if (e) return reject(e);
          stream.on('end', () => zip.close());
          resolve({ stream, nombre: base, periodo: Number(m[1]), bytes: entrada.uncompressedSize });
        });
      });
      zip.on('end', () => reject(new Error(
        `El ZIP no tiene un archivo impo_AAAAMM.lst. Contiene: ${vistos.join(', ') || '(vacío)'}`)));
      zip.readEntry();
    });
  });
}

// Transform: bytes latin1 del .lst -> líneas UTF-8 con los 16 campos recortados.
// Descarta encabezados, guiones y líneas vacías; cuenta lo que descarta.
class LimpiadorLst extends Transform {
  constructor() {
    super();
    this.resto = '';
    this.lineas = 0;
    this.descartadas = 0;
    this.malformadas = 0;
    this.bytesLeidos = 0;
  }

  _transform(chunk, _enc, listo) {
    this.bytesLeidos += chunk.length;
    // latin1 es de un byte por carácter: cortar el chunk nunca rompe un carácter
    const texto = this.resto + chunk.toString('latin1');
    const partes = texto.split('\n');
    this.resto = partes.pop();
    const salida = [];
    for (const linea of partes) {
      const limpia = this.limpiar(linea);
      if (limpia !== null) salida.push(limpia);
    }
    if (salida.length) this.push(salida.join('\n') + '\n', 'utf8');
    listo();
  }

  _flush(listo) {
    const limpia = this.limpiar(this.resto);
    if (limpia !== null) this.push(limpia + '\n', 'utf8');
    listo();
  }

  limpiar(linea) {
    const campos = linea.replace(/[\f\r]/g, '').split("'");
    const aduana = campos[0].trim();
    if (!/^\d{3}$/.test(aduana)) {
      this.descartadas += 1; // encabezado, guiones o línea vacía
      return null;
    }
    if (campos.length < CAMPOS) {
      this.malformadas += 1;
      return null;
    }
    this.lineas += 1;
    const valores = campos.slice(0, CAMPOS).map((c) => c.trim());
    valores[4] = valores[4].toUpperCase(); // importador
    return valores.join("'");
  }
}

module.exports = { abrirArchivoImpo, LimpiadorLst };
