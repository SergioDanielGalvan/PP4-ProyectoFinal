// SQL de la carga mensual. Las validaciones devuelven filas sólo cuando hay
// algo para revisar ("debe dar 0 filas"); las de tipo info siempre informan.

const RUTINAS = [
  'DROP PROCEDURE IF EXISTS preparar_periodo',
  // Crea (si falta) y vacía la partición del mes en las tres tablas.
  // a<AAAAMM> guarda lo anterior que hubiera quedado en pmax.
  `CREATE PROCEDURE preparar_periodo(IN p INT)
   BEGIN
     DECLARE i INT DEFAULT 1;
     DECLARE t VARCHAR(20);
     WHILE i <= 3 DO
       SET t = ELT(i, 'caratula', 'item', 'liq');
       IF NOT EXISTS (SELECT 1 FROM information_schema.partitions
                      WHERE table_schema = DATABASE() AND table_name = t
                        AND partition_name = CONCAT('p', p)) THEN
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
   END`,
  'DROP FUNCTION IF EXISTS verificador_nro',
  // Dígito verificador (NroAduana_Valido, Rutinas.bas, VB6)
  `CREATE FUNCTION verificador_nro(nro VARCHAR(16)) RETURNS CHAR(1) DETERMINISTIC
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
   END`,
];

// Las líneas llegan ya limpias desde Node (campos recortados, importador en
// mayúsculas, sin encabezados). ESCAPED BY '' para que una '\' en un nombre
// no se tome como escape.
const LOAD_DATA = `
  LOAD DATA LOCAL INFILE 'impo.lst'
  INTO TABLE stg_impo CHARACTER SET utf8mb4
  FIELDS TERMINATED BY '\\'' ESCAPED BY ''
  LINES TERMINATED BY '\\n'
  (Aduana, NroAduana, Item, Periodo, NombreImportador, @via, UnidadMedida,
   CantidadUnidades, FobTotalDolares, FobTotalDivisas, DivisaFOB, PaisOrigen,
   PaisProcedencia, PosicionSIM, Codigo, Monto)
  SET Via = NULLIF(@via, '')`;

