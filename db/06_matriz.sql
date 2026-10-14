-- =====================================================================
--  Matriz de importaciones: secciones y capítulos de la NCM (como publica
--  INDEC) y grupos de destinación. Ver DECISIONES §18.
--  Se puede ejecutar más de una vez (crea si no existe y actualiza textos).
--    cmd /c "F:\xampp\mysql\bin\mysql.exe -h 10.0.0.16 -u comex_admin -p --default-character-set=utf8mb4 comex < db\06_matriz.sql"
-- =====================================================================

CREATE TABLE IF NOT EXISTS seccion (
  Codigo   VARCHAR(5) CHARACTER SET ascii PRIMARY KEY,   -- I ... XXI
  Numero   TINYINT UNSIGNED NOT NULL,                     -- para ordenar
  Descrip  VARCHAR(60) NOT NULL
);

CREATE TABLE IF NOT EXISTS capitulo (
  Codigo   CHAR(2) CHARACTER SET ascii PRIMARY KEY,       -- = posicion.Capitulo
  Seccion  VARCHAR(5) CHARACTER SET ascii NOT NULL,
  Descrip  VARCHAR(80) NOT NULL,
  KEY ix_seccion (Seccion)
);

-- Grupos de destinación: separan lo que distorsiona la matriz (energía por
-- redes, Tierra del Fuego). PorDefecto = entra en el gráfico si no se elige.
CREATE TABLE IF NOT EXISTS grupo (
  Codigo     VARCHAR(10) CHARACTER SET ascii PRIMARY KEY,
  Descrip    VARCHAR(60) NOT NULL,
  PorDefecto TINYINT(1) NOT NULL DEFAULT 1,
  Orden      TINYINT UNSIGNED NOT NULL
);

-- Sólo las excepciones: una destinación que no figura acá es CONSUMO.
CREATE TABLE IF NOT EXISTS grupo_destinacion (
  Destinacion CHAR(4) CHARACTER SET ascii PRIMARY KEY,
  Grupo       VARCHAR(10) CHARACTER SET ascii NOT NULL
);

INSERT INTO seccion (Codigo, Numero, Descrip) VALUES
 ('I',     1, 'Animales vivos y productos del reino animal'),
 ('II',    2, 'Productos del reino vegetal'),
 ('III',   3, 'Grasas y aceites'),
 ('IV',    4, 'Alimentos, bebidas y tabaco'),
 ('V',     5, 'Productos minerales'),
 ('VI',    6, 'Productos químicos'),
 ('VII',   7, 'Plástico, caucho y sus manufacturas'),
 ('VIII',  8, 'Pieles, cueros y sus manufacturas'),
 ('IX',    9, 'Madera, corcho y cestería'),
 ('X',    10, 'Pasta de madera, papel y cartón'),
 ('XI',   11, 'Materias textiles y sus manufacturas'),
 ('XII',  12, 'Calzado, sombreros y paraguas'),
 ('XIII', 13, 'Piedra, cerámica y vidrio'),
 ('XIV',  14, 'Perlas, piedras y metales preciosos'),
 ('XV',   15, 'Metales comunes y sus manufacturas'),
 ('XVI',  16, 'Máquinas, aparatos y material eléctrico'),
 ('XVII', 17, 'Material de transporte'),
 ('XVIII',18, 'Óptica, medicina y precisión'),
 ('XIX',  19, 'Armas y municiones'),
 ('XX',   20, 'Mercancías y productos diversos'),
 ('XXI',  21, 'Objetos de arte y antigüedades')
ON DUPLICATE KEY UPDATE Numero = VALUES(Numero), Descrip = VALUES(Descrip);

