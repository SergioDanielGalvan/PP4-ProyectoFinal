-- titulo: Principales importadores
-- descripcion: Ranking por FOB en US$ con cantidad de despachos e ítems.
-- parametros: periodo:periodo:opcional, limite:entero:20
SELECT imp.Nombre AS importador,
       COUNT(DISTINCT c.IdOperacion, c.Periodo) AS despachos, COUNT(*) AS items,
       ROUND(SUM(i.FobTotalDolares), 2) AS fob_usd
FROM item i
JOIN caratula c ON c.IdOperacion = i.IdOperacion AND c.Periodo = i.Periodo
JOIN importadores imp ON imp.IdImportador = c.IdImportador
WHERE (:periodo IS NULL OR i.Periodo = :periodo)
GROUP BY c.IdImportador, imp.Nombre
ORDER BY fob_usd DESC
LIMIT :limite