const VALIDACIONES = [
  { id: 'b', titulo: 'Carátula única por destinación', tipo: 'control', sql: `
    SELECT NroAduana,
           COUNT(DISTINCT Aduana, Periodo, NombreImportador, Via,
                          DivisaFOB, FobTotalDivisas, PaisProcedencia) AS variantes
    FROM stg_impo GROUP BY NroAduana HAVING variantes > 1 LIMIT 50` },
  { id: 'b2', titulo: 'Aduana y año coinciden con el número de destinación', tipo: 'control', sql: `
    SELECT SUM(Aduana <> SUBSTRING(NroAduana, 3, 3))           AS aduana_distinta,
           SUM(LEFT(NroAduana, 2) <> SUBSTRING(Periodo, 3, 2)) AS anio_distinto
    FROM stg_impo
    HAVING aduana_distinta > 0 OR anio_distinto > 0` },
  { id: 'b3', titulo: 'Dígito verificador', tipo: 'control', sql: `
    SELECT NroAduana, verificador_nro(NroAduana) AS corresponde
    FROM (SELECT DISTINCT NroAduana FROM stg_impo) d
    WHERE RIGHT(NroAduana, 1) <> verificador_nro(NroAduana) LIMIT 50` },
  { id: 'c', titulo: 'País de procedencia único por destinación', tipo: 'control', sql: `
    SELECT NroAduana, COUNT(DISTINCT PaisProcedencia) AS procedencias
    FROM stg_impo GROUP BY NroAduana HAVING procedencias > 1 LIMIT 50` },
  { id: 'd', titulo: 'Ítem único por destinación e ítem', tipo: 'control', sql: `
    SELECT NroAduana, Item,
           COUNT(DISTINCT UnidadMedida, CantidadUnidades, FobTotalDolares, PaisOrigen, PosicionSIM) AS variantes
    FROM stg_impo GROUP BY NroAduana, Item HAVING variantes > 1 LIMIT 50` },
  { id: 'e', titulo: 'Concepto único por ítem', tipo: 'control', sql: `
    SELECT NroAduana, Item, Codigo, COUNT(*) AS veces
    FROM stg_impo GROUP BY NroAduana, Item, Codigo HAVING veces > 1 LIMIT 50` },
  { id: 'f', titulo: 'FOB de los ítems contra FOB total (destinaciones en dólares)', tipo: 'info', sql: `
    SELECT COUNT(*) AS destinaciones_usd,
           SUM(n_items < max_item)             AS con_items_salteados,
           SUM(ABS(fob_total - fob_items) > 1) AS con_diferencia,
           ROUND(100 * SUM(fob_items) / SUM(fob_total), 1) AS pct_fob_detallado
    FROM (SELECT NroAduana, MAX(fob_total) AS fob_total, SUM(fob) AS fob_items,
                 COUNT(*) AS n_items, MAX(item_n) AS max_item
          FROM (SELECT NroAduana, CAST(Item AS UNSIGNED) AS item_n,
                       MAX(CAST(FobTotalDivisas AS DECIMAL(16,2))) AS fob_total,
                       MAX(CAST(FobTotalDolares AS DECIMAL(16,2))) AS fob
                FROM stg_impo WHERE DivisaFOB = 'DOL'
                GROUP BY NroAduana, Item) i
          GROUP BY NroAduana) d` },
  { id: 'f2', titulo: 'Tipo de cambio implícito por divisa (USD por unidad)', tipo: 'info', sql: `
    SELECT DivisaFOB, COUNT(*) AS destinaciones,
           ROUND(SUM(fob_items) / SUM(fob_total), 4) AS usd_por_unidad
    FROM (SELECT NroAduana, MAX(DivisaFOB) AS DivisaFOB,
                 MAX(fob_total) AS fob_total, SUM(fob) AS fob_items,
                 COUNT(*) AS n_items, MAX(item_n) AS max_item
          FROM (SELECT NroAduana, MAX(DivisaFOB) AS DivisaFOB, CAST(Item AS UNSIGNED) AS item_n,
                       MAX(CAST(FobTotalDivisas AS DECIMAL(16,2))) AS fob_total,
                       MAX(CAST(FobTotalDolares AS DECIMAL(16,2))) AS fob
                FROM stg_impo WHERE DivisaFOB <> 'DOL'
                GROUP BY NroAduana, Item) i
          GROUP BY NroAduana) d
    WHERE n_items = max_item
    GROUP BY DivisaFOB ORDER BY destinaciones DESC` },
  { id: 'g', titulo: 'Conceptos liquidados en el mes', tipo: 'info', sql: `
    SELECT s.Codigo, t.Descrip, COUNT(*) AS lineas,
           SUM(CAST(s.Monto AS DECIMAL(16,2))) AS monto
    FROM stg_impo s LEFT JOIN tasas t ON t.Codigo = s.Codigo
    GROUP BY s.Codigo, t.Descrip ORDER BY lineas DESC` },
  { id: 'h', titulo: 'Códigos que no están en las tablas del KIT', tipo: 'control', sql: `
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
      WHERE t.Codigo IS NULL AND s.Codigo <> '' GROUP BY s.Codigo
    UNION ALL SELECT 'posicion (se agrega sin descripción)', s.PosicionSIM, COUNT(*)
      FROM stg_impo s LEFT JOIN posicion t ON t.PosicionSIM = s.PosicionSIM
      WHERE t.PosicionSIM IS NULL GROUP BY s.PosicionSIM` },
  { id: 'i', titulo: 'Volumetría del archivo', tipo: 'info', sql: `
    SELECT COUNT(*)                         AS lineas,
           COUNT(DISTINCT NroAduana)        AS caratulas,
           COUNT(DISTINCT NroAduana, Item)  AS items,
           COUNT(DISTINCT NombreImportador) AS importadores
    FROM stg_impo` },
];

