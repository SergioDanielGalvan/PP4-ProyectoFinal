const pool = require('../config/db');

// Las columnas usan los nombres del modelo Access (Caratula, Item, Liq);
// el JSON de la API mantiene sus propios nombres con alias, para que el
// front no dependa de cómo se llamen las columnas.

// Arma "AND x.Periodo = ?" sólo si viene el periodo
function filtroPeriodo(alias, periodo, params) {
  if (periodo === null) return '';
  params.push(periodo);
  return ` AND ${alias}.Periodo = ?`;
}

// Los periodos cambian sólo cuando se carga o copia un mes: se guardan en
// memoria unos minutos para no contar 1,6 M de ítems en cada visita.
const CACHE_PERIODOS_MS = 10 * 60 * 1000;
let cachePeriodos = null;

async function listarPeriodos() {
  if (cachePeriodos && Date.now() - cachePeriodos.hora < CACHE_PERIODOS_MS) return cachePeriodos.filas;
  const [rows] = await pool.query(`
    SELECT c.periodo, c.caratulas, i.items
    FROM (SELECT Periodo AS periodo, COUNT(*) AS caratulas FROM caratula GROUP BY Periodo) c
    LEFT JOIN (SELECT Periodo AS periodo, COUNT(*) AS items FROM item GROUP BY Periodo) i
           USING (periodo)
    ORDER BY c.periodo DESC`);
  cachePeriodos = { hora: Date.now(), filas: rows };
  return rows;
}

async function obtenerDespacho(nro) {
  const [caratulas] = await pool.query(`
    SELECT c.IdOperacion AS id, c.Periodo AS periodo, c.NroAduana AS nro_despacho,
           c.Destinacion          AS destinacion, d.Descrip  AS destinacion_desc,
           c.AduanaOficializacion AS aduana,           a.Descrip  AS aduana_desc,
           imp.Nombre             AS importador,
           c.PaisProcedencia      AS pais_procedencia, pp.Descrip AS pais_procedencia_desc,
           c.Via                  AS medio_transporte, v.Descrip  AS medio_transporte_desc,
           c.DivisaFOB               AS divisa,           dv.Descrip AS divisa_desc,
           dv.Abreviatura         AS divisa_abrev,     c.FobTotalDivisas AS fob_total_divisa
    FROM caratula c
    JOIN      importadores  imp ON imp.IdImportador = c.IdImportador
    LEFT JOIN aduanas       a   ON a.Codigo  = c.AduanaOficializacion
    LEFT JOIN paises        pp  ON pp.Codigo = c.PaisProcedencia
    LEFT JOIN via           v   ON v.Codigo  = c.Via
    LEFT JOIN divisas       dv  ON dv.Codigo = c.DivisaFOB
    LEFT JOIN destinaciones d   ON d.Codigo  = c.Destinacion
    WHERE c.NroAduana = ?
    LIMIT 1`, [nro]);
  if (caratulas.length === 0) return null;

  const { id, periodo, ...caratula } = caratulas[0];

  const [items] = await pool.query(`
    SELECT i.Item AS item, n.PosicionSIM AS ncm, n.DescripcionNCM AS ncm_desc,
           i.PaisOrigen AS pais_origen, po.Descrip AS pais_origen_desc,
           i.UnidadMedida AS unidad, u.Descrip AS unidad_desc,
           i.CantidadUnidades AS cantidad, i.FobTotalDolares AS fob_usd, i.ValorUnitario AS valor_unitario
    FROM item i
    JOIN      posicion       n  ON n.IdPosicion = i.IdPosicion
    LEFT JOIN paises         po ON po.Codigo = i.PaisOrigen
    LEFT JOIN unidadesmedida u  ON u.Codigo  = i.UnidadMedida
    WHERE i.IdOperacion = ? AND i.Periodo = ?
    ORDER BY i.Item`, [id, periodo]);

  const [liquidacion] = await pool.query(`
    SELECT l.Item AS item, l.Codigo AS concepto, t.Descrip AS concepto_desc, l.Monto AS monto
    FROM liq l
    LEFT JOIN tasas t ON t.Codigo = l.Codigo
    WHERE l.IdOperacion = ? AND l.Periodo = ?
    ORDER BY l.Item, l.Codigo`, [id, periodo]);

  // Anida la liquidación dentro de su ítem
  const porItem = new Map(items.map((it) => [it.item, { ...it, aranceles: [] }]));
  for (const { item, ...linea } of liquidacion) {
    if (porItem.has(item)) porItem.get(item).aranceles.push(linea);
  }

  return { periodo, ...caratula, items: [...porItem.values()] };
}

