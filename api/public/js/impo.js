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

// ---------- sesión (JWT) ----------
// El token se guarda en localStorage y va en cada pedido. Si la API responde 401
// (AUTH_ENABLED=true o token vencido) se pide usuario y clave y se repite el pedido.
const CLAVE_TOKEN = 'comex_token';
const leerToken = () => { try { return localStorage.getItem(CLAVE_TOKEN); } catch { return null; } };
const guardarToken = (t) => { try { t ? localStorage.setItem(CLAVE_TOKEN, t) : localStorage.removeItem(CLAVE_TOKEN); } catch { /* sin storage */ } };
let tokenEnMemoria = leerToken();
let loginPendiente = null;

function mostrarSesion(usuario) {
  const s = $('#sesion');
  if (!usuario) { s.hidden = true; s.innerHTML = ''; return; }
  s.hidden = false;
  s.innerHTML = `${esc(usuario.nombre || usuario.usuario)} · <button type="button" id="salir">Salir</button>`;
}

function pedirLogin() {
  if (loginPendiente) return loginPendiente;
  loginPendiente = new Promise((resolve) => {
    const dialogo = $('#login');
    $('#l-error').hidden = true;
    dialogo.showModal();
    $('#f-login').onsubmit = async (e) => {
      e.preventDefault();
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: $('#l-usuario').value, clave: $('#l-clave').value }),
      });
      const data = await resp.json();
      if (!resp.ok) { $('#l-error').textContent = data.error; $('#l-error').hidden = false; return; }
      tokenEnMemoria = data.token;
      guardarToken(data.token);
      mostrarSesion(data.usuario);
      $('#l-clave').value = '';
      dialogo.close();
      loginPendiente = null;
      resolve();
    };
  });
  return loginPendiente;
}

$('#sesion').addEventListener('click', (e) => {
  if (e.target.id !== 'salir') return;
  tokenEnMemoria = null;
  guardarToken(null);
  mostrarSesion(null);
  location.reload();
});

async function api(ruta, params = {}, reintento = true) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
  const headers = tokenEnMemoria ? { Authorization: `Bearer ${tokenEnMemoria}` } : {};
  const resp = await fetch(`${API}${ruta}${qs.size ? `?${qs}` : ''}`, { headers });
  if (resp.status === 401 && reintento) {
    tokenEnMemoria = null;
    guardarToken(null);
    await pedirLogin();
    return api(ruta, params, false);
  }
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `Error ${resp.status}`);
  return data;
}

// Si ya hay un token guardado, mostrar quién está conectado
if (tokenEnMemoria) {
  fetch('/api/auth/yo', { headers: { Authorization: `Bearer ${tokenEnMemoria}` } })
    .then((r) => (r.ok ? r.json() : null)).then((u) => { if (u) mostrarSesion(u); else { tokenEnMemoria = null; guardarToken(null); } })
    .catch(() => {});
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
    if (tab.dataset.panel === 'p-matriz' && !matrizEstado.cargada) cargarMatriz();
  });
});

