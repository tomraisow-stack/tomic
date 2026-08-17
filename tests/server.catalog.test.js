// tests/server.catalog.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestPool } = require('./helpers/testDb');
const categoriesQ = require('../src/queries/categories');
const itemsQ = require('../src/queries/items');
const { createServer } = require('../src/server');

function testConfig() {
  return {
    botToken: 'test-bot-token', adminIds: new Set(),
    reservationTtlMs: 1800000, adminInitDataMaxAgeSeconds: 3600, userInitDataMaxAgeSeconds: 3600,
  };
}

test('GET /api/categories and /api/items serve the catalog', async () => {
  const pool = await createTestPool();
  const category = await categoriesQ.createCategory(pool, { name: 'Верх', sortOrder: 0 });
  const item = await itemsQ.createItem(pool, { categoryId: category.id, name: 'Куртка', price: 1500, size: 'M', conditionText: 'хор.', photos: [] });
  const app = createServer({ pool, config: testConfig(), bot: null });

  const catRes = await request(app).get('/api/categories');
  assert.equal(catRes.status, 200);
  assert.equal(catRes.body.length, 1);

  const itemsRes = await request(app).get('/api/items').query({ categoryId: category.id });
  assert.equal(itemsRes.status, 200);
  assert.equal(itemsRes.body.length, 1);
  assert.equal(itemsRes.body[0].id, item.id);

  const singleRes = await request(app).get(`/api/items/${item.id}`);
  assert.equal(singleRes.status, 200);
  assert.equal(singleRes.body.name, 'Куртка');
});

test('GET /api/items/:id returns 404 for a missing item', async () => {
  const pool = await createTestPool();
  const app = createServer({ pool, config: testConfig(), bot: null });
  const res = await request(app).get('/api/items/9999');
  assert.equal(res.status, 404);
});