async function listarDespachos({ periodo, importador, destinacion, pagina, tamanio }) {
  const params = [];
  let where = 'WHERE 1 = 1';
  where += filtroPeriodo('c', periodo, params);
  if (importador) {
    where += ' AND imp.Nombre LIKE ?';
    params.push(`%${importador}%`);
  }
  // destinación = código del KIT (IC04, IC06...), sale de NroAduana
  if (destinacion) {
    where += ' AND c.Destinacion = ?';
    params.push(destinacion);
  }

  // El JOIN con importadores sólo hace falta para filtrar por nombre
  const [[{ total }]] = await pool.query(`
    SELECT COUNT(*) AS total
    FROM caratula c
    ${importador ? 'JOIN importadores imp ON imp.IdImportador = c.IdImportador' : ''}
    ${where}`, params);

  const [rows] = await pool.query(`
    SELECT c.NroAduana AS nro_despacho, c.Periodo AS periodo,
           c.Destinacion AS destinacion, c.AduanaOficializacion AS aduana, imp.Nombre AS importador,
           c.PaisProcedencia AS pais_procedencia, c.DivisaFOB AS divisa,
           dv.Abreviatura AS divisa_abrev, c.FobTotalDivisas AS fob_total_divisa,
           (SELECT COUNT(*) FROM item i
             WHERE i.IdOperacion = c.IdOperacion AND i.Periodo = c.Periodo) AS items
    FROM caratula c
    JOIN      importadores imp ON imp.IdImportador = c.IdImportador
    LEFT JOIN divisas      dv  ON dv.Codigo = c.DivisaFOB
    ${where}
    ORDER BY c.Periodo DESC, c.IdOperacion DESC   -- últimos cargados; sigue la clave, sin ordenar todo
    LIMIT ? OFFSET ?`, [...params, tamanio, (pagina - 1) * tamanio]);

  return { total, pagina, tamanio, resultados: rows };
}

// Resumen por subpartida NCM dentro de un rango (capítulo, partida o subpartida).
// desde/hasta llegan como dígitos ya completados a 8 (00000000-99999999).
// Se agrupa también por unidad: no se suman kilos con unidades.
async function resumenSubpartidas({ desde, hasta, periodo, limite }) {
  const params = [desde.slice(0, 4), hasta.slice(0, 4), desde, hasta];
  const filtro = filtroPeriodo('i', periodo, params);
  const [rows] = await pool.query(`
    SELECT p.PosicionSIM AS ncm, p.Partida AS partida, p.DescripcionNCM AS descripcion,
           i.UnidadMedida AS unidad, u.Descrip AS unidad_desc,
           COUNT(DISTINCT i.IdOperacion, i.Periodo) AS despachos,
           COUNT(*)                                 AS items,
           SUM(i.CantidadUnidades)                  AS cantidad,
           SUM(i.FobTotalDolares)                   AS fob_usd,
           ROUND(SUM(i.FobTotalDolares) / NULLIF(SUM(i.CantidadUnidades), 0), 6) AS vu_promedio,
           COUNT(DISTINCT i.PaisOrigen)             AS paises_origen
    FROM posicion p
    JOIN item i ON i.IdPosicion = p.IdPosicion
    LEFT JOIN unidadesmedida u ON u.Codigo = i.UnidadMedida
    WHERE p.Partida BETWEEN ? AND ?
      AND REPLACE(p.PosicionSIM, '.', '') BETWEEN ? AND ?${filtro}
    GROUP BY p.IdPosicion, p.PosicionSIM, p.Partida, p.DescripcionNCM, i.UnidadMedida, u.Descrip
    ORDER BY p.PosicionSIM, fob_usd DESC
    LIMIT ?`, [...params, limite + 1]);

  const recortado = rows.length > limite;
  const subpartidas = recortado ? rows.slice(0, limite) : rows;
  const totales = subpartidas.reduce((t, r) => ({
    items: t.items + Number(r.items), fob_usd: t.fob_usd + Number(r.fob_usd || 0),
  }), { items: 0, fob_usd: 0 });
  return { desde, hasta, periodo, recortado, totales, subpartidas };
}

