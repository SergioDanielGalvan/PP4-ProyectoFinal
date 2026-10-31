-- =====================================================================
--  AUDITORÍA: una fila por cada pedido a la API (consultas, ingresos,
--  ingresos fallidos, cambios de usuarios y SQL libre). Ver DECISIONES §20.
--  Ejecutar UNA VEZ como root (o pegándolo en la pestaña SQL de phpMyAdmin
--  con la base comex elegida), después de 07_usuarios.sql.
--
--  La escribe la API (comex_api), que necesita INSERT para registrar,
--  SELECT para la pestaña Actividad y DELETE para borrar las filas más
--  viejas que AUDITORIA_DIAS (180 por defecto). No puede modificarlas.
--
--  Usuario se guarda como texto: el historial queda aunque el usuario se
--  elimine. Nunca se guardan claves ni tokens.
--  (Sin comentarios dentro de las sentencias: phpMyAdmin los une con la
--  línea siguiente.)
--
--  En TiDB: pegar el CREATE TABLE en el SQL Editor (con la base comex
--  elegida) y dar el permiso al usuario con prefijo:
--    GRANT SELECT, INSERT, DELETE ON comex.auditoria TO 'prefijo.comex_api'@'%';
-- =====================================================================

CREATE TABLE IF NOT EXISTS comex.auditoria (
  IdAuditoria BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  Fecha       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  IdUsuario   INT UNSIGNED NULL,
  Usuario     VARCHAR(40) CHARACTER SET ascii NULL,
  Accion      VARCHAR(20) CHARACTER SET ascii NOT NULL,
  Metodo      VARCHAR(7) CHARACTER SET ascii NOT NULL,
  Ruta        VARCHAR(200) NOT NULL,
  Detalle     VARCHAR(2000) NULL,
  Estado      SMALLINT UNSIGNED NOT NULL,
  Filas       INT UNSIGNED NULL,
  DuracionMs  INT UNSIGNED NOT NULL,
  Ip          VARCHAR(45) CHARACTER SET ascii NULL,
  KEY ix_auditoria_fecha (Fecha),
  KEY ix_auditoria_usuario (Usuario, Fecha),
  KEY ix_auditoria_accion (Accion, Fecha)
);

GRANT SELECT, INSERT, DELETE ON comex.auditoria TO 'comex_api'@'localhost', 'comex_api'@'10.0.0.%';
