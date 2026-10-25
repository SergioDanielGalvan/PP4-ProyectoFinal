-- =====================================================================
--  USUARIOS DE LA API (login con JWT). Ver DECISIONES §19.
--  Ejecutar UNA VEZ con un usuario que pueda dar permisos (root, o pegándolo
--  en la pestaña SQL de phpMyAdmin con la base comex elegida).
--
--  comex_api sigue siendo de sólo lectura para los datos; sobre esta tabla
--  necesita además INSERT y UPDATE (login, alta de usuarios, cambio de clave).
--  No tiene DELETE: los usuarios se desactivan, no se borran.
--
--  Usuario en minúsculas; ClaveHash con bcrypt; Rol admin o consulta.
--  (Sin comentarios dentro de las sentencias: phpMyAdmin los une con la
--  línea siguiente.)
--
--  En TiDB: la tabla la crea `node copiar-a-tidb.js --esquema`; el permiso
--  se da en el SQL Editor con el usuario con prefijo (ver README).
-- =====================================================================

CREATE TABLE IF NOT EXISTS comex.usuarios (
  IdUsuario     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  Usuario       VARCHAR(40) CHARACTER SET ascii NOT NULL UNIQUE,
  Nombre        VARCHAR(80) NOT NULL,
  ClaveHash     VARCHAR(100) CHARACTER SET ascii NOT NULL,
  Rol           VARCHAR(10) CHARACTER SET ascii NOT NULL DEFAULT 'consulta',
  Activo        TINYINT(1) NOT NULL DEFAULT 1,
  CreadoEn      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UltimoIngreso DATETIME NULL
);

GRANT SELECT, INSERT, UPDATE ON comex.usuarios TO 'comex_api'@'localhost', 'comex_api'@'10.0.0.%';
