# PP4 - Estadísticas de importación (ARCA)

Base MySQL con la información agregada de comercio exterior que publica ARCA
(archivos mensuales), más una API REST en Node.js con una página de consulta.

Son dos proyectos en un mismo repositorio, porque comparten el modelo de datos:

| Carpeta | Contenido |
|---|---|
| `carga/` | Proyecto 1: tablas del KIT desde Access (`npm run kit`, rara vez) y archivos mensuales de ARCA (`npm run mes`) |
| `api/` | Proyecto 2: API REST (Express + MySQL) y página de prueba en `public/` |
| `db/` | Scripts SQL compartidos: usuarios, esquema, KIT completo y datos de prueba |
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

## Endpoints de la API

| Método y ruta | Parámetros | Devuelve |
|---|---|---|
| `GET /api/health` | | estado de la conexión |
| `GET /api/impo/periodos` | | periodos cargados con cantidad de carátulas e ítems |
| `GET /api/impo/destinaciones` | `periodo`, `importador`, `pagina`, `tamanio` | listado paginado |
| `GET /api/impo/destinaciones/:nro` | | carátula con ítems y liquidación; acepta el número sin la letra y controla el verificador |
| `GET /api/impo/ncm/:ncm/precios` | `periodo` | valor unitario mínimo, promedio y máximo por origen y unidad |
| `GET /api/impo/ncm/:ncm/valores-bajos` | `periodo`, `umbral` (0-1), `limite` | ítems con valor unitario bajo el umbral del promedio |
| `GET /api/impo/importadores` | `q` (mín. 3 letras), `periodo` | destinaciones, ítems y FOB |
| `GET /api/impo/triangulaciones` | `periodo`, `limite` | ítems con origen distinto de la procedencia |

`periodo` va como AAAAMM. La NCM se acepta con o sin puntos.

## Modelo Access

Para aplicar correcciones al modelo de diseño: copia de respaldo del `.mdb`,
Alt+F11 > Archivo > Importar archivo > `access/CorregirEstadisticas.bas`, y
ejecutar `CorregirEstadisticas`. `access/NroAduana.bas` agrega el cálculo del
dígito verificador para usar en consultas.

## Documentación

Todas las decisiones de diseño, con el dato que las justifica, están en
[`docs/DECISIONES.md`](docs/DECISIONES.md).
