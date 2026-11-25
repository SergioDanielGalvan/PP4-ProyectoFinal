-- =====================================================================
--  EMPRESAS Y ROLES (varias empresas en un mismo sistema).
--  Ejecutar UNA VEZ como root, después de 09_borrar_periodos.sql
--  (o pegándolo en la pestaña SQL de phpMyAdmin con la base comex elegida).
--
--  Mismo criterio que el Módulo MARIA: cada empresa se identifica con
--  IdEmpresa, el mismo número que usa MARIA (idEmpresa en CARATULA,
--  CONFIGURACIONMARIA, etc.), para poder cruzar datos más adelante.
--  Las estadísticas de ARCA son públicas y las ven todas las empresas; lo
--  que se separa es quién entra, quién administra a quién y la actividad.
--
--  Roles:
--    general   administra el sistema: empresas, todos los usuarios, toda la
--              actividad, Períodos y SQL libre (ustedes)
--    admin     administra su empresa: sus usuarios y su actividad
--    consulta  usa las consultas
--
--  Los administradores que ya existían pasan a "general" y todos los
--  usuarios quedan en la empresa 1. Después se cambia el nombre de la
--  empresa 1 desde la pestaña Empresas.
--
--  En TiDB: el mismo script, cambiando el GRANT por el usuario con prefijo:
--    GRANT SELECT, INSERT, UPDATE ON comex.empresa TO 'prefijo.comex_api'@'%';
--  (en el SQL Editor, Run ejecuta sólo la sentencia del cursor: una por vez)
-- =====================================================================

CREATE TABLE IF NOT EXISTS comex.empresa (
  IdEmpresa  INT UNSIGNED NOT NULL PRIMARY KEY,   -- el mismo número que en MARIA
  Nombre     VARCHAR(80) NOT NULL,
  Cuit       CHAR(11) CHARACTER SET ascii NULL UNIQUE,
  Activa     TINYINT(1) NOT NULL DEFAULT 1,
  CreadaEn   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO comex.empresa (IdEmpresa, Nombre) VALUES (1, 'Empresa principal');

-- Columna e índice en dos sentencias: TiDB no deja indexar una columna
-- que se agrega en el mismo ALTER ("column does not exist").
ALTER TABLE comex.usuarios
  ADD COLUMN IF NOT EXISTS IdEmpresa INT UNSIGNED NOT NULL DEFAULT 1 AFTER Usuario;
ALTER TABLE comex.usuarios
  ADD INDEX IF NOT EXISTS ix_usuarios_empresa (IdEmpresa);

UPDATE comex.usuarios SET Rol = 'general' WHERE Rol = 'admin';

ALTER TABLE comex.auditoria
  ADD COLUMN IF NOT EXISTS IdEmpresa INT UNSIGNED NULL AFTER Usuario;
ALTER TABLE comex.auditoria
  ADD INDEX IF NOT EXISTS ix_auditoria_empresa (IdEmpresa, Fecha);

GRANT SELECT, INSERT, UPDATE ON comex.empresa TO 'comex_api'@'localhost', 'comex_api'@'10.0.0.%';
FLUSH PRIVILEGES;
