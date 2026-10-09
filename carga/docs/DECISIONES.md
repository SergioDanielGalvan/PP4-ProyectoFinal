# Decisiones de diseño y sus porqué

Registro de las decisiones del proyecto de estadísticas de importación, con el
dato o la prueba que llevó a cada una. Aplica a los dos modelos: el de Access
(`Estadisticas.mdb`, para diseñar y probar con muestras) y el de MySQL (para el
volumen real y la API).

## 1. El archivo de ARCA no es el que describe su página

La página de ARCA lista 16 columnas, pero el `.LST` real trae otras 16.
Se verificó con la muestra de 202608 (497 líneas, 66 destinaciones).

| Col. | Según ARCA | En el archivo real | Cómo se comprobó |
|---|---|---|---|
| 4 | Fecha de oficialización | Periodo AAAAMM | Todas las líneas traen `202608` |
| 9 | FOB/CIF unitario | FOB **total del ítem**, en USD | 225 u × 29,10 = 6.547,39 |
| 10 | FOB/CIF total | FOB de la **destinación**, en la divisa de la factura | En facturas en francos suizos, ítems en USD / total = 1,2332 (tipo de cambio) |
| 11 | País de origen | Divisa | `060` = EURO en el KIT |
| 12 | País de procedencia | País de origen | Varía dentro de una destinación en 5 casos |
| 13 | Posición declarada | País de procedencia | Nunca varía dentro de una destinación |
| 14 | Posición NCM | Posición NCM (8 dígitos) | `7306.90.90` |
| 15-16 | Concepto y monto en USD | Igual | |

**Consecuencias:** no hay fecha de oficialización (se guarda `Periodo`), no hay
posición SIM completa (sólo la subpartida NCM de 10 caracteres), y `FobTotalDivisas`
sólo se interpreta junto con `DivisaFOB`.

### Regla de control del FOB

Cuando `DivisaFOB = 'DOL'`: **Σ Item.FobTotalDolares = Caratula.FobTotalDivisas**.
Con la muestra de 202608 cuadra al centavo en 44 de las 50 destinaciones en
dólares con todos sus ítems (las 6 restantes tienen ítems finales que no
vinieron). Multiplicar por la cantidad no cuadra en ninguna (0 de 50), lo que
confirma que la columna 9 es el total del ítem y no el unitario. En otras
divisas, Σ FobTotalDolares / FobTotalDivisas es el tipo de cambio implícito.

## 2. Formato físico del archivo

Es un listado de mainframe: empieza con un salto de página (`\f`), trae
encabezado y línea de guiones (que pueden repetirse por página), termina en
CRLF y cada línea se rellena con espacios hasta ~700 caracteres.

**Por eso** los archivos pesan 5 a 10 GB aunque los datos útiles son mucho
menos. La carga (`carga/cargar-mes.js`) lee el `.lst` directamente del ZIP,
recorta cada campo en Node y descarta toda línea cuya aduana no sea de 3
dígitos (en vez de saltear un número fijo de líneas), así a MySQL sólo llegan
los datos. El ZIP del mes trae `impo_AAAAMM.lst`, `expo_agregado_AAAAMM.lst`
y `total_expo_agregado_AAAAMM.lst`; por ahora sólo se procesa el de
importación.

## 3. Tres tablas: Caratula, Item, Liq

Cada línea del archivo es ítem × concepto, y repite los datos de la destinación
y del ítem. Se separan en tres niveles para no repetirlos.

| Nivel | Qué guarda | Por qué ahí |
|---|---|---|
| `Caratula` | Aduana, importador, procedencia, vía, divisa, FOB total | Es único por destinación (validación b: 0 variantes) |
| `Item` | NCM, origen, unidad, cantidad, FOB USD | Único por destinación e ítem (validación d: 0 variantes) |
| `Liq` | Concepto (`Codigo` de TASAS) y monto | Varias líneas por ítem |

## 4. Montos en cero, ítems completos y procedencia

- Las líneas de liquidación con monto cero **no vienen** en el archivo (por
  ejemplo, jurisdicciones de IIBB cuyo coeficiente da cero). Un concepto
  ausente vale cero.
