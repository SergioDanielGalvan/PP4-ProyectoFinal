-- =====================================================================
--  COMEX - copia de consulta en TiDB Cloud
--  Mismo modelo que 01_schema.sql, con estas diferencias (ver DECISIONES §17):
--   * sin stg_impo, sin procedimientos ni funciones: la carga mensual se hace
--     en MariaDB y a TiDB sólo llega el resultado (npm run tidb);
--   * sin AUTO_INCREMENT: los Id vienen de MariaDB y se copian tal cual;
--   * sin particiones: TiDB reparte los datos solo y con pocos meses no hacen falta;
--   * PRIMARY KEY ... CLUSTERED: las filas se guardan ordenadas por la clave
--     (en TiDB una clave compuesta no es clustered si no se pide).
--  Lo ejecuta `npm run tidb -- --esquema`; se puede repetir (IF NOT EXISTS).
-- =====================================================================

CREATE DATABASE IF NOT EXISTS comex CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE comex;

CREATE TABLE IF NOT EXISTS aduanas (
  Codigo  CHAR(3) CHARACTER SET ascii PRIMARY KEY,
  Descrip VARCHAR(30),
  Vias    VARCHAR(5)
);

CREATE TABLE IF NOT EXISTS paises (
  Codigo    CHAR(3) CHARACTER SET ascii PRIMARY KEY,
  Descrip   VARCHAR(50),
  IsoAlfa2  CHAR(2) CHARACTER SET ascii
);

CREATE TABLE IF NOT EXISTS via (
  Codigo     CHAR(1) CHARACTER SET ascii PRIMARY KEY,
  Descrip    VARCHAR(30),
  Aclaracion VARCHAR(60)
);

CREATE TABLE IF NOT EXISTS unidadesmedida (
  Codigo      CHAR(2) CHARACTER SET ascii PRIMARY KEY,
  Descrip     VARCHAR(30),
  Abreviatura VARCHAR(5)
);

CREATE TABLE IF NOT EXISTS tasas (
  Codigo        CHAR(3) CHARACTER SET ascii PRIMARY KEY,
  Descrip       VARCHAR(30),
  ImpoExpo      CHAR(1) CHARACTER SET ascii,
  PagaGarantiza CHAR(1) CHARACTER SET ascii
);

CREATE TABLE IF NOT EXISTS divisas (
  Codigo      CHAR(3) CHARACTER SET ascii PRIMARY KEY,
  Descrip     VARCHAR(30),
  Abreviatura VARCHAR(5)
);

CREATE TABLE IF NOT EXISTS destinaciones (
  Codigo   CHAR(4) CHARACTER SET ascii PRIMARY KEY,
  Descrip  VARCHAR(60),
  ImpoExpo CHAR(1) CHARACTER SET ascii
);

CREATE TABLE IF NOT EXISTS posicion (
  IdPosicion                 SMALLINT UNSIGNED PRIMARY KEY,
  PosicionSIM                VARCHAR(10) CHARACTER SET ascii NOT NULL UNIQUE,
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
);

CREATE TABLE IF NOT EXISTS importadores (
  IdImportador MEDIUMINT UNSIGNED PRIMARY KEY,
  Nombre       VARCHAR(30) NOT NULL UNIQUE,
  IdCanonico   MEDIUMINT UNSIGNED NULL,
  KEY ix_canonico (IdCanonico)
);

CREATE TABLE IF NOT EXISTS caratula (
  Periodo              MEDIUMINT UNSIGNED NOT NULL,
  IdOperacion          INT UNSIGNED NOT NULL,
  NroAduana            VARCHAR(16) CHARACTER SET ascii NOT NULL,
  AnioRegistro         CHAR(2)  CHARACTER SET ascii AS (SUBSTRING(NroAduana, 1, 2)) STORED,
  Destinacion          CHAR(4)  CHARACTER SET ascii AS (SUBSTRING(NroAduana, 6, 4)) STORED,
  AduanaOficializacion CHAR(3)  CHARACTER SET ascii AS (SUBSTRING(NroAduana, 3, 3)) STORED,
  IdImportador         MEDIUMINT UNSIGNED NOT NULL,
  PaisProcedencia      CHAR(3)  CHARACTER SET ascii,
  Via                  CHAR(1)  CHARACTER SET ascii,
  DivisaFOB            CHAR(3)  CHARACTER SET ascii,
  FobTotalDivisas      DECIMAL(13,2),
  PRIMARY KEY (IdOperacion, Periodo) CLUSTERED,
  UNIQUE KEY ux_nroaduana (NroAduana, Periodo),
  KEY ix_periodo (Periodo),
  KEY ix_importador (IdImportador, Periodo),
  KEY ix_destinacion (Destinacion, Periodo)
);

CREATE TABLE IF NOT EXISTS item (
  Periodo          MEDIUMINT UNSIGNED NOT NULL,
  IdOperacion      INT UNSIGNED NOT NULL,
  Item             SMALLINT UNSIGNED NOT NULL,
  IdPosicion       SMALLINT UNSIGNED NOT NULL,
  PaisOrigen       CHAR(3) CHARACTER SET ascii,
  PaisProcedencia  CHAR(3) CHARACTER SET ascii,
  UnidadMedida     CHAR(2) CHARACTER SET ascii,
  CantidadUnidades DECIMAL(15,3),
  FobTotalDolares  DECIMAL(13,2),
  ValorUnitario    DECIMAL(18,6) AS (FobTotalDolares / CantidadUnidades) VIRTUAL,
  PRIMARY KEY (IdOperacion, Item, Periodo) CLUSTERED,
  KEY ix_periodo (Periodo),
  KEY ix_posicion_origen (IdPosicion, PaisOrigen, Periodo)
);

CREATE TABLE IF NOT EXISTS liq (
  Periodo     MEDIUMINT UNSIGNED NOT NULL,
  IdOperacion INT UNSIGNED NOT NULL,
  Item        SMALLINT UNSIGNED NOT NULL,
  Codigo      CHAR(3) CHARACTER SET ascii NOT NULL,
  Monto       DECIMAL(11,2),
  PRIMARY KEY (IdOperacion, Item, Codigo, Periodo) CLUSTERED
);
