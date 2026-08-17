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

  const deleteRes = await request(app).delete(`/api/cart/${item.id}`).query({ init_data: user });
  assert.equal(deleteRes.status, 200);
  const afterDelete = await request(app).get('/api/cart').query({ init_data: user });
  assert.equal(afterDelete.body.length, 0);
  assert.equal((await itemsQ.getItem(pool, item.id)).status, 'available');
});

test('DELETE /api/cart/:itemId cannot release an item reserved by another user', async () => {
  const pool = await createTestPool();
  const item = await setupItem(pool);
  const app = createServer({ pool, config: testConfig(), bot: null });
  const userA = buildInitData({ id: 1 }, BOT_TOKEN);
  const userB = buildInitData({ id: 2 }, BOT_TOKEN);

  const reserved = await request(app).post('/api/cart/add').query({ init_data: userA }).send({ itemId: item.id });
  assert.equal(reserved.status, 200);

  const stealAttempt = await request(app).delete(`/api/cart/${item.id}`).query({ init_data: userB });
  assert.equal(stealAttempt.status, 404);
  assert.equal(stealAttempt.body.error, 'not_found');

  // The item must still be reserved and still in user A's cart.
  assert.equal((await itemsQ.getItem(pool, item.id)).status, 'reserved');
  const cartA = await request(app).get('/api/cart').query({ init_data: userA });
  assert.equal(cartA.body.length, 1);
  assert.equal(cartA.body[0].item_id, item.id);

  // And user B still cannot grab it.
  const grab = await request(app).post('/api/cart/add').query({ init_data: userB }).send({ itemId: item.id });
  assert.equal(grab.status, 409);
});

test('DELETE /api/cart/:itemId 400s on a non-numeric item id and 404s on an unreserved one', async () => {
  const pool = await createTestPool();
  const item = await setupItem(pool);
  const app = createServer({ pool, config: testConfig(), bot: null });
  const user = buildInitData({ id: 1 }, BOT_TOKEN);

  const bad = await request(app).delete('/api/cart/abc').query({ init_data: user });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_item_id');

  const missing = await request(app).delete(`/api/cart/${item.id}`).query({ init_data: user });
  assert.equal(missing.status, 404);
  assert.equal((await itemsQ.getItem(pool, item.id)).status, 'available');
});