// Posiciones del KIT que abarca un código completo de partida (4 dígitos),
// subpartida (6) o NCM (8). PosicionSIM lleva puntos (8471.30.12): el prefijo
// se arma igual para usar su índice único.
const NIVELES = { 4: 'partida', 6: 'subpartida', 8: 'ncm' };

async function posicionesDe(digitos) {
  const prefijo = [digitos.slice(0, 4), digitos.slice(4, 6), digitos.slice(6, 8)].filter(Boolean).join('.');
  const [rows] = await pool.query(`
    SELECT IdPosicion AS id, PosicionSIM AS ncm, DescripcionNCM AS descripcion
    FROM posicion
    WHERE PosicionSIM LIKE ?
    ORDER BY PosicionSIM`, [digitos.length === 8 ? prefijo : `${prefijo}%`]);
  if (rows.length === 0) return null;

  // En una NCM la descripción es la del KIT; en partida y subpartida, la del
  // capítulo más la cantidad de posiciones que abarca (el KIT no describe la partida)
  let descripcion = rows[0].descripcion;
  if (digitos.length < 8) {
    const [[cap]] = await pool.query('SELECT Descrip AS descrip FROM capitulo WHERE Codigo = ?', [digitos.slice(0, 2)]);
    descripcion = `${cap ? `Capítulo ${digitos.slice(0, 2)}: ${cap.descrip}. ` : ''}Abarca ${rows.length} posiciones NCM.`;
  }
  return { codigo: prefijo, nivel: NIVELES[digitos.length], descripcion, ids: rows.map((r) => r.id) };
}

// ---------- filtros de Precios ----------
// Regiones = primer dígito del código de país del KIT de ARCA.
const REGIONES = [
  { codigo: '1', nombre: 'África' }, { codigo: '2', nombre: 'América' }, { codigo: '3', nombre: 'Asia' },
  { codigo: '4', nombre: 'Europa' }, { codigo: '5', nombre: 'Oceanía' }, { codigo: '7', nombre: 'Varios países' },
  { codigo: '9', nombre: 'Indeterminado' },
];

// Período: un mes (periodo) o un rango (desde/hasta, AAAAMM). El rango manda.
function filtroPeriodos(alias, f, params) {
  if (f.desde || f.hasta) {
    params.push(f.desde || 0, f.hasta || 999999);
    return ` AND ${alias}.Periodo BETWEEN ? AND ?`;
  }
  return filtroPeriodo(alias, f.periodo ?? null, params);
}

// Región y países de procedencia (del ítem) y aduanas de oficialización (de la carátula)
function filtroProcedenciaAduana(aliasItem, aliasCaratula, f, params) {
  let sql = '';
  if (f.region) { sql += ` AND ${aliasItem}.PaisProcedencia LIKE ?`; params.push(`${f.region}%`); }
  if (f.paises?.length) { sql += ` AND ${aliasItem}.PaisProcedencia IN (?)`; params.push(f.paises); }
  if (f.aduanas?.length) { sql += ` AND ${aliasCaratula}.AduanaOficializacion IN (?)`; params.push(f.aduanas); }
  return sql;
}

