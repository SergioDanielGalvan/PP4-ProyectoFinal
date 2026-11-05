// Tipo de cambio aduanero de ARCA: lectura de la tabla, seguimiento del
// formulario y retroceso por feriados, sin salir a Internet (fetch simulado).
// El HTML es una reconstrucción con la forma que espera el lector original
// (VB6 y PHP del Módulo MARIA): bloque "DISPLAY DE DATOS", filas de 5 celdas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { obtener, parsearTabla, sumarDias } = require('../../src/services/cotizacionesAfip');

const relleno = '<!-- ' + 'x'.repeat(600) + ' -->';
const fila = (cod, desc, vend, comp) =>
  `<TR>\r\n\t<TD><FONT>${cod} - ${desc}</FONT></TD><TD>04/11/2026</TD><TD>${vend}</TD><TD>${comp}</TD>\r\n</TR>\r\n<TR></TR>`;
const tabla = (filas) => `<html><body>${relleno}<TABLE><!-- DISPLAY DE DATOS -->${filas.join('')}</TABLE></body></html>`;

test('lee código, descripción, vendedor y comprador de cada fila', () => {
  const filas = parsearTabla(tabla([
    fila('DOL', 'DOLAR ESTADOUNIDENSE', '1465.50', '1455.50'),
    fila('060', 'EURO', '1.690,25', '1.675,10'),
  ]));
  assert.deepEqual(filas, [
    { codigo: 'DOL', descripcion: 'DOLAR ESTADOUNIDENSE', vendedor: 1465.5, comprador: 1455.5 },
    { codigo: '060', descripcion: 'EURO', vendedor: 1690.25, comprador: 1675.1 },
  ]);
  assert.deepEqual(parsearTabla('<html>sin tabla</html>'), []);
});

test('resta días sin problemas de huso horario', () => {
  assert.equal(sumarDias('2026-03-01', -1), '2026-02-28');
  assert.equal(sumarDias('2026-01-01', -1), '2025-12-31');
});

// Simula el sitio: página vieja con <meta refresh>, página nueva con el formulario
// (y una cookie de sesión), y el POST que responde según la fecha.
function sitioSimulado(publicaciones) {
  const pedidos = [];
  const fetchImpl = async (url, opciones) => {
    pedidos.push({ url, metodo: opciones.method, cuerpo: opciones.body, cookie: opciones.headers.Cookie });
    const respuesta = (html, headers = {}) => new Response(html, { status: 200, headers: { 'content-type': 'text/html', ...headers } });
    if (url === 'https://www.afip.gob.ar/aduana/cotizacionesMaria/') {
      return respuesta('<meta http-equiv="refresh" content="0;url=https://serviciosweb.afip.gob.ar/aduana/cotizacionesMaria/default.asp">');
    }
    if (url.endsWith('/default.asp')) {
      return respuesta('<form method="post" action="consulta.asp"><input type="hidden" name="tk" value="abc"></form>',
        { 'set-cookie': 'ASPSESSION=123; path=/' });
    }
    if (url.endsWith('/consulta.asp')) {
      const p = new URLSearchParams(opciones.body);
      const fecha = `${p.get('anio')}-${p.get('mes').padStart(2, '0')}-${p.get('dia').padStart(2, '0')}`;
      return respuesta(tabla(publicaciones[fecha] || []));
    }
    return new Response('', { status: 404 });
  };
  return { fetchImpl, pedidos };
}

test('sigue la redirección, postea con la cookie y retrocede hasta la última publicación', async () => {
  // Despachos del lunes 09/11: el domingo 08 y el sábado 07 no hay publicación; el viernes 06 sí
  const { fetchImpl, pedidos } = sitioSimulado({
    '2026-11-06': [fila('DOL', 'DOLAR', '1465', '1455'), fila('060', 'EURO', '1700', '1690')],
  });
  const r = await obtener('2026-11-09', { fetchImpl });
  assert.equal(r.fecha_despacho, '2026-11-09');
  assert.equal(r.fecha_publicacion, '2026-11-06');
  const euro = r.monedas.find((m) => m.codigo === '060');
  assert.equal(euro.vendedor, 1700);
  assert.equal(euro.pase_vendedor, Math.round((1700 / 1465) * 1e6) / 1e6);
  const posteos = pedidos.filter((p) => p.metodo === 'POST');
  assert.equal(posteos.length, 3, 'probó 08, 07 y 06');
  assert.ok(posteos.every((p) => p.cookie === 'ASPSESSION=123'), 'manda la cookie de la sesión');
  assert.match(posteos[0].cuerpo, /tk=abc/, 'manda los campos ocultos del formulario');
  assert.match(posteos[0].cuerpo, /dia=8&mes=11&anio=2026/, 'día y mes sin cero adelante, como el VB6');
});

test('sin el dólar o sin publicaciones, responde con un error claro', async () => {
  const sinDolar = sitioSimulado({ '2026-11-04': [fila('060', 'EURO', '1700', '1690')] });
  await assert.rejects(obtener('2026-11-05', { fetchImpl: sinDolar.fetchImpl }), { status: 502, message: /dólar/ });
  const vacio = sitioSimulado({});
  await assert.rejects(obtener('2026-11-05', { fetchImpl: vacio.fetchImpl }), { status: 404, message: /10 días/ });
});
