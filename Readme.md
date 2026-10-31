# PP4 - Estadísticas de importación (ARCA)

Base MySQL con la información agregada de comercio exterior que publica ARCA
(archivos mensuales), más una API REST en Node.js con una página de consulta.

Son dos proyectos en un mismo repositorio, porque comparten el modelo de datos:

| Carpeta | Contenido |
|---|---|
| `carga/` | Proyecto 1: tablas del KIT desde Access (`npm run kit`, rara vez) y archivos mensuales de ARCA (`npm run mes`) |
| `api/` | Proyecto 2: API REST (Express + MySQL) y página de prueba en `public/` |
| `db/` | Scripts SQL compartidos: usuarios, esquema, KIT completo, datos de prueba y migraciones |
| `access/` | Modelo de diseño provisorio (`Estadisticas.mdb`, `Kit.mdb`) y módulos VBA |
| `docs/` | Decisiones de diseño (`DECISIONES.md`), entregas y diagramas |

## Puesta en marcha

Requisitos: MariaDB 10.4 o superior (XAMPP) o MySQL 8, y Node 18 o superior.
Comandos desde la carpeta raíz del repositorio. El cliente de XAMPP está en
`F:\xampp\mysql\bin\mysql.exe`; en PowerShell el `<` no funciona, por eso
los comandos que lo usan van dentro de `cmd /c "..."`.

```bash
# 1. Usuarios (una vez; cambiar antes las claves). Con un usuario que pueda
#    crear usuarios, o pegando el script en phpMyAdmin (pestaña SQL) en el servidor.
cmd /c "F:\xampp\mysql\bin\mysql.exe -h 10.0.0.16 -u sergio -p < db\00_crear_usuarios.sql"

# 2. Proyecto de carga
cd carga
npm install
copy .env.example .env       # completar la clave de comex_admin

npm run base                 # una vez: crea la base y las tablas
npm run kit                  # una vez y cuando cambie el KIT
npm run mes -- E:/ARCA/202609.zip            # cada mes
npm run mes -- E:/ARCA/202609.zip --validar  # sólo valida, no toca las tablas
cd ..

# (opcional) completar lo que falte del KIT y datos de prueba
cmd /c "F:\xampp\mysql\bin\mysql.exe -h 10.0.0.16 -u comex_admin -p --default-character-set=utf8mb4 < db\02_tablas_sim_kit.sql"
cmd /c "F:\xampp\mysql\bin\mysql.exe -h 10.0.0.16 -u comex_admin -p --default-character-set=utf8mb4 < db\03_seed_demo.sql"

# 3. API y página de prueba
cd api
npm install
copy .env.example .env      # completar la clave de comex_api
npm run dev                 # http://localhost:3000/impo.html
```

`npm run base` ejecuta `db/01_schema.sql`; si la base ya existe no la toca
(`--recrear` la borra con sus datos y la vuelve a crear). `npm run mes`
controla antes de empezar que estén la base y el KIT, y si falta algo indica
qué comando ejecutar.

`npm run kit` lee el `.mdb` directamente (no hace falta Access ni ODBC). Agrega
códigos nuevos y actualiza descripciones, pero no borra nada. Si `POSICION`
todavía tiene aperturas SIM (16 caracteres), la reduce a subpartidas.

`npm run mes` lee `impo_AAAAMM.lst` directamente del ZIP (sin descomprimirlo a
disco), descarta el relleno de espacios y los encabezados, lo envía a MySQL,
ejecuta las validaciones y carga `caratula`, `item` y `liq` en la partición
del mes. Volver a cargar un mes lo reemplaza. Cada carga deja un informe en
`carga/informes/impo_AAAAMM.md` con el resultado de cada validación.
Referencia: 600 mil líneas (418 MB) tardan menos de un minuto; un mes real
(5,7 GB) del orden de 15 a 25 minutos, según la PC y la red.

### Configuración de MariaDB (XAMPP) para la carga

