'use strict';
/**
 * scripts/setup-db.js
 * Cross-platform database initialization script for LabTrackMS
 * Reads schema.sql and seed.sql and executes them via mysql2
 */

require('dotenv').config();
const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');

async function main() {
  console.log('🔄 Initializing LabTrackMS Database...\n');

  const connection = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  try {
    // 1. Run schema.sql
    console.log('📜 Executing schema.sql...');
    const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await connection.query(schemaSql);
    console.log('✅ Database schema created successfully.');

    // 2. Run seed.sql
    console.log('🌱 Executing seed.sql...');
    const seedSql = fs.readFileSync(path.join(__dirname, '..', 'seed.sql'), 'utf8');
    await connection.query(seedSql);
    console.log('✅ Seed data loaded successfully.');

    console.log('\n🎉 LabTrackMS Database setup complete!');
    console.log('   Run "npm start" or "npm run dev:node" to launch the server.\n');
  } catch (err) {
    console.error('\n❌ Database setup error:', err.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

main();
