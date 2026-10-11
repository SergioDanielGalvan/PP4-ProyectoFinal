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

module.exports = pool;
