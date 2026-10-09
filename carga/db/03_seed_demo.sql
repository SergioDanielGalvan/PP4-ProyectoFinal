-- =====================================================================
--  DATOS DE PRUEBA (ficticios) con códigos reales del KIT.
--  Requiere 01_schema.sql y 02_tablas_sim_kit.sql.
--  Periodos 202606 y 202607. Incluye una triangulación (origen China
--  vía Uruguay) y dos ítems con valor unitario muy bajo.
-- =====================================================================
SET NAMES utf8mb4;
USE comex;

INSERT INTO importadores (Nombre) VALUES
  ('DEMO TECNO IMPORT SA'), ('DEMO CALZADOS DEL SUR SRL'),
  ('DEMO EDITORIAL RIO SA'), ('DEMO IMPORTADORA BAJO COSTO SA');

SET @tecno   := (SELECT IdImportador FROM importadores WHERE Nombre = 'DEMO TECNO IMPORT SA');
SET @calzado := (SELECT IdImportador FROM importadores WHERE Nombre = 'DEMO CALZADOS DEL SUR SRL');
SET @edit    := (SELECT IdImportador FROM importadores WHERE Nombre = 'DEMO EDITORIAL RIO SA');
SET @bajo    := (SELECT IdImportador FROM importadores WHERE Nombre = 'DEMO IMPORTADORA BAJO COSTO SA');
SET @pc      := (SELECT IdPosicion FROM posicion WHERE PosicionSIM = '8471.30.12');
SET @calz    := (SELECT IdPosicion FROM posicion WHERE PosicionSIM = '6403.99.90');
SET @libro   := (SELECT IdPosicion FROM posicion WHERE PosicionSIM = '4901.99.00');

-- IdOperacion fijos (9001...) para no chocar con cargas reales
INSERT INTO caratula
  (Periodo, IdOperacion, NroAduana, IdImportador,
   PaisProcedencia, Via, DivisaFOB, FobTotalDivisas)
VALUES
  (202606, 9001, '26001IC04900101G', @tecno,   '310', '8', 'DOL', 138000.00),
  (202606, 9002, '26073IC04900102Z', @tecno,   '212', '2', 'DOL',  45000.00),
  (202606, 9003, '26001IC04900103X', @calzado, '225', '8', 'DOL',  25400.00),
  (202606, 9004, '26001IC04900104J', @bajo,    '310', '8', 'DOL',  28500.00),
  (202607, 9005, '26001IC04900201H', @edit,    '410', '8', '060',   7700.00),
  (202607, 9006, '26073IC04900202R', @tecno,   '310', '2', 'DOL',  77700.00),
  (202607, 9007, '26001IC04900203J', @calzado, '203', '4', 'DOL',  28000.00);

INSERT INTO item
  (Periodo, IdOperacion, Item, IdPosicion, PaisOrigen, UnidadMedida, CantidadUnidades, FobTotalDolares)
VALUES
  (202606, 9001, 1, @pc,    '310', '07',  200, 90000.00),
  (202606, 9001, 2, @pc,    '310', '07',  100, 48000.00),
  (202606, 9002, 1, @pc,    '212', '07',   50, 45000.00),
  (202606, 9003, 1, @calz,  '310', '01', 1200, 15000.00),
  (202606, 9003, 2, @calz,  '310', '01',  800, 10400.00),
  (202606, 9004, 1, @pc,    '310', '07',  300, 28500.00),
  (202607, 9005, 1, @libro, '410', '01',  500,  9000.00),
  (202607, 9006, 1, @pc,    '310', '07',  150, 70500.00),
  (202607, 9006, 2, @pc,    '310', '07',   60,  7200.00),
  (202607, 9007, 1, @calz,  '203', '01', 2000, 28000.00);

INSERT INTO liq (Periodo, IdOperacion, Item, Codigo, Monto)
  SELECT Periodo, IdOperacion, Item, '010', ROUND(FobTotalDolares * 0.16, 2) FROM item WHERE IdOperacion >= 9001
  UNION ALL
  SELECT Periodo, IdOperacion, Item, '011', ROUND(FobTotalDolares * 0.03, 2) FROM item WHERE IdOperacion >= 9001
  UNION ALL
  SELECT Periodo, IdOperacion, Item, '424', ROUND(FobTotalDolares * 0.06, 2) FROM item WHERE IdOperacion >= 9001;
