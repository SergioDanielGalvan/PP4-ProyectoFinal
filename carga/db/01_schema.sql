-- =====================================================================
--  COMEX ARCA/AFIP - IMPORTACIÓN  (v4: nombres alineados con Estadisticas.mdb)
--  Caratula (1 por destinación) -> Item (n) -> Liq (n por ítem)
--  Los porqué de cada decisión están en docs/DECISIONES.md.
--
--  Tablas en minúsculas (portables entre Windows, Linux y TiDB);
--  columnas con los mismos nombres que el modelo Access.
--  Particiones: sólo pmax al crear; la carga mensual crea la del mes.
--  Probado en MariaDB 10 (XAMPP) y MySQL 8. Compatible con TiDB (sin
--  procedimientos ni FOREIGN KEY). Collation utf8mb4_unicode_ci: existe en
--  MariaDB y en MySQL (utf8mb4_0900_ai_ci es sólo de MySQL 8).
-- =====================================================================

CREATE DATABASE IF NOT EXISTS comex
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
SET NAMES utf8mb4;
USE comex;

-- ---------------------------------------------------------------------
-- 1. STAGING: réplica del .LST en el orden real del archivo
-- ---------------------------------------------------------------------
CREATE TABLE stg_impo (
  Aduana            VARCHAR(4)   CHARACTER SET ascii,
  NroAduana         VARCHAR(16)  CHARACTER SET ascii,
  Item              VARCHAR(10)  CHARACTER SET ascii,
  Periodo           VARCHAR(6)   CHARACTER SET ascii,
  NombreImportador  VARCHAR(30),
  Via               VARCHAR(1)   CHARACTER SET ascii,
  UnidadMedida      VARCHAR(2)   CHARACTER SET ascii,
  CantidadUnidades  VARCHAR(18)  CHARACTER SET ascii,
  FobTotalDolares            VARCHAR(16)  CHARACTER SET ascii,
  FobTotalDivisas          VARCHAR(16)  CHARACTER SET ascii,
  DivisaFOB            VARCHAR(3)   CHARACTER SET ascii,
  PaisOrigen        VARCHAR(3)   CHARACTER SET ascii,
  PaisProcedencia   VARCHAR(3)   CHARACTER SET ascii,
  PosicionSIM       VARCHAR(10)  CHARACTER SET ascii,
  Codigo            VARCHAR(3)   CHARACTER SET ascii,
  Monto             VARCHAR(16)  CHARACTER SET ascii
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. TABLAS DEL KIT: mismas columnas que Kit.mdb, un registro por código.
--    Se llenan con `npm run kit` (desde Access) o con 02_tablas_sim_kit.sql.
-- ---------------------------------------------------------------------
CREATE TABLE aduanas (
  Codigo  CHAR(3) CHARACTER SET ascii PRIMARY KEY,
  Descrip VARCHAR(30),
  Vias    VARCHAR(5)
) ENGINE=InnoDB;

CREATE TABLE paises (
  Codigo    CHAR(3) CHARACTER SET ascii PRIMARY KEY,
  Descrip   VARCHAR(50),
  IsoAlfa2  CHAR(2) CHARACTER SET ascii          -- opcional, para cruzar con OMC/ONU
) ENGINE=InnoDB;

CREATE TABLE via (
  Codigo     CHAR(1) CHARACTER SET ascii PRIMARY KEY,
  Descrip    VARCHAR(30),
  Aclaracion VARCHAR(60)
) ENGINE=InnoDB;

CREATE TABLE unidadesmedida (
  Codigo      CHAR(2) CHARACTER SET ascii PRIMARY KEY,
  Descrip     VARCHAR(30),
  Abreviatura VARCHAR(5)
) ENGINE=InnoDB;

CREATE TABLE tasas (
  Codigo        CHAR(3) CHARACTER SET ascii PRIMARY KEY,
  Descrip       VARCHAR(30),
  ImpoExpo      CHAR(1) CHARACTER SET ascii,
  PagaGarantiza CHAR(1) CHARACTER SET ascii
) ENGINE=InnoDB;

CREATE TABLE divisas (
  Codigo      CHAR(3) CHARACTER SET ascii PRIMARY KEY,
  Descrip     VARCHAR(30),
  Abreviatura VARCHAR(5)
) ENGINE=InnoDB;

CREATE TABLE destinaciones (
  Codigo   CHAR(4) CHARACTER SET ascii PRIMARY KEY,
  Descrip  VARCHAR(60),
  ImpoExpo CHAR(1) CHARACTER SET ascii
) ENGINE=InnoDB;

-- POSICION a nivel subpartida (PosicionSIM de 10: 7306.90.90), con los
-- porcentajes de importación del KIT. IdPosicion sólo achica item.
-- Extra/Intra = extrazona/intrazona Mercosur (explica derechos en cero).
CREATE TABLE posicion (
  IdPosicion                 SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  PosicionSIM                VARCHAR(10) CHARACTER SET ascii NOT NULL UNIQUE,  -- VARCHAR: ver nota en caratula
  Capitulo                   CHAR(2)  CHARACTER SET ascii AS (LEFT(PosicionSIM, 2)) STORED,
  Partida                    CHAR(4)  CHARACTER SET ascii AS (LEFT(REPLACE(PosicionSIM, '.', ''), 4)) STORED,
  DescripcionNCM             TEXT,
  UnidadEstadistica          CHAR(2) CHARACTER SET ascii,
  PorcientoDerechoImpoExtra  DECIMAL(6,2),
  PorcientoDerechoImpoIntra  DECIMAL(6,2),
  PorcientoEstadisticaExtra  DECIMAL(6,2),
  PorcientoEstadisticaIntra  DECIMAL(6,2),
  PorcientoAEC               DECIMAL(6,2),
  PorcientoIVA               DECIMAL(6,2),
  PorcientoIvaAdicional      DECIMAL(6,2),
  PorcientoImpuestosInternos DECIMAL(6,2),
  MarcaExencionIva           CHAR(1) CHARACTER SET ascii,
  FechaActualizacion         DATE,
  KEY ix_capitulo (Capitulo),
  KEY ix_partida  (Partida)
) ENGINE=InnoDB;

-- Importadores: en Access NombreImportador va en Caratula; acá se normaliza
-- para no repetir 30 caracteres por destinación y poder unificar variantes.
CREATE TABLE importadores (
  IdImportador MEDIUMINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  Nombre       VARCHAR(30) NOT NULL UNIQUE,
  IdCanonico   MEDIUMINT UNSIGNED NULL,       -- NULL = es su propio canónico
  KEY ix_canonico (IdCanonico)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. HECHOS
-- ---------------------------------------------------------------------
CREATE TABLE caratula (
  Periodo              MEDIUMINT UNSIGNED NOT NULL,          -- AAAAMM
  IdOperacion           INT UNSIGNED NOT NULL AUTO_INCREMENT, -- reemplaza a NroAduana en item y liq
  -- VARCHAR y no CHAR: MariaDB no permite columnas generadas sobre un CHAR,
  -- porque su resultado depende del modo SQL PAD_CHAR_TO_FULL_LENGTH.
  NroAduana            VARCHAR(16) CHARACTER SET ascii NOT NULL,
  AnioRegistro         CHAR(2)  CHARACTER SET ascii AS (SUBSTRING(NroAduana, 1, 2)) STORED,
  Destinacion          CHAR(4)  CHARACTER SET ascii AS (SUBSTRING(NroAduana, 6, 4)) STORED,
  AduanaOficializacion CHAR(3)  CHARACTER SET ascii AS (SUBSTRING(NroAduana, 3, 3)) STORED,
  IdImportador         MEDIUMINT UNSIGNED NOT NULL,
  PaisProcedencia      CHAR(3)  CHARACTER SET ascii,
  Via                  CHAR(1)  CHARACTER SET ascii,         -- NULL en IC06
  DivisaFOB               CHAR(3)  CHARACTER SET ascii,
  FobTotalDivisas             DECIMAL(13,2),                        -- en la DivisaFOB, no en USD
  PRIMARY KEY (IdOperacion, Periodo),
  UNIQUE KEY ux_nroaduana (NroAduana, Periodo),
  KEY ix_importador (IdImportador, Periodo),
  KEY ix_destinacion (Destinacion, Periodo)
) ENGINE=InnoDB
PARTITION BY RANGE (Periodo) (PARTITION pmax VALUES LESS THAN MAXVALUE);

CREATE TABLE item (
  Periodo          MEDIUMINT UNSIGNED NOT NULL,
  IdOperacion       INT UNSIGNED NOT NULL,
  Item             SMALLINT UNSIGNED NOT NULL,
  IdPosicion       SMALLINT UNSIGNED NOT NULL,
  PaisOrigen       CHAR(3) CHARACTER SET ascii,
  -- Procedencia tal como viene en la línea del archivo. Debería ser igual en
  -- todo el despacho; en algunos despachos ARCA trae valores distintos por
  -- ítem. caratula.PaisProcedencia guarda una sola (ver DECISIONES).
  PaisProcedencia  CHAR(3) CHARACTER SET ascii,
  UnidadMedida     CHAR(2) CHARACTER SET ascii,
  CantidadUnidades DECIMAL(15,3),
  FobTotalDolares           DECIMAL(13,2),
  ValorUnitario    DECIMAL(18,6) AS (ROUND(FobTotalDolares / NULLIF(CantidadUnidades, 0), 6)) VIRTUAL,
  PRIMARY KEY (IdOperacion, Item, Periodo),
  KEY ix_posicion_origen (IdPosicion, PaisOrigen, Periodo)
) ENGINE=InnoDB
PARTITION BY RANGE (Periodo) (PARTITION pmax VALUES LESS THAN MAXVALUE);

CREATE TABLE liq (
  Periodo     MEDIUMINT UNSIGNED NOT NULL,
  IdOperacion  INT UNSIGNED NOT NULL,
  Item        SMALLINT UNSIGNED NOT NULL,
  Codigo      CHAR(3) CHARACTER SET ascii NOT NULL,          -- tasas.Codigo
  Monto       DECIMAL(11,2),                                 -- en USD; los ceros no vienen
  PRIMARY KEY (IdOperacion, Item, Codigo, Periodo)
) ENGINE=InnoDB
PARTITION BY RANGE (Periodo) (PARTITION pmax VALUES LESS THAN MAXVALUE);