La configuración de fábrica de XAMPP es para sitios chicos. La carga funciona
igual (envía el archivo en lotes de 500.000 líneas, en paquetes de 64 KB), pero
para un mes real conviene darle más recursos. En el servidor, con MySQL
detenido desde el panel de XAMPP, editar `xampp\mysql\bin\my.ini`, sección
`[mysqld]` (cambiar las líneas que ya existen):

```ini
max_allowed_packet = 64M
innodb_buffer_pool_size = 1G      ; 512M si la PC tiene menos de 8 GB de RAM
innodb_log_file_size = 256M
innodb_log_buffer_size = 32M
net_read_timeout = 600
net_write_timeout = 600
```

Después iniciar MySQL desde el panel. Si no arranca, volver a los valores
anteriores y revisar `xampp\mysql\data\mysql_error.log`. Si la carga corta la
conexión (`ECONNRESET`), ese mismo log dice por qué; mientras tanto se puede
probar con lotes más chicos (`LINEAS_POR_LOTE=100000` en `carga\.env`).

## Matriz de importaciones

La pestaña **Matriz** muestra la composición por **sección y capítulo de la
NCM**, la misma agrupación con la que INDEC publica el comercio exterior.
Necesita las tablas de `db/06_matriz.sql` (secciones, capítulos y grupos de
destinación); en una base existente se crean con:

```bash
cd carga
npm run base      # no borra nada: sólo crea o actualiza las tablas de la matriz
```

Y para TiDB: `node copiar-a-tidb.js --esquema` y `node copiar-a-tidb.js --fijas`.

## Copia de consulta en TiDB Cloud

La carga mensual se hace siempre en MariaDB; a TiDB Cloud (plan Starter,
gratis) se copia el resultado para publicar la API. En `carga/.env` completar
las variables `TIDB_*` (datos del botón *Connect* de la instancia) y, desde
`carga/`:

```bash
npm run tidb -- --esquema                        # una vez: base y tablas (db/tidb_schema.sql)
npm run tidb -- --fijas                          # una vez y cuando cambie el KIT
npm run tidb -- --periodos 202607,202608,202609  # meses a publicar (con liq)
npm run tidb -- --periodos 202610 --sin-liq      # sin liq, si falta espacio
npm run tidb -- --periodos 202609 --reemplazar   # después de recargar el mes en MariaDB
npm run tidb -- --verificar 202607,202608        # sólo compara cantidades
```

Si la copia se corta, se vuelve a ejecutar lo mismo y retoma. Al final compara
la cantidad de filas de cada mes en las dos bases. La API apunta a TiDB
cambiando `DB_HOST`, `DB_PORT=4000`, `DB_USER` (con el prefijo) y `DB_SSL=true`.

## Pruebas

```bash
cd api
npm install
npm test        # 26 pruebas: unitarias y de integración
```

Las de integración usan la base de `api/.env` (de desarrollo, nunca la de
producción). Qué prueba cada una y la evidencia de la última ejecución:
[`docs/pruebas/`](docs/pruebas/README.md).

## Usuarios y login (JWT)

La guía completa para el front está en [`docs/API.md`](docs/API.md).

1. **MariaDB:** pegar `db/07_usuarios.sql` en la pestaña SQL de phpMyAdmin
   (como root): crea la tabla `usuarios` y le da a `comex_api` permiso de
   escritura y borrado sólo sobre ella.
2. **TiDB:** `node copiar-a-tidb.js --esquema` (desde `carga/`) crea la tabla;
   el permiso, en el SQL Editor de TiDB Cloud:
   `GRANT SELECT, INSERT, UPDATE, DELETE ON comex.usuarios TO 'prefijo.comex_api';`
