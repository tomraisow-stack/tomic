const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool } = require('../helpers/testDb');
const categoriesQ = require('../../src/queries/categories');
const itemsQ = require('../../src/queries/items');
const ordersQ = require('../../src/queries/orders');

async function setupReservedItems(pool, userId, prices) {
  const category = await categoriesQ.createCategory(pool, { name: 'Верх' });
  const items = [];
  for (const price of prices) {
    const item = await itemsQ.createItem(pool, { categoryId: category.id, name: `Item ${price}`, price, size: 'M', conditionText: '', photos: [] });
    await itemsQ.reserveItem(pool, item.id, userId, 30 * 60 * 1000);
    items.push(item);
  }
  return items;
}

test('createOrder converts cart reservations into an order and clears the cart', async () => {
  const pool = await createTestPool();
  const items = await setupReservedItems(pool, 555, [500, 700]);

  const result = await ordersQ.createOrder(pool, { userId: 555, fio: 'Иван Иванов', phone: '+79990000000', address: 'ул. Ленина 1' });
  assert.equal(result.order.total, 1200);
  assert.equal(result.order.status, 'ожидает оплаты');
  assert.equal(result.itemCount, 2);

  const cart = await ordersQ.getUserCartReservations(pool, 555);
  assert.equal(cart.length, 0);

  const order = await ordersQ.getOrder(pool, result.order.id);
  assert.equal(order.items.length, 2);
  assert.equal((await itemsQ.getItem(pool, items[0].id)).status, 'reserved');
});

test('createOrder returns empty_cart error when the user has nothing reserved', async () => {
  const pool = await createTestPool();
  const result = await ordersQ.createOrder(pool, { userId: 999, fio: 'x', phone: 'x', address: 'x' });
  assert.equal(result.error, 'empty_cart');
});

test('listOrdersForUser and listOrdersAdmin filter correctly', async () => {
  const pool = await createTestPool();
  await setupReservedItems(pool, 1, [100]);
  await ordersQ.createOrder(pool, { userId: 1, fio: 'A', phone: 'A', address: 'A' });
  await setupReservedItems(pool, 2, [200]);
  await ordersQ.createOrder(pool, { userId: 2, fio: 'B', phone: 'B', address: 'B' });

  const forUser1 = await ordersQ.listOrdersForUser(pool, 1);
  assert.equal(forUser1.length, 1);

  const allPending = await ordersQ.listOrdersAdmin(pool, { status: 'ожидает оплаты' });
  assert.equal(allPending.length, 2);

  const allConfirmed = await ordersQ.listOrdersAdmin(pool, { status: 'оплачен' });
  assert.equal(allConfirmed.length, 0);
});

test('setOrderStatus, addPaymentProof, deleteOrder', async () => {
  const pool = await createTestPool();
  await setupReservedItems(pool, 1, [100]);
  const { order } = await ordersQ.createOrder(pool, { userId: 1, fio: 'A', phone: 'A', address: 'A' });

  const updated = await ordersQ.setOrderStatus(pool, order.id, 'оплачен');
  assert.equal(updated.status, 'оплачен');

  const proof = await ordersQ.addPaymentProof(pool, order.id, 'telegram_file_123');
  assert.equal(proof.telegram_file_id, 'telegram_file_123');

  const deleted = await ordersQ.deleteOrder(pool, order.id);
  assert.equal(deleted, true);
  assert.equal(await ordersQ.getOrder(pool, order.id), null);
});
