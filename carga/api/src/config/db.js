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
  ssl: process.env.DB_SSL === 'true'
    ? { minVersion: 'TLSv1.2', rejectUnauthorized: true }
    : undefined,
});

module.exports = pool;
