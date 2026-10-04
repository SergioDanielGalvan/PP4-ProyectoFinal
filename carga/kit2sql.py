import csv, subprocess, io, datetime

import sys
MDB = sys.argv[1] if len(sys.argv) > 1 else 'Kit.mdb'

def filas(tabla):
    out = subprocess.run(['mdb-export', MDB, tabla], capture_output=True, check=True).stdout.decode('utf-8')
    return list(csv.DictReader(io.StringIO(out)))

def fecha(s):
    # 'mm/dd/yy hh:mm:ss' ; yy < 50 -> 20yy
    if not s: return datetime.date(1900, 1, 1)
    m, d, y = s.split()[0].split('/')
    y = int(y); y += 2000 if y < 50 else 1900
    return datetime.date(y, int(m), int(d))

def vigentes(rows, campo_fecha='FechaInicio'):
    """Una fila por código: la de FechaInicio más reciente."""
    mejor = {}
    for r in rows:
        cod = r['Codigo'].strip()
        if cod not in mejor or fecha(r.get(campo_fecha)) >= fecha(mejor[cod].get(campo_fecha)):
            mejor[cod] = r
    return [mejor[k] for k in sorted(mejor)]

def q(v):
    if v is None: return 'NULL'
    v = v.strip()
    return "'" + v.replace('\\', '\\\\').replace("'", "''") + "'" if v != '' else 'NULL'

def inserts(tabla, columnas, valores, lote=500):
    sal = []
    for i in range(0, len(valores), lote):
        sal.append(f"INSERT INTO {tabla} ({', '.join(columnas)}) VALUES\n  " +
                   ",\n  ".join('(' + ', '.join(v) + ')' for v in valores[i:i+lote]) + ';')
    return '\n'.join(sal)

nn = lambda s: (s or '').replace('#', 'Ñ')   # el SIM guarda la Ñ como '#'

sql = ["-- =====================================================================",
       "--  Tablas SIM generadas desde Kit.mdb (una fila vigente por código:",
       "--  la de FechaInicio más reciente). Regenerar al actualizar el KIT.",
       "-- =====================================================================",
       "SET NAMES utf8mb4;", "USE comex;", ""]

for tabla, destino, cols, fx in [
    ('ADUANAS', 'aduanas', ['Codigo', 'Descrip'],
        lambda r: [q(r['Codigo']), q(nn(r['Descrip']))]),
    ('PAISES', 'paises', ['Codigo', 'Descrip'],
        lambda r: [q(r['Codigo']), q(nn(r['Descrip']))]),
    ('UNIDADESMEDIDA', 'unidadesmedida', ['Codigo', 'Descrip', 'Abreviatura'],
        lambda r: [q(r['Codigo']), q(r['Descrip']), q(r['Abreviatura'])]),
    ('TASAS', 'tasas', ['Codigo', 'Descrip', 'ImpoExpo'],
        lambda r: [q(r['Codigo']), q(r['Descrip']), q(r['ImpoExpo'])]),
    ('DIVISAS', 'divisas', ['Codigo', 'Descrip', 'Abreviatura'],
        lambda r: [q(r['Codigo']), q(r['Descrip']), q(r['Abreviatura'])]),
    ('DESTINACIONES', 'destinaciones', ['Codigo', 'Descrip', 'ImpoExpo'],
        lambda r: [q(r['Codigo']), q(r['Descrip']), q(r['ImpoExpo'])]),
]:
    rows = vigentes(filas(tabla))
    sql += [f"-- {tabla} -> {destino} ({len(rows)} códigos)", inserts(destino, cols, [fx(r) for r in rows]), ""]

via = filas('VIA')
sql += [f"-- VIA -> via ({len(via)} códigos)",
        inserts('via', ['Codigo', 'Descrip'],
                [[q(r['Codigo']), q(r['Descrip'])] for r in via]), ""]

ncm = {}
for r in filas('POSICION'):
    k = r['PosicionSIM'][:10]
    if len(k) == 10 and k not in ncm:
        ncm[k] = r['DescripcionNCM']
sql += [f"-- POSICION -> posicion ({len(ncm)} posiciones NCM con su descripción)",
        inserts('posicion', ['PosicionSIM', 'DescripcionNCM'], [[q(k), q(v)] for k, v in sorted(ncm.items())]), ""]

open('../db/02_tablas_sim_kit.sql', 'w', encoding='utf-8').write('\n'.join(sql))
print('ok')