// Listas para los selectores del front; cambian sólo con el KIT
let cacheCatalogos = null;
async function catalogos() {
  if (cacheCatalogos && Date.now() - cacheCatalogos.hora < 60 * 60 * 1000) return cacheCatalogos.datos;
  const [paises] = await pool.query(
    "SELECT Codigo AS codigo, Descrip AS descrip FROM paises WHERE Codigo REGEXP '^[1-9][0-9]{2}$' ORDER BY Descrip");
  const [aduanas] = await pool.query('SELECT Codigo AS codigo, Descrip AS descrip FROM aduanas ORDER BY Descrip');
  const datos = { regiones: REGIONES, paises, aduanas };
  cacheCatalogos = { hora: Date.now(), datos };
  return datos;
}

// Precios por país de origen y unidad: base para comparar valores declarados.
// En partida o subpartida se suman varias NCM: "posiciones" dice cuántas
// distintas entran en cada fila (el promedio mezcla mercaderías distintas).
async function preciosPorNcm(digitos, filtros) {
  const pos = await posicionesDe(digitos);
  if (!pos) return null;

  const params = [pos.ids];
  const where = filtroPeriodos('i', filtros, params) + filtroProcedenciaAduana('i', 'c', filtros, params);
  const [rows] = await pool.query(`
    SELECT i.PaisOrigen AS pais_origen, p.Descrip AS pais_origen_desc, i.UnidadMedida AS unidad,
           COUNT(DISTINCT i.IdPosicion) AS posiciones,
           COUNT(*)                AS items,
           SUM(i.CantidadUnidades) AS cantidad,
           SUM(i.FobTotalDolares)           AS fob_usd,
           MIN(i.ValorUnitario)    AS vu_min,
           MAX(i.ValorUnitario)    AS vu_max,
           ROUND(SUM(i.FobTotalDolares) / NULLIF(SUM(i.CantidadUnidades), 0), 6) AS vu_promedio
    FROM item i
    ${filtros.aduanas?.length ? 'JOIN caratula c ON c.IdOperacion = i.IdOperacion AND c.Periodo = i.Periodo' : ''}
    LEFT JOIN paises p ON p.Codigo = i.PaisOrigen
    WHERE i.IdPosicion IN (?)${where}
    GROUP BY i.PaisOrigen, p.Descrip, i.UnidadMedida
    ORDER BY fob_usd DESC`, params);

  return { ncm: pos.codigo, nivel: pos.nivel, descripcion: pos.descripcion, filtros, origenes: rows };
}

// Ítems con valor unitario por debajo de umbral x promedio. El promedio de
// referencia es siempre el de su propia NCM y unidad, también al consultar
// una partida: no se compara un ítem contra mercaderías distintas.
// Los filtros de procedencia y aduana eligen QUÉ ítems se revisan; el
// promedio de referencia es el de todo el mercado en esos períodos.
async function valoresBajos(digitos, { filtros, umbral, limite }) {
  const pos = await posicionesDe(digitos);
  if (!pos) return null;

  const paramsRef = [pos.ids];
  const filtroRef = filtroPeriodos('x', filtros, paramsRef);
  const paramsItems = [pos.ids];
  const filtroItems = filtroPeriodos('i', filtros, paramsItems) + filtroProcedenciaAduana('i', 'c', filtros, paramsItems);

  const [rows] = await pool.query(`
    WITH ref AS (
      SELECT x.IdPosicion, x.UnidadMedida, SUM(x.FobTotalDolares) / NULLIF(SUM(x.CantidadUnidades), 0) AS vu_ref
      FROM item x
      WHERE x.IdPosicion IN (?)${filtroRef}
      GROUP BY x.IdPosicion, x.UnidadMedida
    )
    SELECT c.NroAduana AS nro_despacho, c.Periodo AS periodo, imp.Nombre AS importador,
           i.Item AS item, n.PosicionSIM AS ncm, i.PaisOrigen AS pais_origen,
           i.PaisProcedencia AS pais_procedencia, c.AduanaOficializacion AS aduana, i.UnidadMedida AS unidad,
           i.CantidadUnidades AS cantidad, i.ValorUnitario AS valor_unitario,
           ROUND(r.vu_ref, 6)                   AS vu_promedio,
           ROUND(i.ValorUnitario / r.vu_ref, 3) AS proporcion
    FROM item i
    JOIN ref r            ON r.IdPosicion = i.IdPosicion AND r.UnidadMedida <=> i.UnidadMedida
    JOIN posicion n       ON n.IdPosicion = i.IdPosicion
    JOIN caratula c       ON c.IdOperacion = i.IdOperacion AND c.Periodo = i.Periodo
    JOIN importadores imp ON imp.IdImportador = c.IdImportador
    WHERE i.IdPosicion IN (?)${filtroItems}
      AND i.ValorUnitario < r.vu_ref * ?
    ORDER BY proporcion
    LIMIT ?`, [...paramsRef, ...paramsItems, umbral, limite]);

  return { ncm: pos.codigo, nivel: pos.nivel, descripcion: pos.descripcion, filtros, umbral, items: rows };
}

