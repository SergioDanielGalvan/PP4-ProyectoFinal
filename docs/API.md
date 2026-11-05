# API de importaciones · guía para el front

Base: `https://pp4-comex.onrender.com/api` (local: `http://localhost:3000/api`).
Todas las respuestas son JSON. Los errores tienen siempre la forma
`{ "error": "mensaje para mostrar" }` con el código HTTP correspondiente.

> El servicio gratis de Render se duerme a los 15 minutos sin uso: la primera
> llamada puede tardar cerca de un minuto. Conviene mostrar un "cargando".

## 1. Autenticación (JWT)

1. `POST /auth/login` con `{ "usuario": "...", "clave": "..." }`.
2. La respuesta trae `token`; guardarlo (memoria o `localStorage`).
3. Mandarlo en cada pedido: `Authorization: Bearer <token>`.
4. Si una respuesta es **401**, el token venció, el usuario fue desactivado o
   su clave cambió: volver al login.

```js
const r = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ usuario, clave }),
});
const datos = await r.json();
if (!r.ok) throw new Error(datos.error);         // 401 clave mala, 429 demasiados intentos
localStorage.setItem('token', datos.token);

// después, en cada llamada
fetch(`${API}/impo/periodos`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
```

| Método y ruta | Quién | Cuerpo / parámetros | Respuesta |
|---|---|---|---|
| `POST /auth/login` | todos | `usuario`, `clave` | `{ token, tipo, expira, usuario: { id, usuario, nombre, rol } }` |
| `GET /auth/yo` | logueado | | `{ id, usuario, nombre, rol, ultimo_ingreso }` |
| `POST /auth/clave` | logueado | `actual`, `nueva` (10 a 72 caracteres, distinta de la actual) | `{ ok: true, token }`: guardar el token nuevo; los anteriores de ese usuario dejan de valer. Clave actual equivocada: 400 (cuenta para el freno de intentos del login) |
| `GET /auth/usuarios` | admin | | lista de usuarios (sin claves) |
| `POST /auth/usuarios` | admin | `usuario`, `nombre`, `clave`, `rol` (`admin`/`consulta`) | usuario creado (201) |
| `PATCH /auth/usuarios/:id` | admin | cualquiera de `nombre`, `rol`, `activo` (`true`/`false`, sin comillas), `clave` | usuario modificado |
| `DELETE /auth/usuarios/:id` | admin | | `{ ok, eliminado }`. Sólo usuarios que nunca ingresaron; si ya ingresó, 409 (desactivarlo con `PATCH activo: false`) |

- Roles: **consulta** (ve los datos) y **admin** (además administra usuarios y
  puede ejecutar SQL libre).
- Un usuario que nunca ingresó se puede eliminar. Uno que ya ingresó se
  desactiva (`activo: false`), para conservar el historial; deja de poder usar
  su token en menos de un minuto.
- Nadie puede eliminarse ni desactivarse a sí mismo, y siempre queda al menos
  un administrador activo.
- Login: 5 intentos fallidos seguidos bloquean ese usuario desde esa IP por 15 minutos (429).
- El token dura 8 horas (configurable con `JWT_EXPIRA`).
- Cuando cambia la clave de un usuario (la cambia él con `POST /auth/clave` o
  un admin con `PATCH`), todos sus tokens anteriores dejan de valer al momento
  (401 "La clave cambió: volvé a iniciar sesión."). El token lleva una huella
  de la clave vigente, no la clave.

**Modo prueba:** mientras el servidor tenga `AUTH_ENABLED=false`, las rutas
de consulta (`/impo` y `/consultas`) responden sin token. Las de
administración y el SQL libre exigen token de admin **siempre**.

## 2. Datos de importación (`/impo`)

