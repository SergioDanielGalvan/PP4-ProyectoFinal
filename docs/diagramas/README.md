# Diagramas · 2ª Etapa

Fuentes en Mermaid (`.mmd`). GitHub los dibuja en esta página; para editarlos, abrir el `.mmd` en [mermaid.live](https://mermaid.live) o en draw.io (Organizar → Insertar → Avanzado → Mermaid). Las imágenes están en `img/` y el anexo completo en `Diagramas-PP4-Etapa2.pdf`.

## 01. Entidad-relación

Fuente: [`01-entidad-relacion.mmd`](01-entidad-relacion.mmd)

```mermaid
erDiagram
    CARATULA ||--|{ ITEM : "tiene"
    ITEM ||--o{ LIQ : "liquida"
    IMPORTADORES ||--o{ CARATULA : "importa"
    POSICION ||--o{ ITEM : "clasifica"
    CAPITULO ||--o{ POSICION : "agrupa"
    SECCION ||--|{ CAPITULO : "agrupa"
    DESTINACIONES ||--o{ CARATULA : "tipo de operacion"
    GRUPO_DESTINACION |o--|| DESTINACIONES : "agrupa (excepciones)"
    GRUPO ||--o{ GRUPO_DESTINACION : "contiene"
    ADUANAS ||--o{ CARATULA : "oficializa"
    PAISES ||--o{ ITEM : "origen / procedencia"
    DIVISAS ||--o{ CARATULA : "moneda FOB"
    VIA ||--o{ CARATULA : "medio de transporte"
    UNIDADESMEDIDA ||--o{ ITEM : "unidad"
    TASAS ||--o{ LIQ : "concepto"

    CARATULA {
        int IdOperacion PK
        mediumint Periodo PK "AAAAMM, particion"
        varchar NroAduana UK "16 car. con verificador"
        char Destinacion "derivado de NroAduana"
        char AduanaOficializacion "derivado de NroAduana"
        mediumint IdImportador FK
        char PaisProcedencia FK
        char Via FK
        char DivisaFOB FK
        decimal FobTotalDivisas
    }
    ITEM {
        int IdOperacion PK
        smallint Item PK
        mediumint Periodo PK
        smallint IdPosicion FK
        char PaisOrigen FK
        char PaisProcedencia FK
        char UnidadMedida FK
        decimal CantidadUnidades
        decimal FobTotalDolares
        decimal ValorUnitario "calculado"
    }
    LIQ {
        int IdOperacion PK
        smallint Item PK
        char Codigo PK
        mediumint Periodo PK
        decimal Monto "USD"
    }
    IMPORTADORES {
        mediumint IdImportador PK
        varchar Nombre UK
        mediumint IdCanonico
    }
    POSICION {
        smallint IdPosicion PK
        varchar PosicionSIM UK "NCM 8 digitos"
        char Capitulo "calculado"
        char Partida "calculado"
        text DescripcionNCM
        decimal PorcientoDerechoImpoExtra
        decimal PorcientoIVA
    }
    CAPITULO {
        char Codigo PK
        varchar Seccion FK
        varchar Descrip
    }
    SECCION {
        varchar Codigo PK "I a XXI"
        tinyint Numero
        varchar Descrip
    }
    GRUPO {
        varchar Codigo PK
        varchar Descrip
        tinyint PorDefecto
    }
    GRUPO_DESTINACION {
        char Destinacion PK
        varchar Grupo FK
    }
    DESTINACIONES {
        char Codigo PK
        varchar Descrip
    }
    ADUANAS {
        char Codigo PK
        varchar Descrip
    }
    PAISES {
        char Codigo PK
        varchar Descrip
    }
    DIVISAS {
        char Codigo PK
        varchar Descrip
    }
    VIA {
        char Codigo PK
        varchar Descrip
    }
    UNIDADESMEDIDA {
        char Codigo PK
        varchar Descrip
    }
    TASAS {
        char Codigo PK
        varchar Descrip
    }
    USUARIOS {
        int IdUsuario PK
        varchar Usuario UK
        varchar Nombre
        varchar ClaveHash "bcrypt"
        varchar Rol "admin | consulta"
        tinyint Activo
        datetime UltimoIngreso
    }
```

## 02. Casos de uso

Fuente: [`02-casos-de-uso.mmd`](02-casos-de-uso.mmd)

```mermaid
flowchart LR
    consulta(["👤 Usuario consulta<br/>(despachante, analista)"])
    admin(["👤 Administrador"])
    operador(["👤 Operador de datos"])
    arca(["🏛️ ARCA<br/>(sistema externo)"])

    subgraph sistema["Sistema de Estadísticas de Importación"]
        direction TB
        UC1(["Iniciar sesión"])
        UC2(["Consultar despacho"])
        UC3(["Resumen por subpartidas NCM"])
        UC4(["Comparar precios por NCM<br/>y detectar valores bajos"])
        UC5(["Buscar importadores"])
        UC6(["Ver triangulaciones"])
        UC7(["Ver matriz de importaciones<br/>(secciones y capítulos)"])
        UC8(["Ejecutar consulta predefinida"])
        UC9(["Cambiar clave"])
        UC10(["Administrar usuarios"])
        UC11(["Ejecutar SQL libre<br/>(solo lectura)"])
        UC12(["Cargar mes de ARCA"])
        UC13(["Validar datos del mes"])
        UC14(["Publicar mes en la nube"])
        UC15(["Actualizar KIT<br/>(tablas de referencia)"])
    end

    consulta --- UC1 & UC2 & UC3 & UC4 & UC5 & UC6 & UC7 & UC8 & UC9
    admin --- UC10 & UC11
    admin -. "hereda" .-> consulta
    operador --- UC12 & UC14 & UC15
    arca --- UC12
    UC12 -. "«include»" .-> UC13
    NOTA["Todos los casos de uso de consulta y de administración<br/>«incluyen» Iniciar sesión (token JWT válido)"]
    UC1 -.- NOTA
    style NOTA fill:#fff8dc,stroke:#b8a34a,stroke-dasharray: 4 3
```

## 03. Secuencia: inicio de sesión

Fuente: [`03-secuencia-login.mmd`](03-secuencia-login.mmd)

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuario
    participant F as Front (navegador)
    participant R as API · /api/auth
    participant C as auth.controller
    participant M as usuarios.model
    participant DB as TiDB Cloud

    U->>F: usuario y clave
    F->>R: POST /api/auth/login {usuario, clave}
    R->>C: login()
    C->>C: ¿5 fallos en 15 min? → 429
    C->>M: buscarParaLogin(usuario)
    M->>DB: SELECT ... FROM usuarios WHERE Usuario = ?
    DB-->>M: fila con ClaveHash, Rol, Activo
    M-->>C: usuario
    C->>C: bcrypt.compare(clave, ClaveHash)
    alt clave incorrecta o usuario inactivo
        C-->>F: 401 Usuario o clave incorrectos
    else correcta
        C->>M: registrarIngreso(id)
        M->>DB: UPDATE usuarios SET UltimoIngreso = NOW()
        C->>C: firmar JWT (HS256, 8 h, sub, rol)
        C-->>F: 200 {token, usuario}
        F->>F: guarda el token
    end

    Note over F,DB: Pedidos siguientes
    F->>R: GET /api/impo/matriz · Authorization: Bearer token
    R->>R: requireAuth: verificar firma y vencimiento
    R->>M: buscarPorId(sub) (caché 1 min)
    M->>DB: SELECT Rol, Activo
    alt token vencido, inválido o usuario desactivado
        R-->>F: 401 → el front vuelve a pedir login
    else válido
        R-->>F: 200 datos
    end
```

## 04. Secuencia: carga mensual

Fuente: [`04-secuencia-carga-mensual.mmd`](04-secuencia-carga-mensual.mmd)

```mermaid
sequenceDiagram
    autonumber
    actor O as Operador
    participant CM as cargar-mes.js
    participant L as lector-lst (ZIP)
    participant MDB as MariaDB local
    participant CT as copiar-a-tidb.js
    participant T as TiDB Cloud

    O->>CM: node cargar-mes.js impo_AAAAMM.zip
    CM->>MDB: controlar base y KIT
    CM->>L: abrir ZIP (lectura tolerante)
    loop lotes de 500.000 líneas
        L-->>CM: líneas limpias (sin encabezados ni relleno)
        CM->>MDB: LOAD DATA LOCAL INFILE → stg_impo
    end
    CM->>MDB: ¿un solo período y coincide con el nombre?
    alt no coincide
        CM-->>O: error, no se carga
    end
    CM->>MDB: validaciones (b … i)
    MDB-->>CM: ok / REVISAR por control
    CM->>MDB: importadores y posiciones nuevas
    CM->>MDB: preparar partición del período
    CM->>MDB: INSERT carátula, ítem, liq
    CM-->>O: informe impo_AAAAMM.md

    O->>CT: node copiar-a-tidb.js --periodos AAAAMM
    loop bloques de IdOperacion
        CT->>MDB: SELECT bloque
        CT->>T: INSERT IGNORE (lotes de 5.000, 3 en paralelo, TLS)
    end
    CT->>MDB: COUNT(*) por tabla
    CT->>T: COUNT(*) por tabla
    CT-->>O: control de cantidades: ok / diferencia
```

## 05. Actividades: proceso de carga

Fuente: [`05-actividades-carga.mmd`](05-actividades-carga.mmd)

```mermaid
flowchart TD
    A([Inicio]) --> B[Descargar ZIP mensual de ARCA]
    B --> D[Leer impo_AAAAMM.lst desde el ZIP]
    D --> E[Limpiar líneas:<br/>quitar encabezados y relleno]
    E --> F[Enviar a staging por lotes]
    F --> C{¿Un solo período y coincide<br/>con el nombre del archivo?}
    C -- No --> X1[Cancelar la carga] --> Z1([Fin])
    C -- Sí --> G[Validaciones: verificador del NroAduana,<br/>unicidad, FOB vs factura, códigos del KIT]
    G --> G2[Marcar en el informe cada control<br/>como ok o REVISAR]
    G2 --> H{¿Modo --validar?}
    H -- Sí --> X2[Informe del mes] --> Z2([Fin sin cargar])
    H -- No --> I[Alta de importadores y posiciones nuevas]
    I --> J[Crear o reemplazar partición del mes]
    J --> K[Cargar carátula, ítem y liquidación]
    K --> L[Informe del mes con validaciones y totales]
    L --> M{¿Se publica en la nube?}
    M -- No --> Z3([Fin: solo local])
    M -- Sí --> N{¿El mes ya estaba en TiDB<br/>con otra carga?}
    N -- Sí --> O[Borrar el mes en TiDB<br/>--reemplazar]
    N -- No --> P
    O --> P[Copiar por bloques a TiDB]
    P --> Q{¿Cantidades iguales<br/>MariaDB = TiDB?}
    Q -- No --> P
    Q -- Sí --> R([Fin: mes publicado])
```

## 06. Estados: usuario

Fuente: [`06-estados-usuario.mmd`](06-estados-usuario.mmd)

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Activo: alta por admin
    Activo --> Bloqueado: 5 claves erróneas
    Bloqueado --> Activo: pasan 15 min
    Activo --> Inactivo: admin desactiva
    Inactivo --> Activo: admin reactiva

    state Activo {
        direction LR
        [*] --> SinSesion
        SinSesion --> ConSesion: login OK (JWT)
        ConSesion --> SinSesion: vence (8 h) / salir
    }
    note right of Inactivo
        Los usuarios no se borran: se desactivan.
        Un token vigente deja de servir
        en menos de 1 minuto.
        Cambio o reseteo de clave: el usuario
        sigue Activo.
    end note
```

## 07. Estados: período

Fuente: [`07-estados-periodo.mmd`](07-estados-periodo.mmd)

```mermaid
stateDiagram-v2
    [*] --> Descargado: ZIP de ARCA
    Descargado --> EnStaging: lectura por lotes
    EnStaging --> Rechazado: período no coincide
    Rechazado --> Descargado: archivo correcto
    EnStaging --> Validado: controles en el informe
    Validado --> CargadoLocal: carga en MariaDB
    CargadoLocal --> Publicado: copiar-a-tidb
    Publicado --> Desactualizado: recarga en MariaDB
    Desactualizado --> Publicado: copiar --reemplazar
    Publicado --> [*]
    note right of Validado
        Los controles marcan ok o REVISAR
        y no frenan la carga.
    end note
    note right of CargadoLocal
        Recargar el mes reemplaza
        su partición completa.
    end note
```

## 08. Componentes

Fuente: [`08-componentes.mmd`](08-componentes.mmd)

```mermaid
flowchart TB
    subgraph FRONT["Front (navegador)"]
        HTML["impo.html + impo.js<br/>(pestañas, matriz, login)"]
        CHART["Chart.js"]
        HTML --> CHART
    end

    subgraph API["API REST · Node.js + Express"]
        APP["app.js"]
        subgraph RUT["Rutas"]
            R1["/api/auth"]
            R2["/api/impo"]
            R3["/api/consultas"]
        end
        subgraph MW["Middlewares"]
            AUTH["auth.js<br/>(JWT, roles)"]
            ERR["errors.js"]
        end
        subgraph CTRL["Controladores"]
            C1["auth.controller"]
            C2["impo.controller"]
            C3["consultas.controller"]
        end
        subgraph MOD["Modelos"]
            M1["usuarios.model"]
            M2["impo.model<br/>(caché de matriz)"]
            M3["consultas.model"]
        end
        SQLS[("consultas/*.sql<br/>guardadas")]
        POOL["config/db.js<br/>pool mysql2 + TLS"]
        APP --> RUT
        R1 & R2 & R3 --> AUTH
        R1 --> C1 --> M1
        R2 --> C2 --> M2
        R3 --> C3 --> M3 --> SQLS
        M1 & M2 & M3 --> POOL
        APP --> ERR
    end

    subgraph CARGA["Carga de datos · Node.js"]
        K1["crear-base.js"]
        K2["importar-kit.js<br/>(Kit.mdb)"]
        K3["cargar-mes.js"]
        K4["copiar-a-tidb.js"]
        LIB["lib: lector-lst,<br/>pasos-mes, conexion"]
        K3 --> LIB
    end

    LOCAL[("MariaDB local<br/>base de trabajo")]
    NUBE[("TiDB Cloud<br/>base de consulta")]
    ZIP[/"ZIP mensual ARCA"/]
    MDBK[/"Kit.mdb"/]

    HTML -- "HTTPS + JSON<br/>Bearer JWT" --> APP
    POOL -- "MySQL/TLS :4000" --> NUBE
    ZIP --> K3
    MDBK --> K2
    K1 & K2 & K3 --> LOCAL
    K4 -- "lee" --> LOCAL
    K4 -- "escribe" --> NUBE
```

## 09. Despliegue

Fuente: [`09-despliegue.mmd`](09-despliegue.mmd)

```mermaid
flowchart LR
    subgraph CLIENTE["Dispositivo del usuario"]
        NAV["Navegador web"]
    end

    subgraph RENDER["Render · Web Service Free<br/>Virginia (US East)"]
        NODE["Node.js 18+<br/>API Express + front estático"]
    end

    subgraph TIDB["TiDB Cloud Starter<br/>AWS us-east-1"]
        BD[("Base comex<br/>3 meses · 2,3 GB")]
    end

    subgraph GH["GitHub"]
        REPO["PP4-ProyectoFinal"]
    end

    subgraph LAN["Red local (oficina)"]
        subgraph M3["PC-MULETO3 · servidor"]
            XAMPP[("MariaDB 10.4 (XAMPP)<br/>base de trabajo · 1,6 GB")]
            CARGA["Scripts de carga<br/>Node.js"]
        end
        subgraph M2["PC-MULETO2 · desarrollo"]
            DEV["VS Code<br/>API local :3000"]
        end
    end

    ARCA[("ARCA<br/>información agregada")]

    NAV -- "HTTPS 443" --> NODE
    NODE -- "MySQL + TLS :4000" --> BD
    REPO -- "deploy automático<br/>en cada push" --> NODE
    DEV -- "git push" --> REPO
    DEV -- "MySQL :3306" --> XAMPP
    ARCA -- "descarga ZIP<br/>mensual" --> CARGA
    CARGA --> XAMPP
    CARGA -- "copiar-a-tidb<br/>TLS :4000" --> BD
```

## 10. Clases: dominio

Fuente: [`10-clases-dominio.mmd`](10-clases-dominio.mmd)

```mermaid
classDiagram
    direction LR
    class Despacho {
        +int idOperacion
        +int periodo
        +string nroAduana
        +string destinacion
        +string aduana
        +string paisProcedencia
        +string divisaFOB
        +decimal fobTotalDivisas
        +digitoVerificador() char
        +esValido() bool
        +items() Item[]
    }
    class Item {
        +int numero
        +string paisOrigen
        +string unidadMedida
        +decimal cantidad
        +decimal fobDolares
        +valorUnitario() decimal
        +esTriangulacion() bool
    }
    class Liquidacion {
        +string concepto
        +decimal montoUSD
    }
    class Importador {
        +int id
        +string nombre
        +int idCanonico
    }
    class PosicionNCM {
        +string ncm
        +string capitulo
        +string partida
        +string descripcion
        +decimal derechoImpo
    }
    class Capitulo {
        +string codigo
        +string descripcion
    }
    class Seccion {
        +string codigo
        +string descripcion
    }
    class Destinacion {
        +string codigo
        +string descripcion
        +grupo() GrupoOperacion
    }
    class GrupoOperacion {
        <<enumeration>>
        CONSUMO
        TEMP
        ZF
        REDES
        AAE
    }
    class Usuario {
        +int id
        +string usuario
        +string nombre
        +Rol rol
        +bool activo
        +verificarClave(clave) bool
        +cambiarClave(actual, nueva)
    }
    class Rol {
        <<enumeration>>
        admin
        consulta
    }
    class ConsultaGuardada {
        +string nombre
        +string titulo
        +Parametro[] parametros
        +ejecutar(valores) Resultado
    }

    Importador "1" --> "*" Despacho : importa
    Despacho "1" *-- "1..*" Item : contiene
    Item "1" *-- "*" Liquidacion : liquida
    Item "*" --> "1" PosicionNCM : se clasifica en
    PosicionNCM "*" --> "1" Capitulo
    Capitulo "*" --> "1" Seccion
    Despacho "*" --> "1" Destinacion
    Destinacion ..> GrupoOperacion
    Usuario ..> Rol
    Usuario ..> ConsultaGuardada : ejecuta
```

## 11. Clases: API

Fuente: [`11-clases-api.mmd`](11-clases-api.mmd)

```mermaid
classDiagram
    direction TB
    class AuthMiddleware {
        +requireAuth(req, res, next)
        +requireLogin(req, res, next)
        +requireRol(...roles)
        +firmarToken(usuario) string
        -usuarioVigente(id) Usuario
    }
    class AuthController {
        +login(req, res)
        +yo(req, res)
        +cambiarClave(req, res)
        +listarUsuarios(req, res)
        +crearUsuario(req, res)
        +modificarUsuario(req, res)
        -controlarIntentos(clave)
    }
    class ImpoController {
        +periodos()
        +matriz()
        +listarDespachos()
        +obtenerDespacho()
        +resumenSubpartidas()
        +preciosPorNcm()
        +valoresBajos()
        +buscarImportadores()
        +triangulaciones()
    }
    class ConsultasController {
        +listar()
        +ejecutar()
        +sqlLibre()
    }
    class UsuariosModel {
        +buscarParaLogin(usuario)
        +buscarPorId(id)
        +listar()
        +crear(datos)
        +actualizar(id, cambios)
        +registrarIngreso(id)
    }
    class ImpoModel {
        -cachePeriodos
        -cacheMatriz
        +listarPeriodos()
        +matriz(nivel, seccion, grupos)
        +obtenerDespacho(nro)
        +listarDespachos(filtros)
        +resumenSubpartidas(rango)
    }
    class ConsultasModel {
        -LIMITE_FILAS = 5000
        -TIEMPO_MAX_SEG = 30
        +listarGuardadas()
        +ejecutarGuardada(nombre, valores)
        +ejecutarLibre(sql, limite)
        -validarSqlLibre(sql)
        -ejecutarAcotado(sql, params, limite)
    }
    class Pool {
        <<mysql2>>
        +query(sql, params)
        +getConnection()
    }
    class HttpError {
        +int status
        +string message
    }

    AuthController --> UsuariosModel
    AuthController --> AuthMiddleware : firmarToken
    AuthMiddleware --> UsuariosModel
    ImpoController --> ImpoModel
    ConsultasController --> ConsultasModel
    UsuariosModel --> Pool
    ImpoModel --> Pool
    ConsultasModel --> Pool
    AuthController ..> HttpError
    ImpoController ..> HttpError
    ConsultasModel ..> HttpError
```
