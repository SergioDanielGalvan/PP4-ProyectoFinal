-- =====================================================================
--  CARGA DE UN MES desde el .LST de ARCA  (correr en MySQL local)
--  mysql --local-infile=1 -u root -p < sql/04_carga_mensual.sql
--  Antes: cambiar la ruta del archivo en el LOAD DATA (paso 2).
--  Los meses se cargan en orden cronológico (ver paso 5).
-- =====================================================================
SET NAMES utf8mb4;
USE comex;

-- 1. Procedimiento que crea (si falta) y vacía la partición del mes
DROP PROCEDURE IF EXISTS preparar_periodo;
DELIMITER //
CREATE PROCEDURE preparar_periodo(IN p INT)
BEGIN
  DECLARE i INT DEFAULT 1;
  DECLARE t VARCHAR(20);
  WHILE i <= 3 DO
    SET t = ELT(i, 'caratula', 'item', 'liq');
    IF NOT EXISTS (SELECT 1 FROM information_schema.partitions
                   WHERE table_schema = DATABASE() AND table_name = t
                     AND partition_name = CONCAT('p', p)) THEN
      -- a<AAAAMM> guarda lo anterior que hubiera quedado en pmax
      SET @s = CONCAT('ALTER TABLE ', t, ' REORGANIZE PARTITION pmax INTO (',
                      'PARTITION a', p, ' VALUES LESS THAN (', p, '), ',
                      'PARTITION p', p, ' VALUES LESS THAN (', p + 1, '), ',
                      'PARTITION pmax VALUES LESS THAN MAXVALUE)');
      PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
    END IF;
    SET @s = CONCAT('ALTER TABLE ', t, ' TRUNCATE PARTITION p', p);
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
    SET i = i + 1;
  END WHILE;
END//
DELIMITER ;

-- 1b. Dígito verificador del número de destinación (traducción de
--     NroAduana_Valido, Rutinas.bas, VB6). Suma ASCII de los 15 primeros
--     caracteres, módulo 23, + 65; exportación ('MANE' en la posición 5) +1;
--     I, O, Q y el desborde pasan a X, Y, Z, A.
DROP FUNCTION IF EXISTS verificador_nro;
DELIMITER //
CREATE FUNCTION verificador_nro(nro VARCHAR(16)) RETURNS CHAR(1) DETERMINISTIC
BEGIN
  DECLARE s VARCHAR(16) DEFAULT UPPER(LEFT(nro, 15));
  DECLARE expo BOOLEAN DEFAULT LOCATE('MANE', s) = 5;
  DECLARE suma INT DEFAULT 0;
  DECLARE i INT DEFAULT 1;
  DECLARE c INT;
  IF expo THEN SET s = REPLACE(s, 'MANE', 'MANI'); END IF;
  WHILE i <= 15 DO
    SET suma = suma + ASCII(SUBSTRING(s, i, 1));
    SET i = i + 1;
  END WHILE;
  SET c = MOD(suma, 23) + 65 + IF(expo, 1, 0);
  SET c = CASE c WHEN 73 THEN 88 WHEN 79 THEN 89 WHEN 81 THEN 90 WHEN 91 THEN 65 ELSE c END;
  RETURN CHAR(c USING ascii);
END//
DELIMITER ;

-- 2. Staging. Listado de mainframe: salto de página (\f) al inicio,
--    encabezado y guiones, CRLF y líneas rellenas hasta ~700 caracteres.
TRUNCATE stg_impo;
LOAD DATA LOCAL INFILE '/datos/202608/IMPO.LST'
  INTO TABLE stg_impo CHARACTER SET latin1
  FIELDS TERMINATED BY '\''
  LINES TERMINATED BY '\n'
  (@c1,@c2,@c3,@c4,@c5,@c6,@c7,@c8,@c9,@c10,@c11,@c12,@c13,@c14,@c15,@c16)
