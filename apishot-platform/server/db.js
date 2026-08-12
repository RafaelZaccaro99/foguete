/**
 * Conexão MySQL — usa as credenciais do banco criado no hPanel (Bancos de dados → MySQL).
 * Preencher no .env (ver .env.example).
 */
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4', // WhatsApp traz emoji (4 bytes) — sem isso a gravação da mensagem quebra
});

async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

module.exports = { pool, query };
