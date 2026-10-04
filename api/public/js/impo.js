const API = '/api/impo';
const $ = (sel) => document.querySelector(sel);

const fmtNum = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const fmtUsd = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD' });
const fmtImporte = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const importe = (v) => (v === null || v === undefined ? '' : fmtImporte.format(v));
const num = (v) => (v === null || v === undefined ? '' : fmtNum.format(v));
const usd = (v) => (v === null || v === undefined ? '' : fmtUsd.format(v));

// Escapa texto que viene de la base antes de meterlo en el HTML
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const codigo = (cod, desc) => (desc ? `${esc(desc)} <span class="codigo">${esc(cod)}</span>` : `<span class="codigo">${esc(cod)}</span>`);

async function api(ruta, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
  const resp = await fetch(`${API}${ruta}${qs.size ? `?${qs}` : ''}`);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `Error ${resp.status}`);
  return data;
}

function mensaje(destino, texto, error = false) {
  destino.innerHTML = `<p class="mensaje${error ? ' error' : ''}">${esc(texto)}</p>`;
}

function tabla(columnas, filas) {
  const th = columnas.map((c) => `<th${c.n ? ' class="n"' : ''}>${c.titulo}</th>`).join('');
  return `<div class="tabla"><table><thead><tr>${th}</tr></thead><tbody>${filas.join('')}</tbody></table></div>`;
}

const periodo = () => $('#periodo').value;
// Las descripciones NCM del KIT llegan a 1.500 caracteres: se muestra el comienzo
const corto = (t, n = 110) => (t && t.length > n ? `${t.slice(0, n).trim()}…` : t || '');
const mes = (p) => `${String(p).slice(4)}/${String(p).slice(0, 4)}`;

// ---------- pestañas ----------
document.querySelectorAll('[role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('[role="tab"]').forEach((t) => t.setAttribute('aria-selected', t === tab));
    document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== tab.dataset.panel; });
    if (tab.dataset.panel === 'p-triangulaciones') cargarTriangulaciones();
  });
});

// ---------- periodos ----------
async function cargarPeriodos() {
  try {
    const periodos = await api('/periodos');
    for (const p of periodos) {
      const texto = `${mes(p.periodo)} (${num(p.caratulas)} destinaciones)`;
      $('#periodo').insertAdjacentHTML('beforeend', `<option value="${p.periodo}">${texto}</option>`);
    }
  } catch (err) {
    mensaje($('#r-lista'), `No se pudo conectar con la API: ${err.message}`, true);
  }
}

$('#periodo').addEventListener('change', () => {
  cargarLista();
  const activo = document.querySelector('[aria-selected="true"]').dataset.panel;
  if (activo === 'p-triangulaciones') cargarTriangulaciones();
});

// ---------- destinación ----------
function nroEnCasillas(nro) {
  const partes = [
    [nro.slice(0, 2), 'Año'], [nro.slice(2, 5), 'Aduana'], [nro.slice(5, 9), 'Subrégimen'],
    [nro.slice(9, 15), 'Número'], [nro.slice(15), 'Verificador'],
  ];
  return `<div class="nro" aria-label="Destinación ${nro}">${partes.map(([v, t]) => `<span title="${t}">${esc(v)}</span>`).join('')}</div>`;
}

