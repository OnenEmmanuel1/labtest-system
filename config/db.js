'use strict';
require('dotenv').config();
const mysql = require('mysql2/promise');

const poolConfig = {
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306', 10),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'labtm_db',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  charset:            'utf8mb4',
};

const pool = mysql.createPool(poolConfig);

/**
 * Convenience wrapper — always uses parameterized queries.
 * @param {string} sql
 * @param {Array}  params
 */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

module.exports = { pool, query };