| Método y ruta | Parámetros | Devuelve |
|---|---|---|
| `GET /impo/periodos` | | `[{ periodo, caratulas, items }]` |
| `GET /impo/catalogos` | | `{ regiones, paises, aduanas }` para armar los filtros |
| `GET /impo/matriz` | `nivel` (`seccion`/`capitulo`), `seccion` (I…XXI), `grupos` (lista: CONSUMO,TEMP,ZF,REDES,AAE) | FOB por sección o capítulo y mes (ver abajo) |
| `GET /impo/cotizaciones` | `fecha` (AAAA-MM-DD, la fecha de despacho; por defecto hoy) | `{ fuente, fecha_despacho, fecha_publicacion, fecha_publicacion_anterior, monedas: [{ codigo, descripcion, vendedor, comprador, pase_vendedor, pase_comprador, variacion_vendedor }] }`. Tipo de cambio aduanero que publica ARCA (cotizaciones MARIA): para los despachos del día D vale la publicación del día hábil anterior. La API lee la página de ARCA (sigue su redirección y su formulario, como el lector del Módulo MARIA) y guarda cada fecha pasada en memoria; la de hoy, una hora. Si ARCA no responde: 502 con el motivo |
| `GET /impo/tablero` | `periodo`, `pais` (origen, 3 dígitos), `ncm` (capítulo, partida, subpartida o NCM: 2, 4, 6 u 8 dígitos), `grupos` (grupos de destinación como en la Matriz; sin el parámetro, los de por defecto: sin `REDES` ni `AAE`) | `{ filtros, grupos: [{ codigo, descrip, por_defecto, incluido }], indicadores: { fob, items, despachos, importadores, paises, periodo_anterior, anterior }, paises (top 10 + resto, con participacion; no se filtra por país), meses (evolución completa, sin el filtro de período), ncm (top 50), aduanas (top 15) }`. Cada combinación se guarda 10 minutos |
| `GET /impo/despachos` | `periodo`, `anio` (2 dígitos, como en el número: `26`), `aduana` (3 dígitos), `destinacion` (`IC04`), `importador` (3 letras o más), `ncm` (2, 4, 6 u 8 dígitos) y `origen` (país, 3 dígitos): despachos con al menos un ítem que cumpla, `grupos` (grupos de destinación; sin el parámetro, todas las destinaciones), `orden` (`despacho`, `periodo`, `importador`, `carga`; por defecto `carga`), `dir` (`desc`/`asc`), `pagina`, `tamanio` (hasta 100) | `{ total, pagina, tamanio, resultados: [{ nro_despacho, periodo, destinacion, aduana, aduana_desc, importador, divisa, divisa_abrev, fob_total_divisa, items }] }`. `orden=despacho` ordena por número: dentro de una aduana, los últimos registrados primero |
| `GET /impo/despachos/:nro` | | carátula con ítems y liquidación |
| `GET /impo/subpartidas` | `desde`, `hasta` (rango NCM), `periodo`, `limite`, y los filtros de Precios: `origenes`, `region`, `paises`, `aduanas`, `periodo_desde`, `periodo_hasta` (el rango de períodos se llama así porque `desde`/`hasta` ya son el rango NCM) | resumen por NCM, con `filtros` aplicados |
| `GET /impo/ncm/:ncm/precios` | `periodo` o `desde`/`hasta`, `region`, `paises`, `aduanas` (ver filtros) | valores unitarios por origen y unidad; `nivel` y, fuera de NCM, `posiciones` (cuántas NCM entran en cada fila) |
| `GET /impo/ncm/:ncm/valores-bajos` | los mismos filtros, `umbral`, `limite` | ítems bajo el umbral, cada uno contra el promedio de su propia NCM y unidad; incluye `ncm` |
| `GET /impo/importadores` | `q`, `periodo` | despachos, ítems y FOB por importador (hasta 50, los de mayor FOB) |
| `GET /impo/importadores/ranking` | `periodo`, `q` (texto en el nombre, opcional), `orden` (`fob`, `nombre`, `despachos`, `items`), `dir` (`desc`/`asc`), `desde` (0), `limite` (100; hasta 100.000 para exportar todo) | `{ total, total_fob, desde, filas: [{ id, nombre, despachos, items, fob_usd, participacion }] }`. Todos los importadores del período, por partes. El ranking se calcula una vez por período y se guarda 10 minutos |
| `GET /impo/importadores/:id/despachos` | `periodo`, `orden` (`fecha`, `despacho`, `items`, `fob`), `dir`, `desde`, `limite` (100) | `{ importador: { id, nombre, despachos, items, fob_usd }, total, desde, filas: [{ nro_despacho, periodo, destinacion, aduana, aduana_desc, pais_procedencia, pais_procedencia_desc, items, fob_usd }] }`; 404 si no existe |
| `GET /impo/triangulaciones` | `periodo`, `ncm` (4, 6 u 8 dígitos), `origen`, `procedencia` (códigos de país), `excluir_zonas` (por defecto `1`: excluye el AAE de Tierra del Fuego y las zonas francas argentinas; `0` o `false` las incluye), `orden` (`ncm`, `origen`, `procedencia`, `items`, `fob`), `dir` (`asc`/`desc`), `limite` (50, hasta 500) | ítems con origen distinto de su procedencia (la del ítem) |
| `GET /impo/sugerencias/despachos` | `prefijo` (5 a 16 caracteres: año y aduana como mínimo), `periodo`, `limite` (15) | `[{ nro_despacho, periodo, importador }]` |
| `GET /impo/sugerencias/ncm` | `q`: 2 a 8 dígitos con o sin puntos (`847130`, `8471.30`) o 3 letras de la descripción; `limite` (15) | `[{ ncm, descripcion }]` (descripción cortada a 120 caracteres) |
| `GET /impo/sugerencias/importadores` | `q` (3 letras o más), `limite` (15) | `[{ id, nombre }]`, primero los que empiezan con el texto |

