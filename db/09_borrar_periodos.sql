-- =====================================================================
--  BORRAR PERÍODOS DESDE LA PÁGINA (pestaña Períodos, sólo administradores).
--  Ejecutar UNA VEZ como root (o pegándolo en la pestaña SQL de phpMyAdmin
--  con la base comex elegida), después de 08_auditoria.sql.
--
--  Hasta ahora comex_api sólo leía los datos. Para borrar un mes o su
--  liquidación necesita DELETE sobre las tres tablas de hechos; no recibe
--  INSERT ni UPDATE: no puede cambiar datos, sólo quitarlos.
--  Resguardos de la API: sólo administradores, el período escrito a mano
--  como confirmación y la clave propia otra vez (un token robado no alcanza).
--  Cada borrado queda en la auditoría (acción borrar_periodo).
--
--  Si no se quiere esta posibilidad, no ejecutar este script: la pestaña
--  muestra las cantidades igual y el borrado responde con error de permisos.
--
--  En TiDB: dar el permiso al usuario con prefijo, una sentencia por vez:
--    GRANT DELETE ON comex.caratula TO 'prefijo.comex_api'@'%';
--    GRANT DELETE ON comex.item TO 'prefijo.comex_api'@'%';
--    GRANT DELETE ON comex.liq TO 'prefijo.comex_api'@'%';
-- =====================================================================

GRANT DELETE ON comex.caratula TO 'comex_api'@'localhost', 'comex_api'@'10.0.0.%';
GRANT DELETE ON comex.item TO 'comex_api'@'localhost', 'comex_api'@'10.0.0.%';
GRANT DELETE ON comex.liq TO 'comex_api'@'localhost', 'comex_api'@'10.0.0.%';
FLUSH PRIVILEGES;
