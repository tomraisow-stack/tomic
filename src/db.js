const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function createPool(connectionString) {
  return new Pool({ connectionString });
}

async function initSchema(pool) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
}

module.exports = { createPool, initSchema };