3. **JWT_SECRET** en `api/.env` y en las variables de Render. Generarla con
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`.
4. **Primer administrador**, desde `api/` (usa la base de `api/.env`; la
   clave se pide por teclado):
   `node scripts/crear-usuario.js --usuario sergio --nombre "Sergio" --rol admin`.
   Los demás usuarios se crean desde la API (`POST /api/auth/usuarios`).

`AUTH_ENABLED=false` deja abiertas las consultas de datos (modo prueba); la
administración de usuarios y el SQL libre piden token de admin siempre.

## Auditoría (pestaña Actividad)

La API registra lo que hace cada usuario (consultas, ingresos e intentos
fallidos, cambios de usuarios y SQL libre) y los administradores lo ven en la
pestaña **Actividad**. Detalle en [`docs/API.md`](docs/API.md) §4.

1. **MariaDB:** pegar `db/08_auditoria.sql` en la pestaña SQL de phpMyAdmin
   (como root): crea la tabla `auditoria` y le da a `comex_api` SELECT,
   INSERT y DELETE sobre ella.
2. **TiDB:** pegar el `CREATE TABLE` de `db/08_auditoria.sql` en el SQL Editor
   (o `node copiar-a-tidb.js --esquema`, que ya la incluye) y dar el permiso:
   `GRANT SELECT, INSERT, DELETE ON comex.auditoria TO 'prefijo.comex_api'@'%';`

Sin la tabla, la API funciona igual y avisa una vez en el log.

## Endpoints de la API

| Método y ruta | Parámetros | Devuelve |
|---|---|---|
| `GET /api/health` | | estado de la conexión |
| `GET /api/impo/periodos` | | periodos cargados con cantidad de carátulas e ítems |
| `GET /api/impo/matriz` | `nivel` (`seccion` o `capitulo`), `seccion` (I…XXI, para capítulos), `grupos` (CONSUMO,TEMP,ZF,REDES,AAE) | FOB por sección o capítulo de la NCM y por mes, con los totales de cada grupo de operaciones |
| `GET /api/impo/despachos` | `periodo`, `importador`, `destinacion` (IC04...), `pagina`, `tamanio` | listado paginado de despachos |
| `GET /api/impo/despachos/:nro` | | carátula con ítems y liquidación; acepta el número sin la letra y controla el verificador |
| `GET /api/impo/subpartidas` | `desde`, `hasta` (2 a 8 dígitos), `periodo`, `limite` | por subpartida NCM y unidad: despachos, ítems, cantidad, FOB, valor unitario y cantidad de orígenes |
| `GET /api/impo/ncm/:ncm/precios` | `periodo` | valor unitario mínimo, promedio y máximo por origen y unidad |
| `GET /api/impo/ncm/:ncm/valores-bajos` | `periodo`, `umbral` (0-1), `limite` | ítems con valor unitario bajo el umbral del promedio |
| `GET /api/impo/importadores` | `q` (mín. 3 letras), `periodo` | despachos, ítems y FOB |
| `GET /api/impo/triangulaciones` | `periodo`, `limite` | ítems con origen distinto de la procedencia |
| `POST /api/auth/login` | `usuario`, `clave` | token JWT (ver `docs/API.md` para el resto de `/api/auth`) |
| `GET /api/consultas` | | catálogo de consultas SQL guardadas |
| `GET /api/consultas/:nombre` | los de cada consulta | `{ columnas, filas, recortado }` |
| `POST /api/consultas/sql` | `sql`, `limite` (sólo admin) | `{ columnas, filas, recortado }` |

`periodo` va como AAAAMM. La NCM se acepta con o sin puntos.

**Terminología:** *despacho* es la operación, identificada por `NroAduana`
(`26001IC04151676V`); *destinación* es el código de 4 caracteres de la tabla
`DESTINACIONES` del KIT (`IC04`), que sale de las posiciones 6 a 9 del número.

## Modelo Access

Para aplicar correcciones al modelo de diseño: copia de respaldo del `.mdb`,
Alt+F11 > Archivo > Importar archivo > `access/CorregirEstadisticas.bas`, y
ejecutar `CorregirEstadisticas`. `access/NroAduana.bas` agrega el cálculo del
dígito verificador para usar en consultas.

## Documentación

Todas las decisiones de diseño, con el dato que las justifica, están en
[`docs/DECISIONES.md`](docs/DECISIONES.md).