async function mostrarDestinacion(nro) {
  const destino = $('#r-destinacion');
  try {
    const d = await api(`/destinaciones/${encodeURIComponent(nro)}`);
    // FOB por ítem viene en USD; FOB total, en la divisa de la factura
    const fobItems = d.items.reduce((s, it) => s + (it.fob_usd || 0), 0);
    const enDolares = d.divisa === 'DOL';
    const faltante = enDolares ? (d.fob_total_divisa || 0) - fobItems : 0;
    const salteados = d.items.length < Math.max(...d.items.map((it) => it.item));
    const filas = d.items.flatMap((it) => [
      `<tr>
        <td class="n">${it.item}</td>
        <td class="codigo">${esc(it.ncm)}</td>
        <td class="desc" title="${esc(it.ncm_desc)}">${esc(corto(it.ncm_desc))}</td>
        <td>${codigo(it.pais_origen, it.pais_origen_desc)}</td>
        <td class="n">${num(it.cantidad)} ${esc(it.unidad_desc || it.unidad)}</td>
        <td class="n">${usd(it.valor_unitario)}</td>
        <td class="n">${usd(it.fob_usd)}</td>
      </tr>`,
      `<tr class="aranceles"><td></td><td colspan="6">${
        it.aranceles.map((a) => `${esc(a.concepto_desc || a.concepto)}: ${importe(a.monto)}`).join(' · ') || 'Sin aranceles'
      }</td></tr>`,
    ]);
    destino.innerHTML = `
      ${nroEnCasillas(d.nro_destinacion)}
      <dl class="datos">
        <div><dt>Importador</dt><dd>${esc(d.importador)}</dd></div>
        <div><dt>Periodo</dt><dd>${esc(mes(d.periodo))}</dd></div>
        <div><dt>Destinación</dt><dd>${esc(d.tipo_destinacion_desc || d.tipo_destinacion)}</dd></div>
        <div><dt>Aduana</dt><dd>${codigo(d.aduana, d.aduana_desc)}</dd></div>
        <div><dt>Procedencia</dt><dd>${codigo(d.pais_procedencia, d.pais_procedencia_desc)}</dd></div>
        <div><dt>Medio de transporte</dt><dd>${esc(d.medio_transporte_desc || d.medio_transporte)}</dd></div>
        <div><dt>Divisa de la factura</dt><dd>${codigo(d.divisa, d.divisa_desc)}</dd></div>
        <div><dt>FOB total factura</dt><dd>${esc(d.divisa_abrev || d.divisa)} ${importe(d.fob_total_divisa)}</dd></div>
      </dl>
      ${tabla([
        { titulo: 'Ítem', n: true }, { titulo: 'NCM' }, { titulo: 'Mercadería' },
        { titulo: 'Origen' }, { titulo: 'Cantidad', n: true }, { titulo: 'Valor unitario', n: true },
        { titulo: 'FOB', n: true },
      ], filas)}
      ${faltante > 1 ? `<p class="mensaje">Los ítems suman ${usd(fobItems)} contra un FOB total de ${usd(d.fob_total_divisa)}: ${usd(faltante)} corresponden a ítems que no vienen en el archivo.</p>`
        : salteados ? '<p class="mensaje">Hay números de ítem salteados: esos ítems no vienen en el archivo.</p>' : ''}`;
  } catch (err) {
    mensaje(destino, err.message, true);
  }
}

$('#f-destinacion').addEventListener('submit', (e) => {
  e.preventDefault();
  mostrarDestinacion($('#nro').value.trim().toUpperCase());
});

async function cargarLista() {
  const destino = $('#r-lista');
  try {
    const r = await api('/destinaciones', { periodo: periodo(), tamanio: 10 });
    if (r.total === 0) return mensaje(destino, 'No hay destinaciones en este periodo. Cargá un mes con npm run mes en la carpeta carga.');
    const filas = r.resultados.map((d) => `
      <tr>
        <td><a href="#" class="nro-link codigo" data-nro="${esc(d.nro_destinacion)}">${esc(d.nro_destinacion)}</a></td>
        <td>${esc(mes(d.periodo))}</td>
        <td>${esc(d.importador)}</td>
        <td class="n">${d.items}</td>
        <td class="n">${esc(d.divisa === 'DOL' ? 'US$' : (d.divisa_abrev || d.divisa))} ${importe(d.fob_total_divisa)}</td>
      </tr>`);
    destino.innerHTML = tabla([
      { titulo: 'Destinación' }, { titulo: 'Periodo' }, { titulo: 'Importador' },
      { titulo: 'Ítems', n: true }, { titulo: 'FOB total factura', n: true },
    ], filas);
  } catch (err) {
    mensaje(destino, err.message, true);
  }
}

$('#r-lista').addEventListener('click', (e) => {
  const link = e.target.closest('[data-nro]');
  if (!link) return;
  e.preventDefault();
  $('#nro').value = link.dataset.nro;
  mostrarDestinacion(link.dataset.nro);
  $('#r-destinacion').scrollIntoView({ behavior: 'smooth' });
});