- El archivo completo **trae todos los ítems y todos los conceptos**
  (derechos, tasa de estadística, IVA, IVA adicional, Ganancias, IIBB por
  jurisdicción). Verificado con 26001IC04147748D de 202607: sus dos ítems
  suman 1.301,80, igual al FOB total. Los ítems y conceptos que faltaban en
  la primera muestra eran porque la muestra tenía líneas salteadas.

### Procedencia que varía dentro de un despacho

La procedencia sale del conocimiento de embarque y es única por despacho. Sin
embargo, en el archivo de ARCA hay despachos con más de un valor en esa
columna (al menos 50 por mes en 202607 y 202608). Verificado en el `.lst`
original, así que no lo introduce la carga. Ejemplo, 26001IC04147748D:
ítem 1 origen China, procedencia Hong Kong; ítem 2 origen y procedencia
China. Los pares suelen ser un país y un centro comercial o logístico (China /
Hong Kong, Austria / Liechtenstein, varios países europeos / Alemania).

El orden de las columnas no está invertido: dentro de un despacho, la columna
de origen varía en muchos despachos y la de procedencia en pocos (validación
c2 de cada carga; con las columnas invertidas, un despacho de 65 ítems
tendría 10 procedencias).

**Tratamiento:** `item.PaisProcedencia` guarda el valor de cada línea tal como
viene; `caratula.PaisProcedencia` guarda uno solo, el del ítem de mayor FOB.
La validación c lista los despachos afectados. **Pendiente:** confirmar en el
SIM, con un despacho propio que tenga el problema, qué dato es el que difiere;
si la regla de la carátula tiene que ser otra, se recalcula desde `item` sin
volver a cargar los archivos.

## 5. Tipos de datos

| Campo | Access | MySQL | Bytes | Por qué |
|---|---|---|---|---|
| `idOperacion` | Autonumérico (Entero largo) | `INT UNSIGNED` | 4 | Sobra para décadas de operaciones |
| `Periodo` | **Entero largo** | `MEDIUMINT UNSIGNED` | 4 / 3 | Entero (2 bytes) llega a 32.767 y 202608 no entra. Como número ordena y compara bien; en MySQL es la clave de partición |
| `Item` | Entero | `SMALLINT UNSIGNED` | 2 | Hasta 9.999 ítems; como texto "10" se ordena antes que "2" |
| `FobTotalDivisas`, `FobTotalDolares` | Moneda | `DECIMAL(13,2)` | 8 / 6 | Exactos al centavo, hasta 99.999 millones; la suma de control cuadra sin redondear |
| `Monto` | Moneda | `DECIMAL(11,2)` | 8 / 5 | Hay percepciones de centavos (Entero largo los perdía; el formato moneda no cambia el tipo). Hasta 999 millones por concepto e ítem. Es la tabla con más filas: cada byte son ~100 MB por año |
| `CantidadUnidades` | Doble | `DECIMAL(15,3)` | 8 / 8 | Puede tener decimales (kilos) |
| Valor unitario | En consulta | `DECIMAL(18,6)` VIRTUAL | 0 | Se calcula al leer; 6 decimales para productos de fracciones de centavo |
| Códigos (`Codigo`, países, aduana, divisa, vía, unidad) | Texto | `CHAR(n)` ascii | n | Tienen ceros a la izquierda (`010`, `07`) o letras (`DOL`, `IC04`) |

**Por qué no Doble para importes:** guarda los decimales en binario y 0,10
no es exacto; al sumar miles de montos aparecen diferencias como
4.409,9999999. Moneda ocupa lo mismo que Doble en Access. El tipo Decimal de
Access se evita por sus problemas al ordenar y en algunas funciones.

## 5b. Datos que se derivan del número de destinación

`NroAduana` tiene la forma AA AAA TTTT NNNNNN D (`26001IC04151676V`):

