-- titulo: Ítems idénticos repetidos
-- descripcion: Mismo importador, NCM, cantidad y FOB en el mismo mes, en más de un despacho. Control de calidad: posibles despachos por estimación o duplicados.
-- parametros: periodo:periodo:opcional, minimo_usd:entero:1000000, limite:entero:50
SELECT i.Periodo AS periodo, imp.Nombre AS importador, p.PosicionSIM AS ncm,
       i.CantidadUnidades AS cantidad, i.FobTotalDolares AS fob_usd,
       COUNT(*) AS repeticiones, ROUND(SUM(i.FobTotalDolares), 2) AS fob_total_usd
FROM item i
JOIN caratula c ON c.IdOperacion = i.IdOperacion AND c.Periodo = i.Periodo
JOIN importadores imp ON imp.IdImportador = c.IdImportador
JOIN posicion p ON p.IdPosicion = i.IdPosicion
WHERE (:periodo IS NULL OR i.Periodo = :periodo)
GROUP BY i.Periodo, c.IdImportador, imp.Nombre, i.IdPosicion, p.PosicionSIM, i.CantidadUnidades, i.FobTotalDolares
HAVING COUNT(*) > 1 AND SUM(i.FobTotalDolares) >= :minimo_usd
ORDER BY fob_total_usd DESC
LIMIT :limite