SET Aduana           = TRIM(REPLACE(@c1, '\f', '')),
    NroAduana        = TRIM(@c2),
    Item             = TRIM(@c3),
    Periodo          = TRIM(@c4),
    NombreImportador = UPPER(TRIM(@c5)),
    Via              = NULLIF(TRIM(@c6), ''),   -- vacío en IC06 (sobre depósito)
    UnidadMedida     = TRIM(@c7),
    CantidadUnidades = TRIM(@c8),
    FobTotalDolares           = TRIM(@c9),               -- FOB del ítem en USD
    FobTotalDivisas         = TRIM(@c10),              -- FOB de la destinación en la divisa
    DivisaFOB           = TRIM(@c11),
    PaisOrigen       = TRIM(@c12),
    PaisProcedencia  = TRIM(@c13),
    PosicionSIM      = TRIM(@c14),       -- subpartida NCM (10)
    Codigo           = TRIM(@c15),
    Monto            = TRIM(REPLACE(@c16, '\r', ''));

-- Descarta encabezados, guiones y líneas vacías (pueden repetirse por página)
DELETE FROM stg_impo WHERE Aduana IS NULL OR Aduana NOT REGEXP '^[0-9]{3}$';
SELECT ROW_COUNT() AS lineas_descartadas;

CREATE INDEX ix_stg ON stg_impo (NroAduana, Item, Codigo);

-- 3. VALIDACIONES
-- a) Un solo periodo por archivo (debe dar 1 fila)
SELECT Periodo, COUNT(*) AS lineas FROM stg_impo GROUP BY Periodo;
SET @periodo := (SELECT MIN(CAST(Periodo AS UNSIGNED)) FROM stg_impo);

-- b) Carátula única por destinación (0 filas)
SELECT NroAduana,
       COUNT(DISTINCT Aduana, Periodo, NombreImportador, Via,
                      DivisaFOB, FobTotalDivisas, PaisProcedencia) AS variantes
FROM stg_impo GROUP BY NroAduana HAVING variantes > 1 LIMIT 50;

-- b2) La aduana (col. 1) y el año del número deben coincidir con lo que se
--     deriva de NroAduana (AA AAA TTTT NNNNNN D). caratula.AduanaOficializacion
--     y Destinacion se calculan desde el número. (Ambos en 0)
SELECT SUM(Aduana <> SUBSTRING(NroAduana, 3, 3))           AS aduana_distinta,
       SUM(LEFT(NroAduana, 2) <> SUBSTRING(Periodo, 3, 2)) AS anio_distinto
FROM stg_impo;

-- b3) Números de destinación con dígito verificador erróneo (0 filas).
--     Un número mal transcripto rompe el vínculo con el SIM.
SELECT NroAduana, verificador_nro(NroAduana) AS corresponde
FROM (SELECT DISTINCT NroAduana FROM stg_impo) d
WHERE RIGHT(NroAduana, 1) <> verificador_nro(NroAduana)
LIMIT 50;

-- c) Orden de los PAI: el de procedencia (2º) no varía dentro de una
--    destinación. Verificado con 202608: varía el 1º (origen), nunca el 2º.
SELECT SUM(n_pai1 > 1) AS destinaciones_varia_pai1,
       SUM(n_pai2 > 1) AS destinaciones_varia_pai2
FROM (SELECT NroAduana,
             COUNT(DISTINCT PaisOrigen)      AS n_pai1,
             COUNT(DISTINCT PaisProcedencia) AS n_pai2
      FROM stg_impo GROUP BY NroAduana) x;

-- d) Ítem único por (destinación, ítem) (0 filas)
SELECT NroAduana, Item,
       COUNT(DISTINCT UnidadMedida, CantidadUnidades, FobTotalDolares, PaisOrigen, PosicionSIM) AS variantes
FROM stg_impo GROUP BY NroAduana, Item HAVING variantes > 1 LIMIT 50;

-- e) Concepto único por ítem (0 filas)
SELECT NroAduana, Item, Codigo, COUNT(*) AS veces
FROM stg_impo GROUP BY NroAduana, Item, Codigo HAVING veces > 1 LIMIT 50;

