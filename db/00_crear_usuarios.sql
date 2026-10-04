-- =====================================================================
--  USUARIOS  (ejecutar una sola vez, con un usuario que pueda crear
--  usuarios: root en el servidor, o desde phpMyAdmin de XAMPP)
--  mysql -h 10.0.0.16 -u <usuario> -p < db/00_crear_usuarios.sql
--
--  comex_admin: crea el esquema, carga los meses e importa el KIT.
--  comex_api:   sólo lectura; es el que usa la API (.env).
--  Así, aunque alguien encuentre una falla en la API, no puede borrar
--  ni modificar datos.  CAMBIAR LAS CLAVES antes de ejecutar.
--
--  Cada usuario se crea dos veces: '@localhost' para conectarse desde el
--  mismo servidor y '@10.0.0.%' para conectarse desde otras PC de la red.
-- =====================================================================

CREATE USER IF NOT EXISTS 'comex_admin'@'localhost' IDENTIFIED BY 'cambiar-admin';
CREATE USER IF NOT EXISTS 'comex_admin'@'10.0.0.%'  IDENTIFIED BY 'cambiar-admin';
CREATE USER IF NOT EXISTS 'comex_api'@'localhost'   IDENTIFIED BY 'cambiar-api';
CREATE USER IF NOT EXISTS 'comex_api'@'10.0.0.%'    IDENTIFIED BY 'cambiar-api';

-- CREATE sobre comex.* permite crear la propia base comex
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX,
      CREATE ROUTINE, ALTER ROUTINE, EXECUTE
  ON comex.* TO 'comex_admin'@'localhost', 'comex_admin'@'10.0.0.%';

GRANT SELECT ON comex.* TO 'comex_api'@'localhost', 'comex_api'@'10.0.0.%';

-- Servidor: MariaDB 10.4 (XAMPP). No hace falta nada más:
--   local_infile viene activado (LOAD DATA LOCAL de la carga mensual) y el
--   log binario viene desactivado (permite crear la función del verificador).
-- Si algún día se activa el log binario, agregar en my.ini, sección [mysqld]:
--   log_bin_trust_function_creators = 1
-- En MySQL 8 (no MariaDB) en cambio hay que ejecutar, como root:
--   SET PERSIST local_infile = 1;
--   SET PERSIST log_bin_trust_function_creators = 1;
