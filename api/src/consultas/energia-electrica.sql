-- titulo: Importación de energía eléctrica (2716.00.00)
-- descripcion: Por mes, importador y destinación: ítems, cantidad y FOB en US$.
-- parametros: periodo:periodo:opcional
SELECT i.Periodo AS periodo, imp.Nombre AS importador, c.Destinacion AS destinacion,
       COUNT(*) AS items, SUM(i.CantidadUnidades) AS cantidad, i.UnidadMedida AS unidad,
       ROUND(SUM(i.FobTotalDolares), 2) AS fob_usd
FROM item i
JOIN posicion p ON p.IdPosicion = i.IdPosicion
JOIN caratula c ON c.IdOperacion = i.IdOperacion AND c.Periodo = i.Periodo
JOIN importadores imp ON imp.IdImportador = c.IdImportador
WHERE p.PosicionSIM = '2716.00.00'
  AND (:periodo IS NULL OR i.Periodo = :periodo)
GROUP BY i.Periodo, imp.Nombre, c.Destinacion, i.UnidadMedida
ORDER BY i.Periodo, fob_usd DESC
