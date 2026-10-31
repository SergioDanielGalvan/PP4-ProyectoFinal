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
`07_usuarios.sql` y `08_auditoria.sql`), nunca la de producción: crean usuarios
temporales con el prefijo `test_` y, al terminar, borran esos usuarios y lo
que registraron en la auditoría. Sin `DB_USER` o `JWT_SECRET` en el
`.env`, se saltean en lugar de fallar.

Evidencia de la última ejecución: [`salida-npm-test.txt`](salida-npm-test.txt)
y [`salida-npm-test.png`](salida-npm-test.png) — 39 pruebas (20 unitarias y 19 de integración), 39 correctas.

## Pruebas unitarias (`api/test/unit/`)

Funciones puras, sin base de datos.

| Archivo | Qué se prueba | Resultado esperado | Obtenido |
|---|---|---|---|
| `nroAduana.test.js` | Dígito verificador del número de despacho (traducción de la rutina VB6 del SIM) | Para 4 despachos reales de ARCA (09/2026), la letra calculada es la que trae el archivo; completa la letra si falta; rechaza letra equivocada indicando la correcta; rechaza año, aduana o número mal formados | ✔ 4 de 4 |
| `ncm.test.js` | Validación de partida, subpartida y NCM, y armado de rangos | Acepta 4, 6 u 8 dígitos con o sin puntos; rechaza 3, 5, 7 o 9 dígitos con error 400; `84` da el rango 84000000–84999999; rechaza rango invertido | ✔ 4 de 4 |
| `sqlLibre.test.js` | Control del SQL libre (sólo admin) | Deja pasar SELECT, WITH, SHOW y EXPLAIN; frena DELETE, UPDATE, DROP e INSERT, dos sentencias juntas (aun escondidas detrás de un comentario), la tabla `usuarios`, SLEEP, LOAD_FILE e INTO OUTFILE | ✔ 5 de 5 |
| `auditoria.test.js` | Auditoría: clasificación de cada pedido y armado del detalle | Cada ruta y método da su acción (ingreso, ingreso fallido o bloqueado, alta, cambio o baja de usuario, SQL libre, consulta); los parámetros `clave`, `token` o `password` nunca se guardan; el usuario escrito en un login fallido se guarda en ascii y hasta 40 caracteres; los filtros de la consulta rechazan acciones inexistentes, fechas mal escritas y rangos invertidos | ✔ 4 de 4 |
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

### 3. Auditoría de actividad (`auditoria.test.js`)

Hace pedidos reales a la API y verifica en la tabla `auditoria` qué quedó registrado.

| Paso | Esperado | Obtenido |
|---|---|---|
| Ingreso correcto y uno con clave equivocada | Quedan `login` y `login_fallido` (401) para ese usuario; la clave escrita no aparece en ningún registro | ✔ |
| Consulta de últimos despachos y una sugerencia del autocompletado | La consulta queda con sus parámetros (`tamanio=3`) y la cantidad de filas devueltas; el autocompletado no se registra | ✔ |
| Alta, cambio de rol y clave, y baja de un usuario | `alta_usuario` con usuario, nombre y rol; `modif_usuario` con "rol consulta → admin, clave cambiada"; `baja_usuario` con el usuario; ninguna clave en los registros | ✔ |
| Ver la actividad | Sin token, 401; como admin, el filtro por usuario y acción devuelve sólo el ingreso fallido; el resumen cuenta 1 ingreso fallido y 3 cambios de usuarios; una acción inexistente da 400 | ✔ |

### 4. Cambio de la clave propia (`clave.test.js`)

| Paso | Esperado | Obtenido |
|---|---|---|
| Cambiar la clave sin sesión | 401 | ✔ |
| Clave actual equivocada; nueva de 5 caracteres; nueva igual a la actual | 400 con su mensaje; el hash en la base no cambia | ✔ |
| Clave actual correcta | 200 con un token nuevo; la base tiene el hash de la clave nueva; la vieja da 401 y la nueva permite ingresar | ✔ |
| Usar el token de una sesión abierta antes del cambio | 401 "La clave cambió…"; el token nuevo sigue funcionando y la respuesta no muestra la huella de la clave | ✔ |
| Un administrador le cambia la clave | La sesión abierta del usuario deja de valer; ingresa con la clave nueva | ✔ |

### Control de que las pruebas detectan errores

Se modificó a propósito la API para que permita borrar usuarios que ya
ingresaron: la prueba "DELETE: un usuario que ya ingresó no se elimina" falló
(1 de 10). Con el código correcto vuelve a pasar.

Lo mismo con la auditoría: se modificó el middleware para que guardara el
cuerpo de los pedidos de usuarios (donde viaja la clave) y la prueba "registra
alta, cambio y baja de usuarios… (nunca la clave)" falló. Con el código
correcto vuelve a pasar.

Y con el cambio de clave: se quitó el control de la huella en el token, y las
dos pruebas de sesiones abiertas fallaron.

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

## Prueba desde la interfaz (pantalla Actividad)

| Paso | Esperado | Captura |
|---|---|---|
| Abrir la pestaña Actividad como administrador | Resumen por usuario (ingresos, consultas, ingresos fallidos en rojo, cambios de usuarios, SQL libre, errores, última actividad) y el detalle de los últimos 7 días, del más reciente al más viejo | [`a-01-actividad.png`](a-01-actividad.png) |
| Clic en un usuario del resumen | Sólo su actividad: qué pantalla usó, con qué filtros y cuántas filas obtuvo | [`a-02-profesor.png`](a-02-profesor.png) |
| Marcar "Sólo errores" | Ingresos fallidos, códigos incompletos, despachos inexistentes y permisos negados, con el mensaje que recibió el usuario | [`a-03-errores.png`](a-03-errores.png) |

## Prueba desde la interfaz (Mi clave)

Como usuario de consulta (`profesor`):

| Paso | Esperado | Captura |
|---|---|---|
| Botón **Mi clave**, arriba a la derecha | Formulario con clave actual, nueva y repetición | [`c-01-mi-clave.png`](c-01-mi-clave.png) |
| Nueva de 5 caracteres y repetición distinta | Los dos campos en rojo con su mensaje; no se envía | [`c-02-validacion.png`](c-02-validacion.png) |
| Clave actual equivocada | "La clave actual no es correcta." (lo responde la API) | [`c-03-actual-mal.png`](c-03-actual-mal.png) |
| Datos correctos | Aviso "Tu clave se cambió"; la sesión sigue y las consultas funcionan sin volver a ingresar | [`c-04-cambiada.png`](c-04-cambiada.png) |
