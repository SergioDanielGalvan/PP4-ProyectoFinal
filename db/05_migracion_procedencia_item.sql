-- =====================================================================
--  Migración para bases creadas antes del 05/10/2026: agrega la
--  procedencia por ítem. Ejecutar una vez (como comex_admin o sergio).
--  Las bases nuevas (npm run base) ya la tienen.
--  Después, recargar los meses con npm run mes para completarla.
-- =====================================================================
USE comex;
ALTER TABLE item ADD COLUMN PaisProcedencia CHAR(3) CHARACTER SET ascii AFTER PaisOrigen;
