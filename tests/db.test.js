const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool } = require('./helpers/testDb');

test('initSchema creates all expected tables', async () => {
  const pool = await createTestPool();
  const tables = ['categories', 'items', 'cart_reservations', 'orders', 'order_items', 'payment_proofs'];
  for (const table of tables) {
    const result = await pool.query(`SELECT * FROM ${table} LIMIT 1`);
    assert.equal(result.rows.length, 0, `table ${table} should exist and be empty`);
  }
});