| Posiciones | Dato | Ejemplo |
|---|---|---|
| 1-2 | Año de registro | `26` |
| 3-5 | Aduana | `001` |
| 6-9 | Destinación (subrégimen) | `IC04` |
| 10-15 | Número | `151676` |
| 16 | Verificador | `V` |

Aduana y destinación no se guardan aparte: se calculan con `Mid(NroAduana, 3, 3)`
y `Mid(NroAduana, 6, 4)` en Access, y como columnas generadas en MySQL. En la
muestra coinciden con la columna 1 del archivo en las 66 destinaciones; la
carga lo vuelve a validar (b2). En Access, las relaciones con `ADUANAS` y
`DESTINACIONES` se hacen en las consultas, porque no se puede relacionar ni
indexar un campo calculado.

### Dígito verificador (posición 16)

Se calcula con la fórmula de `NroAduana_Valido` (Rutinas.bas, VB6): suma de
los códigos ASCII de los 15 primeros caracteres, módulo 23, más 65 (letra A
a W). En exportación ('MANE' desde la posición 5, que se calcula como
'MANI') se suma 1. I, O y Q se reemplazan por X, Y y Z para no confundirlas
con 1, 0 y la O; el desborde (91) vuelve a A.

Verificada con las 66 destinaciones reales de la muestra (66 de 66) y con el
ejemplo `09073IT15000029M`. Está implementada en:

- MySQL: función `verificador_nro()` en la carga, validación b3.
- API: `src/utils/nroAduana.js`. Acepta el número con o sin la letra; si la
  letra no corresponde, avisa cuál es la correcta.
- Access: `access/NroAduana.bas` (`NroAduanaValido` se puede usar en consultas).

`NroAduana` se guarda completo igual: es como figura en el SIM y en los
documentos, y la letra ocupa un solo byte.

**Exportación:** las destinaciones de exportación usan la misma fórmula sin
el +1. Verificado con `23001EC01051631B`, `23001EC01051785L` y
`24001EC03001005R` (las tres dan la letra correcta; con +1, ninguna). La
rama 'MANE' corresponde a otro tipo de número (manifiestos), no a
destinaciones, así que no afecta a este proyecto; se conserva tal cual para
dar el mismo resultado que el sistema original.

**Periodo:** en Access se guarda sólo el mes y el año sale de las posiciones
1-2. Supuesto a confirmar con el archivo de enero: que el año de registro
coincida siempre con el año del periodo. Una destinación registrada en
diciembre que aparezca en el archivo de enero quedaría con el año anterior.
La validación b2 de la carga lo controla. En MySQL `Periodo` sigue completo
(AAAAMM) porque es la clave de partición de las tres tablas.

## 6. idOperacion en lugar de NroAduana en Item y Liq

`NroAduana` ocupa 16 bytes y un entero 4. En `Item` y `Liq` se ahorran 12
bytes por fila, más lo que arrastran los índices.

| Volumen | Ahorro en MySQL |
|---|---|
| Demo (1-2 meses) | ~100-150 MB: irrelevante |
| Un año | 1 a 1,7 GB, cerca de 20-25 % de `Liq` |

**Decisión:** los dos modelos usan `idOperacion` (autonumérico en `Caratula`)
como vínculo con `Item` y `Liq`. En Access lo que limita es el tope de
**2 GB por .mdb**: un mes completo de `Liq` (5-10 M de filas) lo alcanza, así
que Access sirve para diseñar y probar con muestras, no para el volumen real.

Al dejar de ser clave, `NroAduana` necesita su propio **índice único** en
`Caratula`: sin él se puede cargar dos veces la misma destinación, y buscar
por número recorre toda la tabla. En MySQL el índice único es
`(NroAduana, Periodo)` porque la tabla está particionada por periodo.

Las claves primarias empiezan por `idOperacion` (`Item`: idOperacion, Item;
`Liq`: idOperacion, Item, Codigo) para que el mismo índice sirva al join.
`Item` es numérico: como texto, "10" se ordena antes que "2".

## 7. Nombres

- Columnas con los **mismos nombres en Access y en MySQL** (`NroAduana`,
  `FobTotalDivisas`, `PaisOrigen`, `Codigo`, `Monto`...), para que el modelo se
  explique una sola vez.