-- f) Ítems que no vienen en el archivo (posible join interno: un ítem sin
--    ningún monto > 0 no genera líneas). Sólo destinaciones en dólares,
--    porque FobTotalDivisas está en la divisa de la factura.
SELECT COUNT(*) AS destinaciones_usd,
       SUM(n_items < max_item)             AS con_huecos,
       SUM(ABS(fob_total - fob_items) > 1) AS con_diferencia,
       ROUND(100 * SUM(fob_items) / SUM(fob_total), 1) AS pct_fob_detallado
FROM (SELECT NroAduana,
             MAX(fob_total) AS fob_total, SUM(fob) AS fob_items,
             COUNT(*) AS n_items, MAX(item_n) AS max_item
      FROM (SELECT NroAduana, CAST(Item AS UNSIGNED) AS item_n,
                   MAX(CAST(FobTotalDivisas AS DECIMAL(16,2))) AS fob_total,
                   MAX(CAST(FobTotalDolares   AS DECIMAL(16,2))) AS fob
            FROM stg_impo WHERE DivisaFOB = 'DOL'
            GROUP BY NroAduana, Item) i
      GROUP BY NroAduana) d;

-- f2) Tipo de cambio implícito (USD por unidad de divisa) en destinaciones
--     no dólar sin ítems salteados.
SELECT DivisaFOB, COUNT(*) AS destinaciones,
       ROUND(SUM(fob_items) / SUM(fob_total), 4) AS usd_por_unidad
FROM (SELECT NroAduana, MAX(DivisaFOB) AS DivisaFOB,
             MAX(fob_total) AS fob_total, SUM(fob) AS fob_items,
             COUNT(*) AS n_items, MAX(item_n) AS max_item
      FROM (SELECT NroAduana, MAX(DivisaFOB) AS DivisaFOB, CAST(Item AS UNSIGNED) AS item_n,
                   MAX(CAST(FobTotalDivisas AS DECIMAL(16,2))) AS fob_total,
                   MAX(CAST(FobTotalDolares   AS DECIMAL(16,2))) AS fob
            FROM stg_impo WHERE DivisaFOB <> 'DOL'
            GROUP BY NroAduana, Item) i
      GROUP BY NroAduana) d
WHERE n_items = max_item
GROUP BY DivisaFOB;

-- g) Conceptos presentes en el mes (los de monto cero no vienen)
SELECT s.Codigo, t.Descrip, COUNT(*) AS lineas,
       SUM(CAST(s.Monto AS DECIMAL(16,2))) AS monto
FROM stg_impo s LEFT JOIN tasas t ON t.Codigo = s.Codigo
GROUP BY s.Codigo, t.Descrip ORDER BY lineas DESC;

-- h) Códigos que no están en las tablas del KIT
SELECT 'aduana' AS campo, s.Aduana AS codigo, COUNT(*) AS lineas
  FROM stg_impo s LEFT JOIN aduanas t ON t.Codigo = s.Aduana
  WHERE t.Codigo IS NULL GROUP BY s.Aduana
UNION ALL SELECT 'pais_origen', s.PaisOrigen, COUNT(*)
  FROM stg_impo s LEFT JOIN paises t ON t.Codigo = s.PaisOrigen
  WHERE t.Codigo IS NULL GROUP BY s.PaisOrigen
UNION ALL SELECT 'pais_procedencia', s.PaisProcedencia, COUNT(*)
  FROM stg_impo s LEFT JOIN paises t ON t.Codigo = s.PaisProcedencia
  WHERE t.Codigo IS NULL GROUP BY s.PaisProcedencia
UNION ALL SELECT 'via', s.Via, COUNT(*)
  FROM stg_impo s LEFT JOIN via t ON t.Codigo = s.Via
  WHERE t.Codigo IS NULL AND s.Via IS NOT NULL GROUP BY s.Via
UNION ALL SELECT 'unidad', s.UnidadMedida, COUNT(*)
  FROM stg_impo s LEFT JOIN unidadesmedida t ON t.Codigo = s.UnidadMedida
  WHERE t.Codigo IS NULL GROUP BY s.UnidadMedida
UNION ALL SELECT 'divisa', s.DivisaFOB, COUNT(*)
  FROM stg_impo s LEFT JOIN divisas t ON t.Codigo = s.DivisaFOB
  WHERE t.Codigo IS NULL GROUP BY s.DivisaFOB