`periodo` es AAAAMM (`202608`). Montos en US$ FOB.

En `/ncm/:ncm/...`, `:ncm` es un código completo: partida (`8471`), subpartida (`8471.30` u `847130`) o NCM (`8471.30.12` u `84713012`). Otra cantidad de dígitos da 400. La respuesta trae `nivel`: `partida`, `subpartida` o `ncm`.

Filtros de Precios (todos opcionales, se combinan):

- `desde` / `hasta` (AAAAMM): rango de períodos; si viene, reemplaza a `periodo`.
- `origenes`: códigos de país de **origen** separados por coma (`310`).
- `region`: primer dígito del código de país de **procedencia** (1 África, 2 América, 3 Asia, 4 Europa, 5 Oceanía, 7 varios, 9 indeterminado).
- `paises`: códigos de país de procedencia separados por coma (`310,225`).
- `aduanas`: códigos de aduana de oficialización separados por coma (`001,073`).

En `valores-bajos` los filtros eligen qué ítems se revisan; el promedio de referencia es el de todo el mercado de la NCM en esos períodos. Cada ítem trae `pais_procedencia` y `aduana`.

Las rutas `/sugerencias/*` son para autocompletar mientras se escribe: respuestas cortas, con límite, sobre índices. En la página, `autocompletar()` (al final de `impo.js`) espera 250 ms después de la última tecla antes de pedir.

Respuesta de `/impo/matriz` (para gráficos):

```json
{
  "nivel": "seccion",
  "periodos": [202607, 202608, 202609],
  "totales": { "202607": 5100000000, "...": 0 },
  "categorias": [
    { "codigo": "XVI", "descrip": "Máquinas, aparatos y material eléctrico",
      "por_periodo": { "202607": 1400000000, "...": 0 }, "total": 4334800000 }
  ],
  "grupos": [ { "codigo": "REDES", "descrip": "...", "incluido": false, "por_periodo": { } } ],
  "secciones": [ { "codigo": "I", "descrip": "..." } ]
}
```

## 3. Consultas SQL (`/consultas`)

### Consultas guardadas (cualquier usuario logueado)

`GET /consultas` devuelve el catálogo: nombre, título, descripción y parámetros
de cada una. `GET /consultas/:nombre?param=valor` la ejecuta.

| Nombre | Parámetros |
|---|---|
| `secciones-por-mes` | `periodo` (opcional) |
| `destinaciones` | `periodo` (opcional) |
| `energia-electrica` | `periodo` (opcional) |
| `items-repetidos` | `periodo` (opcional), `minimo_usd` (1000000), `limite` (50) |
| `top-importadores` | `periodo` (opcional), `limite` (20) |

Respuesta (igual para SQL libre):

