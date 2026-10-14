-- titulo: Importación por destinación
-- descripcion: Despachos y FOB en US$ por código de destinación del KIT, con su grupo en la matriz.
-- parametros: periodo:periodo:opcional
SELECT c.Destinacion AS destinacion, d.Descrip AS descripcion,
       COALESCE(g.Grupo, 'CONSUMO') AS grupo,
       COUNT(DISTINCT c.IdOperacion, c.Periodo) AS despachos,
       ROUND(SUM(i.FobTotalDolares), 2) AS fob_usd
FROM item i
JOIN caratula c ON c.IdOperacion = i.IdOperacion AND c.Periodo = i.Periodo
LEFT JOIN destinaciones d ON d.Codigo = c.Destinacion
LEFT JOIN grupo_destinacion g ON g.Destinacion = c.Destinacion
WHERE (:periodo IS NULL OR i.Periodo = :periodo)
GROUP BY c.Destinacion, d.Descrip, COALESCE(g.Grupo, 'CONSUMO')
ORDER BY fob_usd DESC
