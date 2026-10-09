/* ===== db.js : pool de conexiones a MySQL ===== */
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smartstock',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,        // fechas como 'YYYY-MM-DD' (evita desfases de zona horaria)
  decimalNumbers: true,
});

async function query(sql, params){
  const [rows] = await pool.query(sql, params);
  return rows;
}

// Ejecuta una función dentro de una transacción (entradas/salidas).
async function transaction(fn){
  const conn = await pool.getConnection();
  try{
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  }catch(err){
    await conn.rollback();
    throw err;
  }finally{
    conn.release();
  }
}

module.exports = { pool, query, transaction };
