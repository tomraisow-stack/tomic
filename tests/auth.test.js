// tests/auth.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { requireUser, requireAdmin } = require('../src/auth');
const { buildInitData } = require('./helpers/initData');

const BOT_TOKEN = 'test-bot-token';

function fakeReqRes(initData) {
  const req = { get: () => initData, query: {} };
  let statusCode = null;
  let jsonBody = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { jsonBody = body; return this; },
  };
  return { req, res, getResult: () => ({ statusCode, jsonBody }) };
}

test('requireUser allows a validly signed request and sets req.telegramUser', () => {
  const raw = buildInitData({ id: 42 }, BOT_TOKEN);
  const middleware = requireUser({ botToken: BOT_TOKEN, maxAgeSeconds: 3600 });
  const { req, res } = fakeReqRes(raw);
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.telegramUser.id, 42);
});

test('requireUser rejects an invalid signature with 403', () => {
  const middleware = requireUser({ botToken: BOT_TOKEN, maxAgeSeconds: 3600 });
  const { req, res, getResult } = fakeReqRes('garbage');
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(getResult().statusCode, 403);
});

test('requireAdmin allows a known admin id', () => {
  const raw = buildInitData({ id: 42 }, BOT_TOKEN);
  const middleware = requireAdmin({ botToken: BOT_TOKEN, adminIds: new Set(['42']), maxAgeSeconds: 3600 });
  const { req, res } = fakeReqRes(raw);
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('requireAdmin rejects a validly-signed non-admin user', () => {
  const raw = buildInitData({ id: 999 }, BOT_TOKEN);
  const middleware = requireAdmin({ botToken: BOT_TOKEN, adminIds: new Set(['42']), maxAgeSeconds: 3600 });
  const { req, res, getResult } = fakeReqRes(raw);
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(getResult().statusCode, 403);
});