- Importes con nombre que dice qué son y en qué moneda: `Caratula.FobTotalDivisas`
  (FOB de la destinación en la divisa de la factura), `Caratula.DivisaFOB` y
  `Item.FobTotalDolares` (FOB **total** del ítem en USD; el archivo no trae
  unitario). `FechaOficializacion` → `Periodo`.
- `PosicionSIM` conserva el nombre del KIT pero con **10 caracteres**: guarda
  la subpartida NCM (`7306.90.90`), que es lo que trae el archivo.
- En MySQL las **tablas van en minúsculas** (`caratula`, `item`, `liq`,
  `paises`...): MySQL en Linux distingue mayúsculas en nombres de tabla y en
  Windows no, así que un dump con `Caratula` puede fallar al pasar de un
  sistema al otro o a TiDB.
- La API conserva sus propios nombres en el JSON (`nro_destinacion`,
  `fob_usd`...) mediante alias en el SQL. Así el front no cambia cuando cambia
  el nombre de una columna.

## 8. Relaciones

- **Caratula → Item → Liq: uno a varios.** En el primer diseño estaban como
  uno a uno, y por eso Access había creado índices únicos sobre `NroAduana` en
  `Item` y `Liq` (sólo admitían un ítem y una línea por destinación).
  `Item → Liq` se relaciona por **(idOperacion, Item)**: sólo con
  `idOperacion` una línea de liquidación no sabe a qué ítem pertenece. En
  Access se exige integridad con actualización y borrado en cascada: borrar
  una carátula borra sus ítems y su liquidación.
- **Tablas del KIT → hechos:** el lado "uno" es la tabla del KIT (estaban
  invertidas: Access las guardaba como si `Caratula` fuera la tabla principal
  de `VIA`, `PAISES`, etc.). Van sin integridad porque Access no puede exigirla con tablas
  vinculadas de otro .mdb.
- **MySQL no usa FOREIGN KEY:** las tablas particionadas de InnoDB no las
  admiten y TiDB tampoco las necesita. La integridad la controla la carga
  (validación h: códigos que no están en el KIT).

## 9. KIT: un registro por código

Las tablas del KIT original guardan historia (varias filas por código con
`FechaInicio`/`FechaFin`). Se toma la de `FechaInicio` más reciente, así
`Codigo` puede ser clave primaria. El SIM guarda la Ñ como `#` en países y
aduanas (`ESPA#A`); se corrige al generar.

`POSICION` se reduce a nivel subpartida: `PosicionSIM` de 10 caracteres
(los primeros 10 de la posición SIM original) con su `DescripcionNCM`
(10.503 subpartidas). En MySQL es la tabla `posicion`, con `IdPosicion`
para achicar `item`.

**Cuidado al reducir:** una subpartida puede tener varias aperturas SIM con
porcentajes distintos (derecho, tasa de estadística, IVA). Antes de quedarse
con una fila por subpartida, conviene ver cuáles difieren:

```sql
SELECT Left(PosicionSIM, 10) AS Subpartida, Count(*) AS Aperturas
FROM POSICION
GROUP BY Left(PosicionSIM, 10)
HAVING Max(PorcientoDerechoImpoExtra) <> Min(PorcientoDerechoImpoExtra)
    OR Max(PorcientoIVA) <> Min(PorcientoIVA)
    OR Max(PorcientoEstadisticaExtra) <> Min(PorcientoEstadisticaExtra);
```

(sobre la tabla POSICION completa, con la posición SIM de 16). En esas
subpartidas los porcentajes de la fila elegida no valen para todos los ítems.

## 10. Importadores en tabla aparte (sólo MySQL)

El nombre viene truncado a 30 caracteres y sin CUIT. En MySQL va en
`importadores` para no repetir 30 bytes por destinación y para poder unificar
variantes de una misma empresa con `IdCanonico` sin tocar los hechos. La
collation `utf8mb4_0900_ai_ci` ya unifica mayúsculas y acentos.
Limitación: dos empresas con los mismos 30 primeros caracteres quedan juntas.