async function buscarImportadores(texto, periodo) {
  const params = [`%${texto}%`];
  const [rows] = await pool.query(`
    SELECT imp.Nombre AS nombre,
           COUNT(DISTINCT c.IdOperacion) AS despachos,
           COUNT(*)                     AS items,
           SUM(i.FobTotalDolares)                AS fob_usd
    FROM importadores imp
    JOIN caratula c ON c.IdImportador = imp.IdImportador
    JOIN item     i ON i.IdOperacion = c.IdOperacion AND i.Periodo = c.Periodo
    WHERE imp.Nombre LIKE ?${filtroPeriodo('c', periodo, params)}
    GROUP BY imp.IdImportador, imp.Nombre
    ORDER BY fob_usd DESC
    LIMIT 50`, params);
  return rows;
}

// Origen del ítem distinto de la procedencia del embarque
// Área aduanera especial de Tierra del Fuego y zonas francas argentinas
// (códigos de país del KIT). Una mercadería que entra desde ellas tiene
// origen distinto de procedencia sin ser una triangulación comercial. Las
// zonas francas de otros países (Colón, Iquique, Uruguay) sí cuentan.
const ZONAS_ARGENTINAS = ['250', '251', '252', '253', '255', '256', '257', '258', '259',
  '262', '263', '264', '266', '267', '268', '269'];

// Columnas por las que se puede ordenar: nombre en la API -> expresión SQL
const ORDEN_TRIANGULACIONES = {
  ncm: 'ncm', origen: 'pais_origen_desc', procedencia: 'pais_procedencia_desc', items: 'items', fob: 'fob_usd',
};

// Ítems cuyo origen difiere de su procedencia. Se usa la procedencia del ítem
// (item.PaisProcedencia), que es la que trae cada línea del archivo de ARCA.
// Filtros opcionales: partida, subpartida o NCM (4, 6 u 8 dígitos), país de
// origen y país de procedencia. Orden por cualquier columna, ASC o DESC.
async function triangulaciones({ periodo, ncm, origen, procedencia, excluirZonas, orden, dir, limite }) {
  const params = [];
  let where = filtroPeriodo('i', periodo, params);
  if (ncm) {
    const pos = await posicionesDe(ncm);
    if (!pos) return [];
    where += ' AND i.IdPosicion IN (?)';
    params.push(pos.ids);
  }
  if (origen) { where += ' AND i.PaisOrigen = ?'; params.push(origen); }
  if (procedencia) { where += ' AND i.PaisProcedencia = ?'; params.push(procedencia); }
  if (excluirZonas) {
    where += ' AND i.PaisOrigen NOT IN (?) AND i.PaisProcedencia NOT IN (?)';
    params.push(ZONAS_ARGENTINAS, ZONAS_ARGENTINAS);
  }
  const columna = ORDEN_TRIANGULACIONES[orden] || 'fob_usd';
  const sentido = dir === 'asc' ? 'ASC' : 'DESC';

  const [rows] = await pool.query(`
    SELECT n.PosicionSIM AS ncm, i.PaisOrigen AS pais_origen, po.Descrip AS pais_origen_desc,
           i.PaisProcedencia AS pais_procedencia, pp.Descrip AS pais_procedencia_desc,
           COUNT(*)      AS items,
           SUM(i.FobTotalDolares) AS fob_usd
    FROM item i
    JOIN posicion n ON n.IdPosicion = i.IdPosicion
    LEFT JOIN paises po ON po.Codigo = i.PaisOrigen
    LEFT JOIN paises pp ON pp.Codigo = i.PaisProcedencia
    WHERE i.PaisOrigen <> i.PaisProcedencia${where}
    GROUP BY n.PosicionSIM, i.PaisOrigen, po.Descrip, i.PaisProcedencia, pp.Descrip
    ORDER BY ${columna} ${sentido}, fob_usd DESC
    LIMIT ?`, [...params, limite]);
  return rows;
}

