# comex-impo

API REST en Node.js + Express + MySQL para consultar las estadísticas de
importación que publica ARCA/AFIP (información agregada de comercio exterior).

## Estructura

```
comex-impo/
├── package.json
├── .env.example            copiar como .env y completar
├── docs/DECISIONES.md      por qué el modelo es como es
├── access/
│   ├── CorregirEstadisticas.bas  módulo VBA que corrige Estadisticas.mdb
│   ├── NroAduana.bas             dígito verificador del número de destinación
│   └── posicion.csv              10.503 subpartidas con descripción, para POSICION
├── sql/
│   ├── 01_schema.sql         tablas del KIT, importadores, caratula, item, liq
│   ├── 02_tablas_sim_kit.sql códigos y descripciones generados desde Kit.mdb
│   ├── kit2sql.py            regenera el 02 desde un Kit.mdb completo
│   ├── 03_seed_demo.sql      datos ficticios (opcional) con códigos reales
│   └── 04_carga_mensual.sql  carga de un mes desde el .LST (MySQL local)
├── src/
│   ├── server.js           arranque (lee .env y levanta el puerto)
│   ├── app.js              Express: estáticos, rutas y manejo de errores
│   ├── config/db.js        pool de conexiones mysql2
│   ├── middlewares/
│   │   ├── auth.js         enganche con el login (inactivo con AUTH_ENABLED=false)
│   │   └── errors.js       404, errores de validación y de base
│   ├── routes/impo.routes.js
│   ├── controllers/impo.controller.js   valida parámetros y arma la respuesta
│   └── models/impo.model.js             consultas SQL
└── public/
    ├── impo.html           página de prueba
    ├── css/impo.css
    └── js/impo.js
```

Cada capa tiene una sola tarea: la ruta define la URL, el controlador valida
lo que llega y el modelo es el único que escribe SQL.

## Puesta en marcha

```bash
mysql -u root -p --default-character-set=utf8mb4 < sql/01_schema.sql
mysql -u root -p --default-character-set=utf8mb4 < sql/02_tablas_sim_kit.sql
mysql -u root -p --default-character-set=utf8mb4 < sql/03_seed_demo.sql   # opcional
cp .env.example .env                          # completar usuario y clave
npm install
npm run dev
```

Abrir http://localhost:3000/impo.html

Para cargar un mes real: poner la ruta del .LST en el `LOAD DATA` de
`sql/04_carga_mensual.sql` y correrlo con `mysql --local-infile=1`. El periodo
se toma del archivo y la partición del mes se crea sola. Los meses se cargan
en orden cronológico; recargar un mes ya cargado lo reemplaza.

## Archivo de ARCA

Listado de mainframe: empieza con salto de página, trae encabezado y guiones,
y cada línea se rellena con espacios hasta unos 700 caracteres. Campos
separados por `'`:

`ADU'DESTINACION'NUM_ITEM'FECHA_(AAAAMM)'NOMBRE_IMPORTADOR(30)'M'UN'CANTIDAD'FOB_DOLAR(ítem, USD)'FOB_TOTAL(destinación, en la divisa DIV)'DIV'PAI(origen)'PAI(procedencia)'POS_NCM'COD'MONTO`

Cada línea es ítem x concepto. No trae fecha de oficialización ni posición SIM.
El medio de transporte viene vacío en IC06 (sobre depósito). Hay ítems que no
vienen en el archivo (números salteados); la validación f) de la carga los mide.

Para actualizar las tablas SIM cuando cambie el KIT, regenerar
`02_tablas_sim_kit.sql` desde el `.mdb` (se usó `mdb-export` de mdbtools,
tomando por código la fila con FechaInicio más reciente).

## Endpoints

| Método y ruta | Parámetros | Devuelve |
|---|---|---|
| `GET /api/health` | | estado de la conexión |
| `GET /api/impo/periodos` | | periodos cargados con cantidad de carátulas e ítems |
| `GET /api/impo/destinaciones` | `periodo`, `importador`, `pagina`, `tamanio` | listado paginado |
| `GET /api/impo/destinaciones/:nro` | | carátula con ítems y aranceles anidados; acepta el número sin la letra y controla el verificador |
| `GET /api/impo/ncm/:ncm/precios` | `periodo` | valor unitario mínimo, promedio y máximo por origen y unidad |
| `GET /api/impo/ncm/:ncm/valores-bajos` | `periodo`, `umbral` (0-1), `limite` | ítems con valor unitario bajo el umbral del promedio |
| `GET /api/impo/importadores` | `q` (mín. 3 letras), `periodo` | destinaciones, ítems y FOB |
| `GET /api/impo/triangulaciones` | `periodo`, `limite` | ítems con origen distinto de la procedencia |

`periodo` va como AAAAMM. La NCM se acepta con o sin puntos.

## Integración con la plantilla Login

1. Copiar `src/config/db.js`, `routes/impo.routes.js`,
   `controllers/impo.controller.js`, `models/impo.model.js` y
   `middlewares/errors.js` a las carpetas equivalentes de la plantilla.
2. Copiar `public/impo.html`, `css/impo.css` y `js/impo.js` a su carpeta pública.
3. En el `app.js` de la plantilla, montar la ruta **antes** del middleware
   que exige login, para que por ahora quede abierta:

   ```js
   const impoRoutes = require('./routes/impo.routes');
   app.use('/api/impo', impoRoutes);   // abierta, sin login
   // ... después, lo que la plantilla protege con login
   ```

4. Cuando haya que protegerla, pasarla después del middleware de login o
   usar `requireAuth` de `middlewares/auth.js` con `AUTH_ENABLED=true`.

## Demo en TiDB Cloud

Crear el esquema con `01_schema.sql`, cargar `02_tablas_sim_kit.sql`, importar un dump de las tablas finales
(sin staging) y poner `DB_SSL=true` en el `.env`.

## Modelo Access

`Estadisticas.mdb` es la versión de diseño del mismo modelo, con las tablas del
KIT vinculadas desde `Kit.mdb`. Para aplicarle las correcciones: hacer una
copia, copiar `posicion.csv` a la carpeta del `.mdb`, importar
`access/CorregirEstadisticas.bas` (Alt+F11 > Archivo > Importar archivo) y
ejecutar `CorregirEstadisticas`. Qué cambia y por qué: `docs/DECISIONES.md`.