```json
{
  "columnas": ["importador", "despachos", "items", "fob_usd"],
  "filas": [["EMPRESA SA", 120, 900, 15000000.5]],
  "cantidad": 1, "recortado": false, "limite": 20, "milisegundos": 85
}
```

`filas` son arrays en el orden de `columnas` (sirve para armar una tabla
genérica). `recortado: true` indica que había más filas que el límite.

Para agregar una consulta guardada: un archivo `.sql` en `api/src/consultas/`
con este encabezado (los parámetros van en el SQL como `:nombre`):

```sql
-- titulo: Título que ve el usuario
-- descripcion: Para qué sirve
-- parametros: periodo:periodo:opcional, limite:entero:20
SELECT ... WHERE (:periodo IS NULL OR i.Periodo = :periodo) LIMIT :limite
```

Tipos: `periodo` (AAAAMM), `entero`, `texto`. El tercer valor es el valor
por defecto, u `opcional` (llega como NULL si no se manda).

### SQL libre (sólo admin)

`POST /consultas/sql` con `{ "sql": "SELECT ...", "limite": 1000 }`.

- Sólo lectura: `SELECT`, `WITH`, `SHOW`, `EXPLAIN`, `DESCRIBE`; una sentencia por vez.
- Corre con el usuario de base de la API, que no puede modificar los datos.
- Máximo 5.000 filas y 30 segundos (configurables con `SQL_LIMITE_FILAS` y `SQL_TIEMPO_MAX_SEG`).
- No permite leer la tabla `usuarios`.
- Errores: 400 (SQL inválido o no permitido, con el mensaje de la base), 408 (tiempo superado).
- Cada ejecución queda en el log del servidor y en la auditoría, con el usuario que la hizo y el texto de la consulta.

## 4. Actividad de los usuarios (`/auditoria`, sólo admin)

La API registra cada pedido en la tabla `auditoria` (`db/08_auditoria.sql`)
después de responder, sin demorar la respuesta: quién, qué acción, ruta y
parámetros, código HTTP, filas devueltas, duración e IP. No se registran los
pedidos automáticos de la página (sugerencias del autocompletado, períodos,
catálogos, `/auth/yo`). **Nunca se guardan claves ni tokens:** de un cambio
de usuario queda "rol consulta → admin, clave cambiada", sin la clave.

| Acción | Cuándo |
|---|---|
| `consulta` | Cualquier GET de datos (`/impo/...`, `/consultas/...`, lista de usuarios) |
| `login`, `login_fallido`, `login_bloqueado` | Ingreso correcto, clave o usuario incorrectos, bloqueo por intentos (429). En los fallidos queda el usuario que se escribió |
| `cambio_clave` | `POST /auth/clave` |
| `alta_usuario`, `modif_usuario`, `baja_usuario` | POST, PATCH y DELETE de `/auth/usuarios`, con el detalle de qué cambió |
| `sql_libre` | `POST /consultas/sql`, con el texto de la consulta |
| `ver_auditoria` | Consultas a esta misma sección |

| Método y ruta | Parámetros | Devuelve |
|---|---|---|
| `GET /auditoria` | `usuario`, `accion`, `desde`, `hasta` (AAAA-MM-DD, ambos incluidos), `errores=1` (sólo código ≥ 400), `limite` (100, hasta 1000), `antes` (id del último registro recibido, para la página siguiente) | `{ filas: [{ id, fecha, usuario, accion, metodo, ruta, detalle, estado, filas, duracion_ms, ip }], hay_mas }`, del más reciente al más viejo |
| `GET /auditoria/resumen` | `usuario`, `desde`, `hasta` | por usuario: `ingresos`, `consultas`, `ingresos_fallidos`, `cambios_usuarios`, `sql_libre`, `errores`, `ultima` |

Variables del servidor: `AUDITORIA=false` apaga el registro; `AUDITORIA_DIAS`
(180) es cuánto se conserva (lo más viejo se borra una vez por día; `0` no
borra nunca). `DB_TIMEZONE` (`-03:00`) fija la hora de la sesión de base,
para que la auditoría y el último ingreso queden en hora de Argentina también
en TiDB, que usa UTC.