// ---------- matriz de importaciones ----------
// Una sola consulta pesada (ítems x carátula) agrupada por periodo, grupo de
// destinación y capítulo: unas 1.000 filas. Todo lo demás (secciones,
// filtros de grupo, participaciones) se arma en memoria. Se guarda unos
// minutos porque sólo cambia al cargar o copiar un mes.
const CACHE_MATRIZ_MS = 10 * 60 * 1000;
let cacheMatriz = null;

async function baseMatriz() {
  if (cacheMatriz && Date.now() - cacheMatriz.hora < CACHE_MATRIZ_MS) return cacheMatriz;
  const [filas] = await pool.query(`
    SELECT i.Periodo AS periodo, COALESCE(g.Grupo, 'CONSUMO') AS grupo, p.Capitulo AS capitulo,
           SUM(i.FobTotalDolares) AS fob_usd, COUNT(*) AS items
    FROM item i
    JOIN caratula c ON c.IdOperacion = i.IdOperacion AND c.Periodo = i.Periodo
    JOIN posicion p ON p.IdPosicion = i.IdPosicion
    LEFT JOIN grupo_destinacion g ON g.Destinacion = c.Destinacion
    GROUP BY i.Periodo, COALESCE(g.Grupo, 'CONSUMO'), p.Capitulo`);
  const [secciones] = await pool.query('SELECT Codigo AS codigo, Descrip AS descrip FROM seccion ORDER BY Numero');
  const [capitulos] = await pool.query('SELECT Codigo AS codigo, Seccion AS seccion, Descrip AS descrip FROM capitulo ORDER BY Codigo');
  const [grupos] = await pool.query(
    'SELECT Codigo AS codigo, Descrip AS descrip, PorDefecto AS por_defecto FROM grupo ORDER BY Orden');
  cacheMatriz = { hora: Date.now(), filas, secciones, capitulos, grupos };
  return cacheMatriz;
}

