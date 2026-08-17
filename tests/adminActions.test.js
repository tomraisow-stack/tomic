const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool } = require('./helpers/testDb');
const categoriesQ = require('../src/queries/categories');
const itemsQ = require('../src/queries/items');
const ordersQ = require('../src/queries/orders');
const adminActions = require('../src/adminActions');

async function setupOrder(pool, userId = 1, price = 500) {
  const category = await categoriesQ.createCategory(pool, { name: 'Верх' });
  const item = await itemsQ.createItem(pool, { categoryId: category.id, name: 'A', price, size: 'M', conditionText: '', photos: [] });
  await itemsQ.reserveItem(pool, item.id, userId, 30 * 60 * 1000);
  const { order } = await ordersQ.createOrder(pool, { userId, fio: 'A', phone: 'A', address: 'A' });
  return { order, item };
}

test('confirmOrderPayment marks the order paid and its items sold', async () => {
  const pool = await createTestPool();
  const { order, item } = await setupOrder(pool);

  const result = await adminActions.confirmOrderPayment(pool, order.id);
  assert.equal(result.order.status, 'оплачен');
  assert.equal((await itemsQ.getItem(pool, item.id)).status, 'sold');
});

test('confirmOrderPayment rejects an order that is not pending payment', async () => {
  const pool = await createTestPool();
  const { order } = await setupOrder(pool);
  await adminActions.confirmOrderPayment(pool, order.id);

  const second = await adminActions.confirmOrderPayment(pool, order.id);
  assert.equal(second.error, 'wrong_status');
});

test('cancelOrder marks the order cancelled and releases its items', async () => {
  const pool = await createTestPool();
  const { order, item } = await setupOrder(pool);

  const result = await adminActions.cancelOrder(pool, order.id);
  assert.equal(result.order.status, 'отменён');
  assert.equal((await itemsQ.getItem(pool, item.id)).status, 'available');
});

test('cancelOrder reports already_cancelled on a double cancel of an unpaid order', async () => {
  const pool = await createTestPool();
  const { order } = await setupOrder(pool);
  await adminActions.cancelOrder(pool, order.id);

  const second = await adminActions.cancelOrder(pool, order.id);
  assert.equal(second.error, 'already_cancelled');
});

test('cancelOrder refuses a paid order and leaves its items sold', async () => {
  const pool = await createTestPool();
  const { order, item } = await setupOrder(pool);
  await adminActions.confirmOrderPayment(pool, order.id);

  const result = await adminActions.cancelOrder(pool, order.id);
  assert.equal(result.error, 'wrong_status');
  assert.equal((await ordersQ.getOrder(pool, order.id)).status, 'оплачен');
  assert.equal((await itemsQ.getItem(pool, item.id)).status, 'sold');
});

test('cancelOrder refuses a completed order and leaves its items sold', async () => {
  const pool = await createTestPool();
  const { order, item } = await setupOrder(pool);
  await adminActions.confirmOrderPayment(pool, order.id);
  await adminActions.markOrderDone(pool, order.id);

  const result = await adminActions.cancelOrder(pool, order.id);
  assert.equal(result.error, 'wrong_status');
  assert.equal((await ordersQ.getOrder(pool, order.id)).status, 'выполнен');
  assert.equal((await itemsQ.getItem(pool, item.id)).status, 'sold');
});

test('markOrderDone requires the order to already be paid', async () => {
  const pool = await createTestPool();
  const { order } = await setupOrder(pool);

  const tooEarly = await adminActions.markOrderDone(pool, order.id);
  assert.equal(tooEarly.error, 'wrong_status');

  await adminActions.confirmOrderPayment(pool, order.id);
  const result = await adminActions.markOrderDone(pool, order.id);
  assert.equal(result.order.status, 'выполнен');
});

test('all three actions return not_found for a missing order id', async () => {
  const pool = await createTestPool();
  assert.equal((await adminActions.confirmOrderPayment(pool, 9999)).error, 'not_found');
  assert.equal((await adminActions.cancelOrder(pool, 9999)).error, 'not_found');
  assert.equal((await adminActions.markOrderDone(pool, 9999)).error, 'not_found');
});