// Carga a las tablas finales; ? = periodo
const CARGA = [
  { titulo: 'Importadores nuevos',
    sql: 'INSERT IGNORE INTO importadores (Nombre) SELECT DISTINCT NombreImportador FROM stg_impo' },
  { titulo: 'Posiciones nuevas',
    sql: 'INSERT IGNORE INTO posicion (PosicionSIM) SELECT DISTINCT PosicionSIM FROM stg_impo' },
  { titulo: 'Partición del mes', sql: 'CALL preparar_periodo(?)', params: 1 },
  { titulo: 'Carátulas', params: 1, sql: `
    INSERT INTO caratula (Periodo, NroAduana, IdImportador, PaisProcedencia, Via, DivisaFOB, FobTotalDivisas)
    SELECT ?, s.NroAduana, i.IdImportador, s.PaisProcedencia, s.Via, s.DivisaFOB,
           CAST(s.FobTotalDivisas AS DECIMAL(13,2))
    FROM (SELECT NroAduana,
                 MAX(NombreImportador) AS NombreImportador,
                 MAX(PaisProcedencia)  AS PaisProcedencia,
                 MAX(Via)              AS Via,
                 MAX(DivisaFOB)        AS DivisaFOB,
                 MAX(FobTotalDivisas)  AS FobTotalDivisas
          FROM stg_impo GROUP BY NroAduana) s
    JOIN importadores i ON i.Nombre = s.NombreImportador` },
  { titulo: 'Ítems', params: 1, sql: `
    INSERT INTO item (Periodo, IdOperacion, Item, IdPosicion, PaisOrigen, UnidadMedida, CantidadUnidades, FobTotalDolares)
    SELECT c.Periodo, c.IdOperacion, CAST(s.Item AS UNSIGNED), n.IdPosicion, s.PaisOrigen, s.UnidadMedida,
           CAST(s.CantidadUnidades AS DECIMAL(15,3)), CAST(s.FobTotalDolares AS DECIMAL(13,2))
    FROM (SELECT NroAduana, Item,
                 MAX(PaisOrigen)       AS PaisOrigen,
                 MAX(UnidadMedida)     AS UnidadMedida,
                 MAX(CantidadUnidades) AS CantidadUnidades,
                 MAX(FobTotalDolares)  AS FobTotalDolares,
                 MAX(PosicionSIM)      AS PosicionSIM
          FROM stg_impo GROUP BY NroAduana, Item) s
    JOIN caratula c ON c.NroAduana = s.NroAduana AND c.Periodo = ?
    JOIN posicion n ON n.PosicionSIM = s.PosicionSIM` },
  { titulo: 'Liquidación', params: 1, sql: `
    INSERT INTO liq (Periodo, IdOperacion, Item, Codigo, Monto)
    SELECT c.Periodo, c.IdOperacion, CAST(s.Item AS UNSIGNED), s.Codigo,
           SUM(CAST(s.Monto AS DECIMAL(16,2)))
    FROM stg_impo s
    JOIN caratula c ON c.NroAduana = s.NroAduana AND c.Periodo = ?
    WHERE s.Codigo <> ''
    GROUP BY c.IdOperacion, c.Periodo, s.Item, s.Codigo` },
];

const CONTROL_FINAL = `
  SELECT (SELECT COUNT(*) FROM caratula WHERE Periodo = ?) AS caratulas,
         (SELECT COUNT(*) FROM item     WHERE Periodo = ?) AS items,
         (SELECT COUNT(*) FROM liq      WHERE Periodo = ?) AS liquidaciones`;

module.exports = { RUTINAS, LOAD_DATA, VALIDACIONES, CARGA, CONTROL_FINAL };
