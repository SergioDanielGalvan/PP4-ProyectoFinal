-- titulo: Importación por sección de la NCM y mes
-- descripcion: FOB en US$ por sección y mes, con los mismos grupos de operaciones que la matriz (sin energía por redes ni Tierra del Fuego). Sirve para comparar contra INDEC.
-- parametros: periodo:periodo:opcional
SELECT i.Periodo AS periodo, cap.Seccion AS seccion, s.Descrip AS descripcion,
       ROUND(SUM(i.FobTotalDolares), 2) AS fob_usd,
       ROUND(SUM(i.FobTotalDolares) * 1.11, 2) AS cif_estimado_usd
FROM item i
JOIN caratula c   ON c.IdOperacion = i.IdOperacion AND c.Periodo = i.Periodo
JOIN posicion p   ON p.IdPosicion = i.IdPosicion
JOIN capitulo cap ON cap.Codigo = p.Capitulo
JOIN seccion s    ON s.Codigo = cap.Seccion
LEFT JOIN grupo_destinacion g ON g.Destinacion = c.Destinacion
WHERE COALESCE(g.Grupo, 'CONSUMO') IN ('CONSUMO', 'TEMP', 'ZF')
  AND (:periodo IS NULL OR i.Periodo = :periodo)
GROUP BY i.Periodo, cap.Seccion, s.Descrip, s.Numero
ORDER BY i.Periodo, s.Numero
