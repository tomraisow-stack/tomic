// tests/server.orders.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestPool } = require('./helpers/testDb');
const { buildInitData } = require('./helpers/initData');
const categoriesQ = require('../src/queries/categories');
const itemsQ = require('../src/queries/items');
const { createServer } = require('../src/server');

const BOT_TOKEN = 'test-bot-token';

function testConfig() {
  return {
    botToken: BOT_TOKEN, adminIds: new Set(),
    reservationTtlMs: 1800000, adminInitDataMaxAgeSeconds: 3600, userInitDataMaxAgeSeconds: 3600,
  };
}

function fakeBot() {
  const notified = [];
  const proofsSent = [];
  return {
    notifyNewOrder: async (order) => { notified.push(order); },
    sendProofPhoto: async (orderId, buffer) => { proofsSent.push({ orderId, size: buffer.length }); return 'fake_file_id'; },
    _notified: notified,
    _proofsSent: proofsSent,
  };
}

test('POST /api/orders creates an order from the cart and notifies the bot', async () => {
  const pool = await createTestPool();
  const category = await categoriesQ.createCategory(pool, { name: 'Верх' });
  const item = await itemsQ.createItem(pool, { categoryId: category.id, name: 'Куртка', price: 1500, size: 'M', conditionText: '', photos: [] });
  const bot = fakeBot();
  const app = createServer({ pool, config: testConfig(), bot });
  const user = buildInitData({ id: 1 }, BOT_TOKEN);

  await request(app).post('/api/cart/add').query({ init_data: user }).send({ itemId: item.id });
  const orderRes = await request(app).post('/api/orders').query({ init_data: user }).send({ fio: 'Иван', phone: '+7900', address: 'ул. Ленина 1' });

  assert.equal(orderRes.status, 200);
  assert.equal(orderRes.body.total, 1500);
  assert.equal(bot._notified.length, 1);

  const myOrders = await request(app).get('/api/my-orders').query({ init_data: user });
  assert.equal(myOrders.body.length, 1);
});

test('POST /api/orders 400s on an empty cart', async () => {
  const pool = await createTestPool();
  const app = createServer({ pool, config: testConfig(), bot: fakeBot() });
  const user = buildInitData({ id: 1 }, BOT_TOKEN);
  const res = await request(app).post('/api/orders').query({ init_data: user }).send({ fio: 'A', phone: 'A', address: 'A' });
  assert.equal(res.status, 400);
});

test('POST /api/proof relays the photo through the bot and stores the file id', async () => {
  const pool = await createTestPool();
  const category = await categoriesQ.createCategory(pool, { name: 'Верх' });
  const item = await itemsQ.createItem(pool, { categoryId: category.id, name: 'Куртка', price: 1500, size: 'M', conditionText: '', photos: [] });
  const bot = fakeBot();
  const app = createServer({ pool, config: testConfig(), bot });
  const user = buildInitData({ id: 1 }, BOT_TOKEN);

  await request(app).post('/api/cart/add').query({ init_data: user }).send({ itemId: item.id });
  const orderRes = await request(app).post('/api/orders').query({ init_data: user }).send({ fio: 'A', phone: 'A', address: 'A' });

  const proofRes = await request(app)
    .post('/api/proof')
    .query({ init_data: user })
    .field('orderId', String(orderRes.body.id))
    .attach('photo', Buffer.from('fake-image-bytes'), 'receipt.jpg');

  assert.equal(proofRes.status, 200);
  assert.equal(proofRes.body.telegram_file_id, 'fake_file_id');
  assert.equal(bot._proofsSent.length, 1);
});
