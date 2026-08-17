const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool } = require('./helpers/testDb');
const categoriesQ = require('../src/queries/categories');
const itemsQ = require('../src/queries/items');
const { sweepExpiredReservations } = require('../src/reservations');

test('sweepExpiredReservations releases only expired reservations', async () => {
  const pool = await createTestPool();
  const category = await categoriesQ.createCategory(pool, { name: 'Верх' });
  const expiredItem = await itemsQ.createItem(pool, { categoryId: category.id, name: 'A', price: 100, size: 'S', conditionText: '', photos: [] });
  const freshItem = await itemsQ.createItem(pool, { categoryId: category.id, name: 'B', price: 100, size: 'S', conditionText: '', photos: [] });

  await itemsQ.reserveItem(pool, expiredItem.id, 111, -1000); // already expired
  await itemsQ.reserveItem(pool, freshItem.id, 222, 30 * 60 * 1000); // not expired

  const swept = await sweepExpiredReservations(pool);
  assert.equal(swept, 1);

  assert.equal((await itemsQ.getItem(pool, expiredItem.id)).status, 'available');
  assert.equal((await itemsQ.getItem(pool, freshItem.id)).status, 'reserved');

  const remainingReservations = await pool.query('SELECT * FROM cart_reservations');
  assert.equal(remainingReservations.rows.length, 1);
});

test('sweepExpiredReservations is a no-op when nothing is expired', async () => {
  const pool = await createTestPool();
  const swept = await sweepExpiredReservations(pool);
  assert.equal(swept, 0);
});
