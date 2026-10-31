# Pruebas automatizadas

Se usa el ejecutor de pruebas que trae Node (`node:test`, sin instalar nada
más) y `supertest` para llamar a la API sin levantar el servidor. Para correr
las pruebas hace falta Node 22 o superior (la API en sí funciona desde Node 18).

```bash
cd api
npm install          # instala supertest (dependencia de desarrollo)
npm test             # unitarias + integración
npm run test:unit    # sólo unitarias: no necesitan base de datos
npm run test:integracion
```

Las de **integración** usan la base configurada en `api/.env`. Tiene que ser
una base **de desarrollo** (MariaDB local con `db/01_schema.sql`,
`02_tablas_sim_kit.sql`, `03_seed_demo.sql`, `06_matriz.sql` y
`07_usuarios.sql`), nunca la de producción: crean usuarios temporales con el
prefijo `test_` y los borran al terminar. Sin `DB_USER` o `JWT_SECRET` en el
`.env`, se saltean en lugar de fallar.

Evidencia de la última ejecución: [`salida-npm-test.txt`](salida-npm-test.txt)
y [`salida-npm-test.png`](salida-npm-test.png) — 26 pruebas, 26 correctas.

## Pruebas unitarias (`api/test/unit/`)

Funciones puras, sin base de datos.

| Archivo | Qué se prueba | Resultado esperado | Obtenido |
|---|---|---|---|
| `nroAduana.test.js` | Dígito verificador del número de despacho (traducción de la rutina VB6 del SIM) | Para 4 despachos reales de ARCA (09/2026), la letra calculada es la que trae el archivo; completa la letra si falta; rechaza letra equivocada indicando la correcta; rechaza año, aduana o número mal formados | ✔ 4 de 4 |
| `ncm.test.js` | Validación de partida, subpartida y NCM, y armado de rangos | Acepta 4, 6 u 8 dígitos con o sin puntos; rechaza 3, 5, 7 o 9 dígitos con error 400; `84` da el rango 84000000–84999999; rechaza rango invertido | ✔ 4 de 4 |
| `sqlLibre.test.js` | Control del SQL libre (sólo admin) | Deja pasar SELECT, WITH, SHOW y EXPLAIN; frena DELETE, UPDATE, DROP e INSERT, dos sentencias juntas (aun escondidas detrás de un comentario), la tabla `usuarios`, SLEEP, LOAD_FILE e INTO OUTFILE | ✔ 5 de 5 |
| `usuarios.test.js` | Validación de los datos de usuario | Pasa el usuario a minúsculas y rechaza menos de 3 caracteres o espacios; clave de 10 a 72 caracteres; sólo roles `admin` y `consulta` | ✔ 3 de 3 |

## Pruebas de integración (`api/test/integracion/`)

Recorren la API completa (rutas, middleware JWT, controlador, validaciones y
modelo) y verifican el resultado **directamente en la base** con SQL.

### 1. CRUD de usuarios (`usuarios.crud.test.js`)

| Paso | Esperado | Obtenido |
|---|---|---|
| Pedir la lista sin token | 401 | ✔ |
| **Create:** alta de `test_ana_…` como admin | 201; la fila está en `usuarios` con nombre, rol `consulta` y activo; la respuesta no incluye el hash de la clave | ✔ |
| Alta repetida y alta con nombre vacío | 409 "Ya existe…" y 400; no se guarda nada | ✔ |
| **Read:** lista de usuarios | Incluye el usuario creado | ✔ |
| **Update:** cambio de nombre y de clave | Nombre cambiado en la base; la clave vieja da 401 y la nueva permite ingresar y registra el ingreso; ese usuario (rol consulta) recibe 403 al pedir la lista | ✔ |
| **Delete** de un usuario que ya ingresó | 409 "…se desactiva"; al desactivarlo queda `Activo = 0` y ya no puede ingresar | ✔ |
| **Delete** de un usuario que nunca ingresó | 200; la fila desaparece de la base; borrarlo de nuevo da 404 | ✔ |

### 2. Precios contra la base (`precios.test.js`)

Toma la partida y el origen con más ítems cargados y compara lo que devuelve
`GET /api/impo/ncm/:partida/precios` con una suma hecha directo en SQL.

| Paso | Esperado | Obtenido |
|---|---|---|
| Partida completa | Cantidad de ítems y FOB total iguales a los de la base; `nivel = partida` | ✔ |
| Con filtro `origenes` | Sólo filas de ese origen; ítems y FOB iguales a la suma SQL filtrada | ✔ |
| Código de 5 dígitos | 400 con el mensaje "partida completa…" | ✔ |

### Control de que las pruebas detectan errores

Se modificó a propósito la API para que permita borrar usuarios que ya
ingresaron: la prueba "DELETE: un usuario que ya ingresó no se elimina" falló
(1 de 10). Con el código correcto vuelve a pasar.

## Prueba de integración desde la interfaz (pantalla Usuarios)

Recorrido hecho en el navegador sobre la misma base, como administrador:

| Paso | Esperado | Captura |
|---|---|---|
| Ingresar y abrir la pestaña Usuarios | Sólo aparece para administradores; lista con estado y último ingreso | [`u-01-lista.png`](u-01-lista.png) |
| Guardar el formulario vacío | Usuario, nombre y clave marcados en rojo con su mensaje | [`u-02-validacion.png`](u-02-validacion.png) |
| Alta con un usuario existente | "Ya existe el usuario viejo." (lo responde la API) | [`u-03-duplicado.png`](u-03-duplicado.png) |
| Alta correcta | Mensaje de confirmación y fila nueva | [`u-04-alta.png`](u-04-alta.png) |
| Modificar | El usuario no se puede cambiar; nombre y rol sí | [`u-05-editar.png`](u-05-editar.png) |
| Eliminar | Pide confirmación antes de borrar | [`u-06-confirmar.png`](u-06-confirmar.png) |
| Confirmar | La fila desaparece; "Eliminar" no se ofrece en usuarios que ya ingresaron ni en el propio | [`u-07-eliminado.png`](u-07-eliminado.png) |
