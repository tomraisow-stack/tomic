// tests/server.admin.test.js
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
    botToken: BOT_TOKEN, adminIds: new Set(['1']),
    reservationTtlMs: 1800000, adminInitDataMaxAgeSeconds: 3600, userInitDataMaxAgeSeconds: 3600,
  };
}

test('a non-admin gets 403 on every /api/admin route', async () => {
  const pool = await createTestPool();
  const app = createServer({ pool, config: testConfig(), bot: null });
  const nonAdmin = buildInitData({ id: 999 }, BOT_TOKEN);

  const routes = [
    ['get', '/api/admin/orders'],
    ['get', '/api/admin/items'],
    ['post', '/api/admin/items'],
    ['post', '/api/admin/categories'],
  ];
  for (const [method, url] of routes) {
    const res = await request(app)[method](url).query({ init_data: nonAdmin }).send({});
    assert.equal(res.status, 403, `${method.toUpperCase()} ${url} should 403 for a non-admin`);
  }
});

test('admin can manage categories and items end to end', async () => {
  const pool = await createTestPool();
  const app = createServer({ pool, config: testConfig(), bot: null });
  const admin = buildInitData({ id: 1 }, BOT_TOKEN);

  const catRes = await request(app).post('/api/admin/categories').query({ init_data: admin }).send({ name: 'Верх', sortOrder: 0 });
  assert.equal(catRes.status, 200);
  const categoryId = catRes.body.id;

  const itemRes = await request(app).post('/api/admin/items').query({ init_data: admin })
    .send({ categoryId, name: 'Куртка', price: 1500, size: 'M', conditionText: 'хор.', photos: [] });
  assert.equal(itemRes.status, 200);
  const itemId = itemRes.body.id;

  const listRes = await request(app).get('/api/admin/items').query({ init_data: admin });
  assert.equal(listRes.body.length, 1);

  const updateRes = await request(app).put(`/api/admin/items/${itemId}`).query({ init_data: admin })
    .send({ categoryId, name: 'Куртка (уценка)', price: 1200, size: 'M', conditionText: 'хор.', photos: [] });
  assert.equal(updateRes.body.price, 1200);

  const deleteRes = await request(app).delete(`/api/admin/items/${itemId}`).query({ init_data: admin });
  assert.equal(deleteRes.body.ok, true);
});

test('admin can confirm/cancel/mark-done an order via the API', async () => {
  const pool = await createTestPool();
  const category = await categoriesQ.createCategory(pool, { name: 'Верх' });
  const item = await itemsQ.createItem(pool, { categoryId: category.id, name: 'A', price: 500, size: 'M', conditionText: '', photos: [] });
  const app = createServer({ pool, config: testConfig(), bot: null });
  const admin = buildInitData({ id: 1 }, BOT_TOKEN);
  const user = buildInitData({ id: 2 }, BOT_TOKEN);

  await request(app).post('/api/cart/add').query({ init_data: user }).send({ itemId: item.id });
  const orderRes = await request(app).post('/api/orders').query({ init_data: user }).send({ fio: 'A', phone: 'A', address: 'A' });
  const orderId = orderRes.body.id;

  const confirmRes = await request(app).post(`/api/admin/orders/${orderId}/confirm`).query({ init_data: admin });
  assert.equal(confirmRes.body.status, 'оплачен');

  const doneRes = await request(app).post(`/api/admin/orders/${orderId}/done`).query({ init_data: admin });
  assert.equal(doneRes.body.status, 'выполнен');
});

test('admin can upload an item photo and gets back a servable URL', async () => {
  const pool = await createTestPool();
  const app = createServer({ pool, config: testConfig(), bot: null });
  const admin = buildInitData({ id: 1 }, BOT_TOKEN);

  const res = await request(app)
    .post('/api/admin/upload-photo')
    .query({ init_data: admin })
    .attach('photo', Buffer.from('fake-image-bytes'), 'jacket.jpg');

  assert.equal(res.status, 200);
  assert.match(res.body.url, /^\/photos\/\d+-[a-f0-9]+\.jpg$/);

  const fs = require('fs');
  const path = require('path');
  const savedPath = path.join(__dirname, '..', 'webapp', res.body.url);
  assert.equal(fs.existsSync(savedPath), true);
  fs.unlinkSync(savedPath);
});

test('upload-photo rejects a non-admin', async () => {
  const pool = await createTestPool();
  const app = createServer({ pool, config: testConfig(), bot: null });
  const nonAdmin = buildInitData({ id: 999 }, BOT_TOKEN);

  const res = await request(app)
    .post('/api/admin/upload-photo')
    .query({ init_data: nonAdmin })
    .attach('photo', Buffer.from('fake-image-bytes'), 'jacket.jpg');

  assert.equal(res.status, 403);
});
