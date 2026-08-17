// tests/server.cart.test.js
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

async function setupItem(pool) {
  const category = await categoriesQ.createCategory(pool, { name: 'Верх' });
  return itemsQ.createItem(pool, { categoryId: category.id, name: 'Куртка', price: 1500, size: 'M', conditionText: 'хор.', photos: [] });
}

test('POST /api/cart/add reserves the item; a second add for another user 409s', async () => {
  const pool = await createTestPool();
  const item = await setupItem(pool);
  const app = createServer({ pool, config: testConfig(), bot: null });
  const userA = buildInitData({ id: 1 }, BOT_TOKEN);
  const userB = buildInitData({ id: 2 }, BOT_TOKEN);

  const first = await request(app).post('/api/cart/add').query({ init_data: userA }).send({ itemId: item.id });
  assert.equal(first.status, 200);

  const second = await request(app).post('/api/cart/add').query({ init_data: userB }).send({ itemId: item.id });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'already_reserved');
});

test('GET /api/cart lists the caller\'s reservations; DELETE releases one', async () => {
  const pool = await createTestPool();
  const item = await setupItem(pool);
  const app = createServer({ pool, config: testConfig(), bot: null });
  const user = buildInitData({ id: 1 }, BOT_TOKEN);

  await request(app).post('/api/cart/add').query({ init_data: user }).send({ itemId: item.id });
  const cartRes = await request(app).get('/api/cart').query({ init_data: user });
  assert.equal(cartRes.body.length, 1);

  await request(app).delete(`/api/cart/${item.id}`).query({ init_data: user });
  const afterDelete = await request(app).get('/api/cart').query({ init_data: user });
  assert.equal(afterDelete.body.length, 0);
});
