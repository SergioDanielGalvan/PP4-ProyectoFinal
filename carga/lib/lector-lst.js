// Lee el .lst de importación de ARCA (desde el ZIP o suelto) y lo convierte
// en líneas limpias para LOAD DATA, sin descomprimir nada a disco.
//
// El archivo es un listado de mainframe: salto de página (\f) al inicio,
// encabezado y línea de guiones (que pueden repetirse), CRLF y cada línea
// rellena con espacios hasta ~700 caracteres. Por eso 5,7 GB de archivo son
// bastante menos de datos: acá se descarta el relleno antes de enviarlo.
const fs = require('fs');
const path = require('path');
const { Transform, PassThrough } = require('stream');
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
  return abrirZipTolerante(ruta).then((zip) => new Promise((resolve, reject) => {
    const vistos = [];
    zip.on('error', reject);
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
  }));
}

// Algunos ZIP de ARCA traen bytes sobrantes después del final del ZIP (o un
// comentario declarado que no está). Windows los abre igual; yauzl no. Se busca
// el registro de fin de directorio ("PK\x05\x06") y se abre el ZIP con el
// tamaño que él declara: lo que sobra se ignora y lo que falta se completa con
// ceros (es sólo el comentario, no hay datos ahí).
async function abrirZipTolerante(ruta) {
  const fd = await fs.promises.open(ruta, 'r');
  const { size } = await fd.stat();
  const largoCola = Math.min(size, 22 + 65535 + 4096);
  const cola = Buffer.alloc(largoCola);
  await fd.read(cola, 0, largoCola, size - largoCola);
  await fd.close();

  const firma = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const pos = cola.lastIndexOf(firma);
  if (pos < 0 || pos + 22 > cola.length) throw new Error(`${path.basename(ruta)} no parece un ZIP válido`);
  const finZip = size - largoCola + pos + 22 + cola.readUInt16LE(pos + 20);
  if (finZip !== size) {
    console.log(`Aviso: el ZIP tiene ${Math.abs(size - finZip)} bytes ${finZip < size ? 'sobrantes al final' : 'de comentario faltantes'}; se ignoran.`);
  }

  const lector = new LectorAcotado(ruta, size);
  return new Promise((resolve, reject) => {
    yauzl.fromRandomAccessReader(lector, finZip, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return reject(err);
      resolve(zip);
    });
  });
}

// Lee del archivo real y devuelve ceros más allá de su final
class LectorAcotado extends yauzl.RandomAccessReader {
  constructor(ruta, tamanioReal) {
    super();
    this.ruta = ruta;
    this.tamanioReal = tamanioReal;
  }

  _readStreamForRange(inicio, fin) {
    const salida = new PassThrough();
    const finReal = Math.min(fin, this.tamanioReal);
    const ceros = Math.max(0, fin - Math.max(inicio, this.tamanioReal));
    const completar = () => salida.end(ceros ? Buffer.alloc(ceros) : undefined);
    if (inicio < finReal) {
      const real = fs.createReadStream(this.ruta, { start: inicio, end: finReal - 1 });
      real.on('error', (e) => salida.destroy(e));
      real.on('end', completar);
      real.pipe(salida, { end: false });
    } else {
      completar();
    }
    return salida;
  }
}

// Transform: bytes latin1 del .lst -> líneas UTF-8 con los 16 campos recortados.
// Descarta encabezados, guiones y líneas vacías; cuenta lo que descarta.
class LimpiadorLst extends Transform {
  constructor() {
    // Sale texto (cada trozo, varias líneas completas), no bytes
    super({ readableObjectMode: true });
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
    if (salida.length) this.push(salida.join('\n') + '\n');
    listo();
  }

  _flush(listo) {
    const limpia = this.limpiar(this.resto);
    if (limpia !== null) this.push(limpia + '\n');
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