// ---------- precios por NCM ----------
$('#f-ncm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const destino = $('#r-ncm');
  const ncm = $('#ncm').value.trim();
  try {
    const [precios, bajos] = await Promise.all([
      api(`/ncm/${encodeURIComponent(ncm)}/precios`, { periodo: periodo() }),
      api(`/ncm/${encodeURIComponent(ncm)}/valores-bajos`, { periodo: periodo(), umbral: $('#umbral').value }),
    ]);
    const filasOrigen = precios.origenes.map((o) => `
      <tr>
        <td>${codigo(o.pais_origen, o.pais_origen_desc)}</td>
        <td class="codigo">${esc(o.unidad)}</td>
        <td class="n">${o.items}</td>
        <td class="n">${num(o.cantidad)}</td>
        <td class="n">${usd(o.vu_min)}</td>
        <td class="n">${usd(o.vu_promedio)}</td>
        <td class="n">${usd(o.vu_max)}</td>
        <td class="n">${usd(o.fob_usd)}</td>
      </tr>`);
    const filasBajos = bajos.items.map((b) => `
      <tr class="bajo">
        <td class="codigo">${esc(b.nro_destinacion)}</td>
        <td>${esc(b.importador)}</td>
        <td class="codigo">${esc(b.pais_origen)}</td>
        <td class="n">${num(b.cantidad)}</td>
        <td class="n">${usd(b.valor_unitario)}</td>
        <td class="n">${usd(b.vu_promedio)}</td>
        <td class="n proporcion">${num(b.proporcion * 100)} %</td>
      </tr>`);
    destino.innerHTML = `
      <h2>${esc(precios.ncm)}</h2>
      <p class="nota">${esc(corto(precios.descripcion, 300) || 'Sin descripción en el KIT.')}</p>
      ${tabla([
        { titulo: 'Origen' }, { titulo: 'Unidad' }, { titulo: 'Ítems', n: true }, { titulo: 'Cantidad', n: true },
        { titulo: 'Mínimo', n: true }, { titulo: 'Promedio', n: true }, { titulo: 'Máximo', n: true },
        { titulo: 'FOB', n: true },
      ], filasOrigen)}
      <h2>Valores unitarios por debajo del ${num(bajos.umbral * 100)} % del promedio</h2>
      ${filasBajos.length ? tabla([
        { titulo: 'Destinación' }, { titulo: 'Importador' }, { titulo: 'Origen' }, { titulo: 'Cantidad', n: true },
        { titulo: 'Declarado', n: true }, { titulo: 'Promedio NCM', n: true }, { titulo: 'Proporción', n: true },
      ], filasBajos) : '<p class="mensaje">Ningún ítem queda por debajo de ese umbral.</p>'}`;
  } catch (err) {
    mensaje(destino, err.message, true);
  }
});

// ---------- importadores ----------
$('#f-importadores').addEventListener('submit', async (e) => {
  e.preventDefault();
  const destino = $('#r-importadores');
  try {
    const rows = await api('/importadores', { q: $('#q').value.trim(), periodo: periodo() });
    if (rows.length === 0) return mensaje(destino, 'Ningún importador coincide con ese nombre en el periodo elegido.');
    destino.innerHTML = tabla([
      { titulo: 'Importador' }, { titulo: 'Destinaciones', n: true }, { titulo: 'Ítems', n: true },
      { titulo: 'FOB', n: true },
    ], rows.map((r) => `
      <tr><td>${esc(r.nombre)}</td><td class="n">${r.destinaciones}</td><td class="n">${r.items}</td>
      <td class="n">${usd(r.fob_usd)}</td></tr>`));
  } catch (err) {
    mensaje(destino, err.message, true);
  }
});

// ---------- triangulaciones ----------
async function cargarTriangulaciones() {
  const destino = $('#r-triangulaciones');
  try {
    const rows = await api('/triangulaciones', { periodo: periodo() });
    if (rows.length === 0) return mensaje(destino, 'No hay triangulaciones en el periodo elegido.');
    destino.innerHTML = tabla([
      { titulo: 'NCM' }, { titulo: 'Origen' }, { titulo: 'Procedencia' },
      { titulo: 'Ítems', n: true }, { titulo: 'FOB', n: true },
    ], rows.map((r) => `
      <tr><td class="codigo">${esc(r.ncm)}</td>
      <td>${codigo(r.pais_origen, r.pais_origen_desc)}</td>
      <td>${codigo(r.pais_procedencia, r.pais_procedencia_desc)}</td>
      <td class="n">${r.items}</td><td class="n">${usd(r.fob_usd)}</td></tr>`));
  } catch (err) {
    mensaje(destino, err.message, true);
  }
}

cargarPeriodos().then(cargarLista);