UNION ALL SELECT 'tasa', s.Codigo, COUNT(*)
  FROM stg_impo s LEFT JOIN tasas t ON t.Codigo = s.Codigo
  WHERE t.Codigo IS NULL AND s.Codigo <> '' GROUP BY s.Codigo;

-- i) Volumetría
SELECT COUNT(*)                        AS lineas,
       COUNT(DISTINCT NroAduana)       AS caratulas,
       COUNT(DISTINCT NroAduana, Item) AS items,
       COUNT(DISTINCT NombreImportador) AS importadores
FROM stg_impo;

-- 4. Referencias nuevas
INSERT IGNORE INTO importadores (Nombre) SELECT DISTINCT NombreImportador FROM stg_impo;
INSERT IGNORE INTO posicion (PosicionSIM) SELECT DISTINCT PosicionSIM     FROM stg_impo;

-- 5. Partición del mes (se crea si falta y se vacía para recargar).
--    Error "VALUES LESS THAN value must be strictly increasing" = se está
--    cargando un mes anterior al último cargado.
CALL preparar_periodo(@periodo);

-- 6. Carátulas
INSERT INTO caratula
  (Periodo, NroAduana, IdImportador, PaisProcedencia,
   Via, DivisaFOB, FobTotalDivisas)
SELECT @periodo, s.NroAduana, i.IdImportador, s.PaisProcedencia,
       s.Via, s.DivisaFOB, CAST(s.FobTotalDivisas AS DECIMAL(13,2))
FROM (SELECT NroAduana,
             MAX(NombreImportador) AS NombreImportador,
             MAX(PaisProcedencia)  AS PaisProcedencia,
             MAX(Via)              AS Via,
             MAX(DivisaFOB)           AS DivisaFOB,
             MAX(FobTotalDivisas)         AS FobTotalDivisas
      FROM stg_impo GROUP BY NroAduana) s
JOIN importadores i ON i.Nombre = s.NombreImportador;

-- 7. Ítems
INSERT INTO item
  (Periodo, IdOperacion, Item, IdPosicion, PaisOrigen, UnidadMedida, CantidadUnidades, FobTotalDolares)
SELECT @periodo, c.IdOperacion, CAST(s.Item AS UNSIGNED), n.IdPosicion, s.PaisOrigen, s.UnidadMedida,
       CAST(s.CantidadUnidades AS DECIMAL(15,3)), CAST(s.FobTotalDolares AS DECIMAL(13,2))
FROM (SELECT NroAduana, Item,
             MAX(PaisOrigen)       AS PaisOrigen,
             MAX(UnidadMedida)     AS UnidadMedida,
             MAX(CantidadUnidades) AS CantidadUnidades,
             MAX(FobTotalDolares)           AS FobTotalDolares,
             MAX(PosicionSIM)      AS PosicionSIM
      FROM stg_impo GROUP BY NroAduana, Item) s
JOIN caratula c ON c.NroAduana = s.NroAduana AND c.Periodo = @periodo
JOIN posicion n ON n.PosicionSIM = s.PosicionSIM;

-- 8. Liquidación
INSERT INTO liq (Periodo, IdOperacion, Item, Codigo, Monto)
SELECT @periodo, c.IdOperacion, CAST(s.Item AS UNSIGNED), s.Codigo,
       SUM(CAST(s.Monto AS DECIMAL(16,2)))
FROM stg_impo s
JOIN caratula c ON c.NroAduana = s.NroAduana AND c.Periodo = @periodo
WHERE s.Codigo <> ''
GROUP BY c.IdOperacion, s.Item, s.Codigo;

-- 9. Control cruzado contra la volumetría (paso 3 i)
SELECT @periodo AS periodo,
       (SELECT COUNT(*) FROM caratula WHERE Periodo = @periodo) AS caratulas,
       (SELECT COUNT(*) FROM item     WHERE Periodo = @periodo) AS items,
       (SELECT COUNT(*) FROM liq      WHERE Periodo = @periodo) AS liquidaciones;

DROP INDEX ix_stg ON stg_impo;
