const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'comex',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL || 10),
  decimalNumbers: true, // DECIMAL -> number en el JSON
  dateStrings: true,    // DATE -> 'AAAA-MM-DD' sin corrimiento de zona horaria
  // Conexiones ociosas: mantenerlas vivas y descartarlas antes de que el servidor
  // (TiDB Cloud, o MariaDB al reiniciarse) las corte y la API quede con una muerta.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  maxIdle: 2,
  idleTimeout: 60000,
  ssl: process.env.DB_SSL === 'true'
    ? { minVersion: 'TLSv1.2', rejectUnauthorized: true }
    : undefined,
});

// Hora de la sesión: NOW() y CURRENT_TIMESTAMP (último ingreso, auditoría) quedan
// en la hora de Argentina. TiDB Cloud usa UTC por defecto; sin esto, las horas
// guardadas en producción aparecían corridas 3 horas en la página.
const ZONA = process.env.DB_TIMEZONE || '-03:00';
pool.pool.on('connection', (conexion) => {
  conexion.query('SET time_zone = ?', [ZONA], (err) => {
    if (err) console.error(`No se pudo fijar time_zone=${ZONA}:`, err.message);
  });
});

module.exports = pool;
