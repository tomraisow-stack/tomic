// tests/server.config.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestPool } = require('./helpers/testDb');
const { buildInitData } = require('./helpers/initData');
const { createServer } = require('../src/server');

const BOT_TOKEN = 'test-bot-token';

function testConfig(overrides = {}) {
  return {
    botToken: BOT_TOKEN,
    adminIds: new Set(),
    reservationTtlMs: 30 * 60 * 1000,
    adminInitDataMaxAgeSeconds: 3600,
    userInitDataMaxAgeSeconds: 3600,
    ...overrides,
  };
}

test('GET /api/config reports isAdmin correctly', async () => {
  const pool = await createTestPool();
  const config = testConfig({ adminIds: new Set(['42']) });
  const app = createServer({ pool, config, bot: null });

  const adminInitData = buildInitData({ id: 42 }, BOT_TOKEN);
  const adminRes = await request(app).get('/api/config').query({ init_data: adminInitData });
  assert.equal(adminRes.status, 200);
  assert.equal(adminRes.body.isAdmin, true);

  const userInitData = buildInitData({ id: 7 }, BOT_TOKEN);
  const userRes = await request(app).get('/api/config').query({ init_data: userInitData });
  assert.equal(userRes.body.isAdmin, false);
});

test('GET /api/config rejects an unsigned request', async () => {
  const pool = await createTestPool();
  const app = createServer({ pool, config: testConfig(), bot: null });
  const res = await request(app).get('/api/config');
  assert.equal(res.status, 403);
});