// ---------- periodos ----------
async function cargarPeriodos() {
  try {
    const periodos = await api('/periodos');
    for (const p of periodos) {
      const texto = `${mes(p.periodo)} (${num(p.caratulas)} despachos)`;
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

// ---------- despacho ----------
function nroEnCasillas(nro) {
  const partes = [
    [nro.slice(0, 2), 'Año'], [nro.slice(2, 5), 'Aduana'], [nro.slice(5, 9), 'Subrégimen'],
    [nro.slice(9, 15), 'Número'], [nro.slice(15), 'Verificador'],
  ];
  return `<div class="nro" aria-label="Despacho ${nro}">${partes.map(([v, t]) => `<span title="${t}">${esc(v)}</span>`).join('')}</div>`;
}

async function mostrarDespacho(nro) {
  const destino = $('#r-despacho');
  try {
    const d = await api(`/despachos/${encodeURIComponent(nro)}`);
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
      <div class="despacho-barra-superior">
        ${nroEnCasillas(d.nro_despacho)}
        <div class="despacho-acciones">
          <button type="button" id="b-exportar-excel" class="btn-secundario">Exportar (CSV)</button>
          <button type="button" id="b-imprimir" class="btn-secundario">Imprimir</button>
        </div>
      </div>
      <dl class="datos">
        <div><dt>Importador</dt><dd>${esc(d.importador)}</dd></div>
        <div><dt>Periodo</dt><dd>${esc(mes(d.periodo))}</dd></div>
        <div><dt>Destinación</dt><dd>${esc(d.destinacion_desc || d.destinacion)}</dd></div>
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
        // Evento Imprimir
    const btnImp = document.getElementById('b-imprimir');
    if (btnImp) {
      btnImp.onclick = () => window.print();
    }

    // Evento Exportar Excel
    const btnXls = document.getElementById('b-exportar-excel');
    if (btnXls) {
      btnXls.onclick = () => {
        const lineas = [
          ['Despacho', d.nro_despacho],
          ['Importador', d.importador],
          ['Periodo', mes(d.periodo)],
          ['Destinacion', d.destinacion_desc || d.destinacion],
          ['Aduana', d.aduana + ' - ' + (d.aduana_desc || '')],
          ['Procedencia', d.pais_procedencia + ' - ' + (d.pais_procedencia_desc || '')],
          ['Divisa', d.divisa],
          ['FOB Total', d.fob_total_divisa],
          [],
          ['Item', 'NCM', 'Mercaderia', 'Origen', 'Cantidad', 'Unidad', 'Valor Unitario USD', 'FOB USD']
        ];

        (d.items || []).forEach((it) => {
          lineas.push([
            it.item,
            it.ncm,
            String(it.ncm_desc || '').split('"').join('""').split('\n').join(' '),
            it.pais_origen_desc || it.pais_origen,
            importe(it.cantidad),
            it.unidad_desc || it.unidad,
            importe(it.valor_unitario),
            importe(it.fob_usd)
          ]);
        });

        const csv = '\uFEFF' + lineas.map((r) => r.map((c) => '"' + (c ?? '') + '"').join(';')).join('\r\n');
        const enlace = document.createElement('a');
        enlace.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        enlace.download = 'Despacho_' + d.nro_despacho + '.csv';
        document.body.appendChild(enlace);
        enlace.click();
        document.body.removeChild(enlace);
        setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
      };
    }
  } catch (err) {
    mensaje(destino, err.message, true);
  }

}

$('#f-despacho').addEventListener('submit', (e) => {
  e.preventDefault();
  const nro = $('#nro').value.trim().toUpperCase();
  if (!nro) return mensaje($('#r-despacho'), 'Escribí el número de despacho, por ejemplo 26001IC04151676V (la letra final es opcional).', true);
  mostrarDespacho(nro);
});
$('#b-limpiar').addEventListener('click', () => {
  $('#nro').value = '';
  $('#r-despacho').innerHTML = '';
  $('#nro').focus();
});

async function cargarLista() {
  const destino = $('#r-lista');
  destino.innerHTML = '<p class="nota">Cargando despachos recientes…</p>';
  try {
    const r = await api('/despachos', { periodo: periodo(), tamanio: 10 });
    if (r.total === 0) return mensaje(destino, 'No hay despachos en este periodo. Cargá un mes con npm run mes en la carpeta carga.');
    const filas = r.resultados.map((d) => `
      <tr>
        <td><a href="#" class="nro-link codigo" data-nro="${esc(d.nro_despacho)}">${esc(d.nro_despacho)}</a></td>
        <td class="codigo">${esc(d.destinacion)}</td>
        <td>${esc(mes(d.periodo))}</td>
        <td>${esc(d.importador)}</td>
        <td class="n">${d.items}</td>
        <td class="n">${esc(d.divisa === 'DOL' ? 'US$' : (d.divisa_abrev || d.divisa))} ${importe(d.fob_total_divisa)}</td>
      </tr>`);
    destino.innerHTML = tabla([
      { titulo: 'Despacho' }, { titulo: 'Destinación' }, { titulo: 'Periodo' }, { titulo: 'Importador' },
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
  mostrarDespacho(link.dataset.nro);
  $('#r-despacho').scrollIntoView({ behavior: 'smooth' });
});




// ---------- subpartidas ----------
$('#f-subpartidas').addEventListener('submit', async (e) => {
  e.preventDefault();
  const destino = $('#r-subpartidas');
  const desde = $('#desde').value.trim();
  if (!desde) return mensaje(destino, 'Escribí al menos el comienzo del rango, por ejemplo 8471 o 84.', true);
  try {
    const hasta = $('#hasta').value.trim();
    const r = await api('/subpartidas', { desde, hasta, periodo: periodo() });
    if (r.subpartidas.length === 0) return mensaje(destino, 'No hay importaciones en ese rango para el periodo elegido.');

    const filas = r.subpartidas.map((s) => `
      <tr>
        <td><a href="#" class="ncm-link codigo" data-ncm="${esc(s.ncm)}">${esc(s.ncm)}</a></td>
        <td class="desc" title="${esc(s.descripcion)}">${esc(corto(s.descripcion, 80))}</td>
        <td class="n">${num(s.despachos)}</td>
        <td class="n">${num(s.items)}</td>
        <td class="n">${num(s.cantidad)} ${esc(s.unidad_desc || s.unidad)}</td>
        <td class="n">${usd(s.fob_usd)}</td>
        <td class="n">${usd(s.vu_promedio)}</td>
        <td class="n">${num(s.paises_origen)}</td>
      </tr>`);

    filas.push(`<tr class="total"><td colspan="3">Total</td><td class="n">${num(r.totales.items)}</td><td></td>
      <td class="n">${usd(r.totales.fob_usd)}</td><td colspan="2"></td></tr>`);

    // Barra con ambos botones: Excel y PDF/Imprimir
    const barraAcciones = `
      <div class="despacho-acciones" style="margin-bottom: 12px; display: flex; justify-content: flex-end; gap: 0.5rem;">
        <button type="button" id="b-subpartidas-excel" class="btn-secundario">Exportar (CSV)</button>
        <button type="button" id="b-subpartidas-pdf" class="btn-secundario">Imprimir</button>
      </div>`;

    destino.innerHTML = barraAcciones + `
      <div class="reporte-print-header">
        <h2 style="margin: 0 0 0.25rem 0;">Consulta de Subpartidas NCM</h2>
        <p style="margin: 0 0 1rem 0; color: #555; font-size: 0.9rem;">
          <strong>Rango:</strong> ${esc(desde)}${hasta ? ' hasta ' + esc(hasta) : ''} · 
          <strong>Período:</strong> ${periodo() ? mes(periodo()) : 'Todos'}
        </p>
      </div>` + tabla([
      { titulo: 'NCM' }, { titulo: 'Mercadería' }, { titulo: 'Despachos', n: true }, { titulo: 'Ítems', n: true },
      { titulo: 'Cantidad', n: true }, { titulo: 'FOB', n: true }, { titulo: 'Valor unitario', n: true },
      { titulo: 'Orígenes', n: true },
    ], filas) + (r.recortado ? '<p class="mensaje">Se muestran las primeras subpartidas; acotá el rango para ver el resto.</p>' : '');

    
    // Evento Imprimir / PDF
    const btnSubPdf = document.getElementById('b-subpartidas-pdf');
    if (btnSubPdf) {
      btnSubPdf.onclick = () => {
        const titOriginal = document.title;
        document.title = `Subpartidas_${desde}${hasta ? '_' + hasta : ''}`;
        window.print();
        document.title = titOriginal;
      };
    }

    // Evento Exportar a Excel (CSV)
    const btnSubXls = document.getElementById('b-subpartidas-excel');
    if (btnSubXls) {
      btnSubXls.onclick = () => {
        const limpiar = (val) => {
          if (val === null || val === undefined) return '';
          return String(val).split('"').join('""').split('\n').join(' ').split('\r').join('').trim();
        };

        const lineas = [
          ['SISTEMA COMEX - CONSULTA DE SUBPARTIDAS'],
          ['Rango', `${desde}${hasta ? ' a ' + hasta : ''}`],
          ['Periodo', periodo() ? mes(periodo()) : 'Todos'],
          [],
          ['NCM', 'Mercaderia', 'Despachos', 'Items', 'Cantidad', 'Unidad', 'FOB USD', 'Valor Unitario USD', 'Paises Origen']
        ];

        r.subpartidas.forEach((s) => {
          lineas.push([
            s.ncm,
            s.descripcion || '',
            s.despachos,
            s.items,
            importe(s.cantidad),
            s.unidad_desc || s.unidad,
            importe(s.fob_usd),
            importe(s.vu_promedio),
            s.paises_origen
          ]);
        });

        lineas.push([]);
        lineas.push(['TOTAL', '', '', r.totales.items, '', '', importe(r.totales.fob_usd), '', '']);

        const csvContent = '\uFEFF' + lineas
          .map((fila) => fila.map((col) => '"' + limpiar(col) + '"').join(';'))
          .join('\r\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const enlace = document.createElement('a');
        enlace.href = URL.createObjectURL(blob);
        enlace.setAttribute('download', `Subpartidas_${desde}${hasta ? '_' + hasta : ''}.csv`);
        document.body.appendChild(enlace);
        enlace.click();
        document.body.removeChild(enlace);
        setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
      };
    }
  } catch (err) {
    mensaje(destino, err.message, true);
  }
});

$('#b-limpiar-subpartidas').addEventListener('click', () => {
  $('#desde').value = '';
  $('#hasta').value = '';
  $('#r-subpartidas').innerHTML = '';
  $('#desde').focus();
});

// Clic en una subpartida: abre sus precios por origen
$('#r-subpartidas').addEventListener('click', (e) => {
  const link = e.target.closest('[data-ncm]');
  if (!link) return;
  e.preventDefault();
  $('#ncm').value = link.dataset.ncm;
  document.querySelector('[data-panel="p-ncm"]').click();
  $('#f-ncm').requestSubmit();
});



// ---------- precios por NCM ----------
$('#f-ncm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const destino = $('#r-ncm');
  const ncm = $('#ncm').value.trim();
  if (!ncm) return mensaje(destino, 'Escribí la posición NCM, por ejemplo 8471.30.12 (con o sin puntos).', true);
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
        <td class="codigo">${esc(b.nro_despacho)}</td>
        <td>${esc(b.importador)}</td>
        <td class="codigo">${esc(b.pais_origen)}</td>
        <td class="n">${num(b.cantidad)}</td>
        <td class="n">${usd(b.valor_unitario)}</td>
        <td class="n">${usd(b.vu_promedio)}</td>
        <td class="n proporcion">${num(b.proporcion * 100)} %</td>
      </tr>`);

    const barraAcciones = `
      <div class="despacho-acciones" style="margin-bottom: 12px; display: flex; justify-content: flex-end; gap: 0.5rem;">
        <button type="button" id="b-ncm-excel" class="btn-secundario">Exportar Excel (CSV)</button>
        <button type="button" id="b-ncm-pdf" class="btn-secundario">Imprimir / PDF</button>
      </div>`;

    destino.innerHTML = barraAcciones + `
      <h2>${esc(precios.ncm)}</h2>
      <p class="nota">${esc(corto(precios.descripcion, 300) || 'Sin descripción en el KIT.')}</p>
      ${tabla([
        { titulo: 'Origen' }, { titulo: 'Unidad' }, { titulo: 'Ítems', n: true }, { titulo: 'Cantidad', n: true },
        { titulo: 'Mínimo', n: true }, { titulo: 'Promedio', n: true }, { titulo: 'Máximo', n: true },
        { titulo: 'FOB', n: true },
      ], filasOrigen)}
      <h2>Valores unitarios por debajo del ${num(bajos.umbral * 100)} % del promedio</h2>
      ${filasBajos.length ? tabla([
        { titulo: 'Despacho' }, { titulo: 'Importador' }, { titulo: 'Origen' }, { titulo: 'Cantidad', n: true },
        { titulo: 'Declarado', n: true }, { titulo: 'Promedio NCM', n: true }, { titulo: 'Proporción', n: true },
      ], filasBajos) : '<p class="mensaje">Ningún ítem queda por debajo de ese umbral.</p>'}`;

    // Evento Imprimir / PDF
    const btnNcmPdf = document.getElementById('b-ncm-pdf');
    if (btnNcmPdf) {
      btnNcmPdf.onclick = () => {
        const titOriginal = document.title;
        document.title = `Precios_NCM_${ncm}`;
        window.print();
        document.title = titOriginal;
      };
    }

    // Evento Exportar Excel (CSV)
    const btnNcmXls = document.getElementById('b-ncm-excel');
    if (btnNcmXls) {
      btnNcmXls.onclick = () => {
        const limpiar = (val) => {
          if (val === null || val === undefined) return '';
          return String(val).split('"').join('""').split('\n').join(' ').split('\r').join('').trim();
        };

        const lineas = [
          ['SISTEMA COMEX - PRECIOS POR POSICION NCM'],
          ['Posicion NCM', precios.ncm],
          ['Descripcion', precios.descripcion || ''],
          ['Periodo', periodo() ? mes(periodo()) : 'Todos'],
          [],
          ['RESUMEN POR ORIGEN'],
          ['Origen', 'Codigo Pais', 'Unidad', 'Items', 'Cantidad', 'VU Minimo USD', 'VU Promedio USD', 'VU Maximo USD', 'FOB USD']
        ];

        precios.origenes.forEach((o) => {
          lineas.push([
            o.pais_origen_desc || o.pais_origen,
            o.pais_origen,
            o.unidad,
            o.items,
            importe(o.cantidad),
            importe(o.vu_min),
            importe(o.vu_promedio),
            importe(o.vu_max),
            importe(o.fob_usd)
          ]);
        });

        if (bajos.items && bajos.items.length) {
          lineas.push([]);
          lineas.push([`VALORES POR DEBAJO DEL ${num(bajos.umbral * 100)}% DEL PROMEDIO`]);
          lineas.push(['Despacho', 'Importador', 'Origen', 'Cantidad', 'Declarado USD', 'Promedio NCM USD', 'Proporcion']);
          bajos.items.forEach((b) => {
            lineas.push([
              b.nro_despacho,
              b.importador,
              b.pais_origen,
              importe(b.cantidad),
              importe(b.valor_unitario),
              importe(b.vu_promedio),
              `${num(b.proporcion * 100)} %`
            ]);
          });
        }

        const csvContent = '\uFEFF' + lineas
          .map((fila) => fila.map((col) => '"' + limpiar(col) + '"').join(';'))
          .join('\r\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const enlace = document.createElement('a');
        enlace.href = URL.createObjectURL(blob);
        enlace.setAttribute('download', `Precios_NCM_${ncm}.csv`);
        document.body.appendChild(enlace);
        enlace.click();
        document.body.removeChild(enlace);
        setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
      };
    }
  } catch (err) {
    mensaje(destino, err.message, true);
  }
});

$('#b-limpiar-ncm').addEventListener('click', () => {
  $('#ncm').value = '';
  $('#r-ncm').innerHTML = '';
  $('#ncm').focus();
});



// ---------- importadores ----------
$('#f-importadores').addEventListener('submit', async (e) => {
  e.preventDefault();
  const destino = $('#r-importadores');
  const busqueda = $('#q').value.trim();
  if (busqueda.length < 3) return mensaje(destino, 'Escribí al menos 3 letras del nombre del importador.', true);

  try {
    const rows = await api('/importadores', { q: busqueda, periodo: periodo() });
    if (rows.length === 0) return mensaje(destino, 'Ningún importador coincide con ese nombre en el periodo elegido.');

    const totalDespachos = rows.reduce((s, r) => s + (r.despachos || 0), 0);
    const totalItems = rows.reduce((s, r) => s + (r.items || 0), 0);
    const totalFob = rows.reduce((s, r) => s + (r.fob_usd || 0), 0);

    const filas = rows.map((r) => `
      <tr>
        <td>${esc(r.nombre)}</td>
        <td class="n">${num(r.despachos)}</td>
        <td class="n">${num(r.items)}</td>
        <td class="n">${usd(r.fob_usd)}</td>
      </tr>`);

    filas.push(`
      <tr class="total">
        <td>Total (${rows.length} empresas)</td>
        <td class="n">${num(totalDespachos)}</td>
        <td class="n">${num(totalItems)}</td>
        <td class="n">${usd(totalFob)}</td>
      </tr>`);

    const barraAcciones = `
      <div class="despacho-acciones" style="margin: 1.25rem 0 0.75rem 0; display: flex; justify-content: flex-end; gap: 0.5rem;">
        <button type="button" id="b-importadores-excel" class="btn-secundario">Exportar (CSV)</button>
        <button type="button" id="b-importadores-pdf" class="btn-secundario">Imprimir</button>
      </div>`;

    const encabezadoReporte = `
      <div class="reporte-print-header" style="margin-bottom: 0.75rem;">
        <h2 style="margin: 0 0 0.25rem 0;">Consulta de Importadores</h2>
        <p style="margin: 0; color: #555; font-size: 0.9rem;">
          <strong>Búsqueda:</strong> "${esc(busqueda)}" · <strong>Período:</strong> ${periodo() ? mes(periodo()) : 'Todos'}
        </p>
      </div>`;

    destino.innerHTML = barraAcciones + encabezadoReporte + tabla([
      { titulo: 'Importador' }, { titulo: 'Despachos', n: true }, { titulo: 'Ítems', n: true },
      { titulo: 'FOB', n: true },
    ], filas);

    // Evento Imprimir / PDF
    const btnImpPdf = document.getElementById('b-importadores-pdf');
    if (btnImpPdf) {
      btnImpPdf.onclick = () => {
        const titOriginal = document.title;
        document.title = `Importadores_${busqueda}`;
        window.print();
        document.title = titOriginal;
      };
    }

    // Evento Exportar Excel (CSV)
    const btnImpXls = document.getElementById('b-importadores-excel');
    if (btnImpXls) {
      btnImpXls.onclick = () => {
        const limpiar = (val) => {
          if (val === null || val === undefined) return '';
          return String(val).split('"').join('""').split('\n').join(' ').split('\r').join('').trim();
        };

        const lineas = [
          ['SISTEMA COMEX - LISTADO DE IMPORTADORES'],
          ['Criterio de busqueda', busqueda],
          ['Periodo', periodo() ? mes(periodo()) : 'Todos'],
          [],
          ['Importador', 'Despachos', 'Items', 'FOB USD']
        ];

        rows.forEach((r) => {
          lineas.push([
            r.nombre,
            r.despachos,
            r.items,
            importe(r.fob_usd)
          ]);
        });

        lineas.push([]);
        lineas.push(['TOTAL', totalDespachos, totalItems, importe(totalFob)]);

        const csvContent = '\uFEFF' + lineas
          .map((fila) => fila.map((col) => '"' + limpiar(col) + '"').join(';'))
          .join('\r\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const enlace = document.createElement('a');
        enlace.href = URL.createObjectURL(blob);
        enlace.setAttribute('download', `Importadores_${busqueda}.csv`);
        document.body.appendChild(enlace);
        enlace.click();
        document.body.removeChild(enlace);
        setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
      };
    }
  } catch (err) {
    mensaje(destino, err.message, true);
  }
});

$('#b-limpiar-importadores').addEventListener('click', () => {
  $('#q').value = '';
  $('#r-importadores').innerHTML = '';
  $('#q').focus();
});

// ---------- triangulaciones ----------
async function cargarTriangulaciones() {
  const destino = $('#r-triangulaciones');
  mensaje(destino, 'Cargando triangulaciones...', false);

  try {
    const rows = await api('/triangulaciones', { periodo: periodo() });
    if (!rows || rows.length === 0) {
      return mensaje(destino, 'No hay triangulaciones en el periodo elegido.');
    }

    const totalItems = rows.reduce((s, r) => s + (Number(r.items) || 0), 0);
    const totalFob = rows.reduce((s, r) => s + (Number(r.fob_usd) || 0), 0);

    const filas = rows.map((r) => `
      <tr>
        <td><a href="#" class="ncm-link codigo" data-ncm="${esc(r.ncm)}">${esc(r.ncm)}</a></td>
        <td>${codigo(r.pais_origen, r.pais_origen_desc)}</td>
        <td>${codigo(r.pais_procedencia, r.pais_procedencia_desc)}</td>
        <td class="n">${num(r.items)}</td>
        <td class="n">${usd(r.fob_usd)}</td>
      </tr>`);

    filas.push(`
      <tr class="total">
        <td colspan="3">Total (${rows.length} operaciones)</td>
        <td class="n">${num(totalItems)}</td>
        <td class="n">${usd(totalFob)}</td>
      </tr>`);

    const barraAcciones = `
      <div class="despacho-acciones" style="margin-bottom: 12px; display: flex; justify-content: flex-end; gap: 0.5rem;">
        <button type="button" id="b-triangulaciones-excel" class="btn-secundario">Exportar (CSV)</button>
        <button type="button" id="b-triangulaciones-pdf" class="btn-secundario">Imprimir</button>
      </div>`;

    const encabezadoReporte = `
      <div class="reporte-print-header" style="margin-bottom: 0.75rem;">
        <h2 style="margin: 0 0 0.25rem 0;">Consulta de Triangulaciones</h2>
        <p style="margin: 0; color: #555; font-size: 0.9rem;">
          <strong>Criterio:</strong> Origen distinto a procedencia · 
          <strong>Período:</strong> ${periodo() ? mes(periodo()) : 'Todos'}
        </p>
      </div>`;

    destino.innerHTML = barraAcciones + encabezadoReporte + tabla([
      { titulo: 'NCM' }, { titulo: 'Origen' }, { titulo: 'Procedencia' },
      { titulo: 'Ítems', n: true }, { titulo: 'FOB', n: true },
    ], filas);

    // Evento Imprimir / PDF
    const btnTriPdf = document.getElementById('b-triangulaciones-pdf');
    if (btnTriPdf) {
      btnTriPdf.onclick = () => {
        const titOriginal = document.title;
        document.title = `Triangulaciones_${periodo() || 'Todos'}`;
        window.print();
        document.title = titOriginal;
      };
    }

    // Evento Exportar Excel (CSV)
    const btnTriXls = document.getElementById('b-triangulaciones-excel');
    if (btnTriXls) {
      btnTriXls.onclick = () => {
        const limpiar = (val) => {
          if (val === null || val === undefined) return '';
          return String(val).split('"').join('""').split('\n').join(' ').split('\r').join('').trim();
        };

        const lineas = [
          ['SISTEMA COMEX - CONSULTA DE TRIANGULACIONES'],
          ['Periodo', periodo() ? mes(periodo()) : 'Todos'],
          ['Criterio', 'Origen distinto de procedencia'],
          [],
          ['NCM', 'Pais Origen', 'Codigo Origen', 'Pais Procedencia', 'Codigo Procedencia', 'Items', 'FOB USD']
        ];

        rows.forEach((r) => {
          lineas.push([
            r.ncm,
            r.pais_origen_desc || r.pais_origen,
            r.pais_origen,
            r.pais_procedencia_desc || r.pais_procedencia,
            r.pais_procedencia,
            r.items,
            importe(r.fob_usd)
          ]);
        });

        lineas.push([]);
        lineas.push(['TOTAL', '', '', '', '', totalItems, importe(totalFob)]);

        const csvContent = '\uFEFF' + lineas
          .map((fila) => fila.map((col) => '"' + limpiar(col) + '"').join(';'))
          .join('\r\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const enlace = document.createElement('a');
        enlace.href = URL.createObjectURL(blob);
        enlace.setAttribute('download', `Triangulaciones_${periodo() || 'Todos'}.csv`);
        document.body.appendChild(enlace);
        enlace.click();
        document.body.removeChild(enlace);
        setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
      };
    }
  } catch (err) {
    mensaje(destino, err.message, true);
  }
}

// Clic en NCM dentro de triangulaciones para ir a Precios por NCM
$('#r-triangulaciones').addEventListener('click', (e) => {
  const link = e.target.closest('[data-ncm]');
  if (!link) return;
  e.preventDefault();
  $('#ncm').value = link.dataset.ncm;
  document.querySelector('[data-panel="p-ncm"]').click();
  $('#f-ncm').requestSubmit();
});

// ---------- matriz ----------
// Paleta categórica validada (orden fijo) + gris para "Resto". El color sigue a
// la categoría, no a su ranking: se asigna por orden de total y se mantiene al
// cambiar de vista US$/%.
const COLORES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
const GRIS_RESTO = '#a3a29b';
const millones = (v) => `US$ ${fmtNum.format(Math.round(v / 1e5) / 10)} M`;
const pct = (v) => `${fmtNum.format(Math.round(v * 10) / 10)} %`;

const matrizEstado = { cargada: false, nivel: 'seccion', seccion: null, vista: 'usd', grupos: null, datos: null, grafico: null, colores: {} };

async function cargarMatriz() {
  const destino = $('#r-matriz');
  const params = { nivel: matrizEstado.nivel, seccion: matrizEstado.seccion };
  if (matrizEstado.grupos) params.grupos = matrizEstado.grupos.join(',');
  mensaje(destino, 'Calculando…');
  try {
    matrizEstado.datos = await api('/matriz', params);
    matrizEstado.cargada = true;
    if (!matrizEstado.grupos) matrizEstado.grupos = matrizEstado.datos.grupos.filter((g) => g.incluido).map((g) => g.codigo);
    dibujarMatriz();
  } catch (err) {
    mensaje(destino, err.message, true);
  }
}

function dibujarMatriz() {
  const d = matrizEstado.datos;
  const vista = matrizEstado.vista;

  // Miga de pan
  $('#m-miga').innerHTML = d.nivel === 'capitulo'
    ? `<a href="#" data-volver>Secciones</a><span class="sep">›</span>${esc(d.seccion.codigo)} · ${esc(d.seccion.descrip)}`
    : 'Secciones de la NCM';

  // Grupos de operaciones (casillas)
  $('#m-grupos').innerHTML = '<legend>Operaciones incluidas</legend>' + d.grupos.map((g) => `
    <label><input type="checkbox" value="${esc(g.codigo)}" ${g.incluido ? 'checked' : ''}> ${esc(g.descrip)}</label>`).join('');

  const valor = (cat, p) => (vista === 'pct'
    ? (d.totales[p] ? (cat.por_periodo[p] * 100) / d.totales[p] : 0)
    : cat.por_periodo[p]);

  // Gráfico: las 7 categorías más grandes con color propio, el resto junto en gris
  // Las categorías con color se eligen la primera vez que se ve cada nivel y se
  // conservan: al tildar o destildar operaciones no cambian los colores.
  const orden = [...d.categorias].filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  const clave = `${d.nivel}|${matrizEstado.seccion || ''}`;
  if (!matrizEstado.colores[clave]) matrizEstado.colores[clave] = orden.slice(0, COLORES.length).map((c) => c.codigo);
  const elegidas = matrizEstado.colores[clave];
  const principales = elegidas.map((cod) => orden.find((c) => c.codigo === cod)).filter(Boolean);
  const resto = orden.filter((c) => !elegidas.includes(c.codigo));
  const datasets = principales.map((c, i) => ({
    label: `${c.codigo} ${c.descrip}`,
    codigo: c.codigo,
    data: d.periodos.map((p) => valor(c, p)),
    backgroundColor: COLORES[elegidas.indexOf(c.codigo)],
  }));
  if (resto.length) {
    datasets.push({
      label: `Resto (${resto.length})`,
      codigo: null,
      data: d.periodos.map((p) => resto.reduce((a, c) => a + valor(c, p), 0)),
      backgroundColor: GRIS_RESTO,
    });
  }
  datasets.forEach((ds) => Object.assign(ds, { borderColor: '#ffffff', borderWidth: { top: 2 }, borderSkipped: false, maxBarThickness: 120 }));

  if (matrizEstado.grafico) matrizEstado.grafico.destroy();
  matrizEstado.grafico = new Chart($('#m-grafico'), {
    type: 'bar',
    data: { labels: d.periodos.map(mes), datasets },
    options: {
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: true },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: '#5b6b74' } },
        y: {
          stacked: true,
          max: vista === 'pct' ? 100 : undefined,
          grid: { color: '#e3e8e6' },
          border: { display: false },
          ticks: { color: '#5b6b74', callback: (v) => (vista === 'pct' ? `${v} %` : `${fmtNum.format(v / 1e6)} M`) },
        },
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12, color: '#1d2b36', padding: 14 } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const p = d.periodos[ctx.dataIndex];
              const usdVal = vista === 'pct' ? (ctx.raw * d.totales[p]) / 100 : ctx.raw;
              const parte = d.totales[p] ? (usdVal * 100) / d.totales[p] : 0;
              return ` ${ctx.dataset.label}: ${millones(usdVal)} (${pct(parte)})`;
            },
          },
        },
      },
      onClick: (evt, elementos) => {
        if (d.nivel !== 'seccion' || !elementos.length) return;
        const codigo = datasets[elementos[0].datasetIndex].codigo;
        if (codigo && codigo !== 'S/S') abrirSeccion(codigo);
      },
      onHover: (evt, elementos) => {
        evt.native.target.style.cursor = d.nivel === 'seccion' && elementos.length ? 'pointer' : 'default';
      },
    },
  });

  // Nota: qué queda afuera
  const excluidos = d.grupos.filter((g) => !g.incluido)
    .map((g) => `${g.descrip}: ${millones(Object.values(g.por_periodo).reduce((a, v) => a + v, 0))}`);
  $('#m-nota').textContent = 'FOB en dólares por mes de registro. Sólo importación a consumo: no incluye importación temporaria ni courier, que INDEC sí suma.'
    + (excluidos.length ? ` Fuera del gráfico en el período: ${excluidos.join('; ')}.` : '')
    + (d.nivel === 'seccion' ? ' Clic en una sección para ver sus capítulos.' : '');

  // Tabla con todas las categorías (vista accesible y exacta)
  const colorDe = new Map(principales.map((c) => [c.codigo, COLORES[elegidas.indexOf(c.codigo)]]));
  const filas = d.categorias.filter((c) => c.total > 0).sort((a, b) => b.total - a.total).map((c) => `
    <tr${d.nivel === 'seccion' && c.codigo !== 'S/S' ? ` class="clic" data-seccion="${esc(c.codigo)}"` : ''}>
      <td><span class="muestra" style="background:${colorDe.get(c.codigo) || GRIS_RESTO}"></span><span class="codigo">${esc(c.codigo)}</span></td>
      <td class="desc">${esc(c.descrip)}</td>
      ${d.periodos.map((p) => `<td class="n">${vista === 'pct' ? pct(valor(c, p)) : millones(c.por_periodo[p])}</td>`).join('')}
      <td class="n">${millones(c.total)}</td>
    </tr>`);
  const totalGeneral = Object.values(d.totales).reduce((a, v) => a + v, 0);
  filas.push(`<tr class="total"><td colspan="2">Total</td>
    ${d.periodos.map((p) => `<td class="n">${vista === 'pct' ? '100 %' : millones(d.totales[p])}</td>`).join('')}
    <td class="n">${millones(totalGeneral)}</td></tr>`);

  // 1. Barra de botones 
  const barraAcciones = `
    <div class="despacho-acciones" style="margin: 1.25rem 0 0.75rem 0; display: flex; justify-content: flex-end; gap: 0.5rem;">
      <button type="button" id="b-matriz-excel" class="btn-secundario">Exportar (CSV)</button>
      <button type="button" id="b-matriz-pdf" class="btn-secundario">Imprimir</button>
    </div>`;

  // 2. Encabezado visible al imprimir / PDF
  const encabezadoReporte = `
    <div class="reporte-print-header" style="margin-bottom: 0.75rem;">
      <h2 style="margin: 0 0 0.25rem 0;">Matriz COMEX - ${d.nivel === 'capitulo' ? `Capítulos de ${esc(d.seccion.codigo)}` : 'Secciones NCM'}</h2>
      <p style="margin: 0; color: #555; font-size: 0.9rem;">
        <strong>Nivel:</strong> ${d.nivel === 'capitulo' ? esc(d.seccion.descrip) : 'General por Secciones'} · 
        <strong>Vista:</strong> ${vista === 'pct' ? 'Porcentaje (%)' : 'Valores FOB (USD)'}
      </p>
    </div>`;

  // 3. Renderizar barra + encabezado + tabla
  $('#r-matriz').innerHTML = barraAcciones + encabezadoReporte + tabla([
    { titulo: d.nivel === 'capitulo' ? 'Cap.' : 'Sección' }, { titulo: 'Descripción' },
    ...d.periodos.map((p) => ({ titulo: mes(p), n: true })), { titulo: 'Total', n: true },
  ], filas);

  // 4. Funcionalidad de Imprimir / PDF
  const btnMatrizPdf = document.getElementById('b-matriz-pdf');
  if (btnMatrizPdf) {
    btnMatrizPdf.onclick = () => {
      const titOriginal = document.title;
      document.title = `Matriz_${d.nivel}_${matrizEstado.seccion || 'General'}`;
      window.print();
      document.title = titOriginal;
    };
  }

  // 5. Funcionalidad de Exportar Excel (CSV)
  const btnMatrizXls = document.getElementById('b-matriz-excel');
  if (btnMatrizXls) {
    btnMatrizXls.onclick = () => {
      const limpiar = (val) => {
        if (val === null || val === undefined) return '';
        return String(val).split('"').join('""').split('\n').join(' ').split('\r').join('').trim();
      };

      const lineas = [
        ['SISTEMA COMEX - MATRIZ'],
        ['Nivel', d.nivel === 'capitulo' ? `Capitulos de ${d.seccion.codigo} - ${d.seccion.descrip}` : 'Secciones NCM'],
        ['Vista', vista === 'pct' ? 'Porcentaje' : 'Valores FOB USD'],
        [],
        [
          d.nivel === 'capitulo' ? 'Capitulo' : 'Seccion',
          'Descripcion',
          ...d.periodos.map(p => mes(p)),
          'Total'
        ]
      ];

      // Filas de datos
      d.categorias.filter((c) => c.total > 0).sort((a, b) => b.total - a.total).forEach((c) => {
        lineas.push([
          c.codigo,
          c.descrip,
          ...d.periodos.map((p) => {
            const v = valor(c, p);
            return vista === 'pct' ? `${(Math.round(v * 10) / 10).toString().replace('.', ',')} %` : (Math.round(v * 100) / 100).toString().replace('.', ',');
          }),
          vista === 'pct' ? '' : (Math.round(c.total * 100) / 100).toString().replace('.', ',')
        ]);
      });

      // Fila de totales
      lineas.push([]);
      lineas.push([
        'TOTAL',
        '',
        ...d.periodos.map((p) => vista === 'pct' ? '100 %' : (Math.round(d.totales[p] * 100) / 100).toString().replace('.', ',')),
        vista === 'pct' ? '100 %' : (Math.round(totalGeneral * 100) / 100).toString().replace('.', ',')
      ]);

      const csvContent = '\uFEFF' + lineas
        .map((fila) => fila.map((col) => '"' + limpiar(col) + '"').join(';'))
        .join('\r\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const enlace = document.createElement('a');
      enlace.href = URL.createObjectURL(blob);
      enlace.setAttribute('download', `Matriz_${d.nivel}_${matrizEstado.seccion || 'General'}.csv`);
      document.body.appendChild(enlace);
      enlace.click();
      document.body.removeChild(enlace);
      setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
    };
  }
}