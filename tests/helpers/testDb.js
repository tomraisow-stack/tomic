const { newDb } = require('pg-mem');
const { initSchema } = require('../../src/db');

async function createTestPool() {
  const memDb = newDb();
  const { Pool } = memDb.adapters.createPg();
  const pool = new Pool();
  await initSchema(pool);
  return pool;
}

module.exports = { createTestPool };