## 11. Particiones por Periodo (sólo MySQL)

Cada mes es una partición. Recargar un mes es vaciar su partición
(`TRUNCATE PARTITION`) sin tocar el resto, y la carga la crea sola leyendo el
periodo del archivo. Los meses se pueden cargar en cualquier orden: la carga
busca la partición donde cae el mes y la divide (lo anterior, el mes y lo
posterior), así que agregar un mes viejo después de uno nuevo no da error.

## 12. Carga desde Node.js; demo en la nube

La carga es un programa Node (`npm run mes`) y no un script SQL para ejecutar
a mano: toma el ZIP tal como se baja de ARCA, no hay rutas que editar, valida
que el periodo del nombre coincida con el de los datos, y deja un informe por
mes. El KIT va aparte (`npm run kit`) porque cambia muy rara vez: las NCM casi
nunca se abren o cierran (las aperturas SIM sí, pero el archivo no las trae).

El procesamiento (staging, `GROUP BY` sobre millones de líneas) se hace en
MySQL local; a TiDB Cloud se sube sólo el resultado. Así el staging no ocupa
espacio en la nube ni consume la cuota mensual de Request Units.

## 13. Importación del KIT y usuarios

- `npm run kit` lee `Kit.mdb` con `mdb-reader` (JavaScript puro): funciona
  igual en Windows y Linux, sin Access, ODBC ni drivers de 32/64 bits.
- Hace `INSERT ... ON DUPLICATE KEY UPDATE` y **nunca borra**: un código que
  desaparece del KIT puede seguir usado en meses ya cargados. En `posicion`
  se conserva `IdPosicion`, que es lo que referencia `item`.
- La tabla `posicion` incluye los porcentajes de importación del KIT
  (derecho y tasa de estadística extra/intrazona, AEC, IVA, IVA adicional,
  impuestos internos): permiten explicar por qué un ítem no trae derechos
  (origen Mercosur, exenciones) y comparar lo liquidado contra lo esperado.
- Dos usuarios: `comex_admin` crea, carga e importa; `comex_api` sólo lee.
  La API se conecta con el de lectura, así una falla en la API no puede
  modificar ni borrar datos.

## 14. Servidor: MariaDB 10.4 (XAMPP)

El servidor del proyecto es MariaDB 10.4.32 (XAMPP), no MySQL 8. Todo se
probó en MariaDB y en MySQL 8; las diferencias que obligaron a cambios:

- **Collation `utf8mb4_unicode_ci`**: `utf8mb4_0900_ai_ci` es sólo de MySQL 8.
- **`NroAduana` y `PosicionSIM` son VARCHAR**: MariaDB no permite columnas
  generadas (aduana, destinación, año, capítulo) sobre un CHAR, porque el
  resultado depende del modo SQL `PAD_CHAR_TO_FULL_LENGTH`. Cuesta 1 byte por
  fila, sólo en `caratula` y `posicion`.
- **`verificador_nro` devuelve `CHAR(1) CHARACTER SET ascii`**: si no, MariaDB
  rechaza compararlo con `NroAduana` (ascii) por mezcla de collations.
- **La carga va en lotes**: un único `LOAD DATA` con el mes entero hizo que
  el servidor cortara la conexión a los 5 millones de líneas. Ahora se envía
  en lotes de 500.000 líneas (cada uno se confirma solo) y cada lote en
  paquetes de 64 KB, por debajo del `max_allowed_packet` de 1 MB que trae
  XAMPP. Probado con la configuración de fábrica de XAMPP (16 MB de buffer
  pool, logs de 5 MB). Los ZIP de ARCA traen 645 bytes sobrantes al final;
  el lector los ignora.
- **Sin `SET PERSIST`**: no existe en MariaDB. Tampoco hace falta: viene con
  `local_infile` activado y el log binario desactivado.

## 15. Datos que no van al repositorio

Los `.LST`, los `.zip` de ARCA y las bases `.mdb` con datos de clientes o
usuarios no se suben a GitHub (`.gitignore`).