// nivel 'seccion': las 21 secciones; nivel 'capitulo': los capítulos de una sección.
// grupos: códigos de grupo a incluir (null = los que tienen PorDefecto).
async function matriz({ nivel, seccion, grupos }) {
  const base = await baseMatriz();
  const capituloDe = new Map(base.capitulos.map((c) => [c.codigo, c]));
  const incluidos = new Set(grupos || base.grupos.filter((g) => g.por_defecto).map((g) => g.codigo));

  let categorias;
  let claveDe;
  if (nivel === 'capitulo') {
    categorias = base.capitulos.filter((c) => c.seccion === seccion);
    claveDe = (cap) => (capituloDe.get(cap)?.seccion === seccion ? cap : null);
  } else {
    categorias = base.secciones.concat([{ codigo: 'S/S', descrip: 'Sin sección (capítulo no clasificado)' }]);
    claveDe = (cap) => capituloDe.get(cap)?.seccion || 'S/S';
  }

  const periodos = [...new Set(base.filas.map((f) => f.periodo))].sort();
  const valores = new Map();           // "periodo|codigo" -> fob
  const totalesGrupo = new Map();      // "periodo|grupo"  -> fob (todos los grupos, para el aviso)
  for (const f of base.filas) {
    const fob = Number(f.fob_usd);
    totalesGrupo.set(`${f.periodo}|${f.grupo}`, (totalesGrupo.get(`${f.periodo}|${f.grupo}`) || 0) + fob);
    if (!incluidos.has(f.grupo)) continue;
    const clave = claveDe(f.capitulo);
    if (!clave) continue;
    valores.set(`${f.periodo}|${clave}`, (valores.get(`${f.periodo}|${clave}`) || 0) + fob);
  }

  const redondo = (v) => Math.round(v * 100) / 100;
  const totales = Object.fromEntries(periodos.map((p) => [p,
    redondo(categorias.reduce((a, c) => a + (valores.get(`${p}|${c.codigo}`) || 0), 0))]));
  const filas = categorias.map((c) => {
    const por_periodo = Object.fromEntries(periodos.map((p) => [p, redondo(valores.get(`${p}|${c.codigo}`) || 0)]));
    const total = Object.values(por_periodo).reduce((a, v) => a + v, 0);
    return { codigo: c.codigo, descrip: c.descrip, por_periodo, total: redondo(total) };
  }).filter((f) => f.total > 0 || nivel === 'capitulo');

  return {
    nivel,
    seccion: nivel === 'capitulo' ? base.secciones.find((x) => x.codigo === seccion) || null : null,
    periodos,
    totales,
    categorias: filas,
    grupos: base.grupos.map((g) => ({
      codigo: g.codigo,
      descrip: g.descrip,
      incluido: incluidos.has(g.codigo),
      por_periodo: Object.fromEntries(periodos.map((p) => [p, redondo(totalesGrupo.get(`${p}|${g.codigo}`) || 0)])),
    })),
    secciones: base.secciones,
  };
}

// ---------- sugerencias para el autocompletado ----------
// Consultas chicas y con LIMIT: se llaman mientras el usuario escribe.

// Despachos que empiezan con el prefijo. Usa el índice ux_nroaduana
// (NroAduana, Periodo): es un rango sobre el índice, no recorre la tabla.
async function sugerirDespachos(prefijo, periodo, limite) {
  const params = [`${prefijo}%`];
  const filtro = filtroPeriodo('c', periodo, params);
  const [rows] = await pool.query(`
    SELECT c.NroAduana AS nro_despacho, c.Periodo AS periodo, imp.Nombre AS importador
    FROM caratula c
    JOIN importadores imp ON imp.IdImportador = c.IdImportador
    WHERE c.NroAduana LIKE ?${filtro}
    ORDER BY c.NroAduana, c.Periodo
    LIMIT ?`, [...params, limite]);
  return rows;
}

// Posiciones NCM del KIT por código (prefijo, sobre el índice único de
// PosicionSIM) o por texto de la descripción.
async function sugerirNcm({ prefijo, texto, limite }) {
  const [rows] = prefijo
    ? await pool.query(`
        SELECT PosicionSIM AS ncm, DescripcionNCM AS descripcion
        FROM posicion WHERE PosicionSIM LIKE ?
        ORDER BY PosicionSIM LIMIT ?`, [`${prefijo}%`, limite])
    : await pool.query(`
        SELECT PosicionSIM AS ncm, DescripcionNCM AS descripcion
        FROM posicion WHERE DescripcionNCM LIKE ?
        ORDER BY PosicionSIM LIMIT ?`, [`%${texto}%`, limite]);
  return rows.map((r) => ({ ...r, descripcion: (r.descripcion || '').slice(0, 120) }));
}

// Nombres de importadores: primero los que empiezan con el texto.
async function sugerirImportadores(texto, limite) {
  const [rows] = await pool.query(`
    SELECT Nombre AS nombre
    FROM importadores
    WHERE Nombre LIKE ?
    ORDER BY (Nombre LIKE ?) DESC, Nombre
    LIMIT ?`, [`%${texto}%`, `${texto}%`, limite]);
  return rows;
}

module.exports = {
  matriz,
  listarPeriodos,
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