INSERT INTO capitulo (Codigo, Seccion, Descrip) VALUES
 ('01','I','Animales vivos'),
 ('02','I','Carne y despojos comestibles'),
 ('03','I','Pescados, crustáceos y moluscos'),
 ('04','I','Leche, lácteos, huevos y miel'),
 ('05','I','Otros productos de origen animal'),
 ('06','II','Plantas vivas y floricultura'),
 ('07','II','Hortalizas'),
 ('08','II','Frutas'),
 ('09','II','Café, té, yerba mate y especias'),
 ('10','II','Cereales'),
 ('11','II','Productos de la molinería'),
 ('12','II','Semillas y frutos oleaginosos'),
 ('13','II','Gomas, resinas y extractos vegetales'),
 ('14','II','Materias trenzables'),
 ('15','III','Grasas y aceites animales o vegetales'),
 ('16','IV','Preparaciones de carne o pescado'),
 ('17','IV','Azúcares y artículos de confitería'),
 ('18','IV','Cacao y sus preparaciones'),
 ('19','IV','Preparaciones de cereales y pastelería'),
 ('20','IV','Preparaciones de hortalizas y frutas'),
 ('21','IV','Preparaciones alimenticias diversas'),
 ('22','IV','Bebidas, líquidos alcohólicos y vinagre'),
 ('23','IV','Residuos alimentarios y alimentos para animales'),
 ('24','IV','Tabaco'),
 ('25','V','Sal, azufre, tierras, piedras y cementos'),
 ('26','V','Minerales metalíferos, escorias y cenizas'),
 ('27','V','Combustibles, aceites minerales y energía eléctrica'),
 ('28','VI','Químicos inorgánicos'),
 ('29','VI','Químicos orgánicos'),
 ('30','VI','Productos farmacéuticos'),
 ('31','VI','Abonos'),
 ('32','VI','Tintes, pinturas y tintas'),
 ('33','VI','Aceites esenciales, perfumería y cosmética'),
 ('34','VI','Jabones y preparaciones para lavar'),
 ('35','VI','Materias albuminoideas, colas y enzimas'),
 ('36','VI','Pólvoras y explosivos'),
 ('37','VI','Productos fotográficos'),
 ('38','VI','Productos diversos de la industria química'),
 ('39','VII','Plástico y sus manufacturas'),
 ('40','VII','Caucho y sus manufacturas'),
 ('41','VIII','Pieles y cueros'),
 ('42','VIII','Manufacturas de cuero y artículos de viaje'),
 ('43','VIII','Peletería'),
 ('44','IX','Madera y sus manufacturas'),
 ('45','IX','Corcho'),
 ('46','IX','Cestería'),
 ('47','X','Pasta de madera'),
 ('48','X','Papel y cartón'),
 ('49','X','Productos editoriales e impresos'),
 ('50','XI','Seda'),
 ('51','XI','Lana y pelo fino'),
 ('52','XI','Algodón'),
 ('53','XI','Otras fibras textiles vegetales'),
 ('54','XI','Filamentos sintéticos o artificiales'),
 ('55','XI','Fibras sintéticas o artificiales discontinuas'),
 ('56','XI','Guata, fieltro y cordeles'),
 ('57','XI','Alfombras'),
 ('58','XI','Tejidos especiales'),
 ('59','XI','Telas impregnadas o recubiertas'),
 ('60','XI','Tejidos de punto'),
 ('61','XI','Prendas de vestir de punto'),
 ('62','XI','Prendas de vestir, excepto de punto'),
 ('63','XI','Demás artículos textiles confeccionados'),
 ('64','XII','Calzado'),
 ('65','XII','Sombreros'),
 ('66','XII','Paraguas y bastones'),
 ('67','XII','Plumas y flores artificiales'),
 ('68','XIII','Manufacturas de piedra, yeso y cemento'),
 ('69','XIII','Productos cerámicos'),
 ('70','XIII','Vidrio y sus manufacturas'),
 ('71','XIV','Perlas, piedras y metales preciosos'),
 ('72','XV','Fundición, hierro y acero'),
 ('73','XV','Manufacturas de hierro o acero'),
 ('74','XV','Cobre'),
 ('75','XV','Níquel'),
 ('76','XV','Aluminio'),
 ('78','XV','Plomo'),
 ('79','XV','Cinc'),
 ('80','XV','Estaño'),
 ('81','XV','Demás metales comunes'),
 ('82','XV','Herramientas y cuchillería'),
 ('83','XV','Manufacturas diversas de metal común'),
 ('84','XVI','Máquinas y aparatos mecánicos'),
 ('85','XVI','Máquinas y material eléctrico'),
 ('86','XVII','Material ferroviario'),
 ('87','XVII','Vehículos automóviles y sus partes'),
 ('88','XVII','Aeronaves'),
 ('89','XVII','Barcos'),
 ('90','XVIII','Óptica, medida y medicina'),
 ('91','XVIII','Relojería'),
 ('92','XVIII','Instrumentos musicales'),
 ('93','XIX','Armas y municiones'),
 ('94','XX','Muebles, colchones e iluminación'),
 ('95','XX','Juguetes y artículos de deporte'),
 ('96','XX','Manufacturas diversas'),
 ('97','XXI','Objetos de arte y antigüedades')
ON DUPLICATE KEY UPDATE Seccion = VALUES(Seccion), Descrip = VALUES(Descrip);

INSERT INTO grupo (Codigo, Descrip, PorDefecto, Orden) VALUES
 ('CONSUMO', 'Importación a consumo',                1, 1),
 ('TEMP',    'Nacionalización de temporarias',       1, 2),
 ('ZF',      'Egreso de zona franca',                1, 3),
 ('REDES',   'Energía por redes (sin doc. de transporte)', 0, 4),
 ('AAE',     'Egreso de Tierra del Fuego (AAE)',     0, 5)
ON DUPLICATE KEY UPDATE Descrip = VALUES(Descrip), PorDefecto = VALUES(PorDefecto), Orden = VALUES(Orden);

INSERT INTO grupo_destinacion (Destinacion, Grupo) VALUES
 ('IC01','REDES'),
 ('ECA1','AAE'), ('ECA2','AAE'),
 ('ZFE1','ZF'),  ('ZFE3','ZF'),  ('PZF1','ZF'),
 ('IC81','TEMP'), ('IC82','TEMP'), ('IC83','TEMP'), ('IG82','TEMP'),
 ('ICR1','TEMP'), ('ICR2','TEMP'), ('ICR3','TEMP')
ON DUPLICATE KEY UPDATE Grupo = VALUES(Grupo);
