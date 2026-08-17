// tests/initData.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateInitData } = require('../src/initData');
const { buildInitData } = require('./helpers/initData');

const BOT_TOKEN = 'test-bot-token';

test('validateInitData accepts a correctly signed payload', () => {
  const raw = buildInitData({ id: 42, first_name: 'Test' }, BOT_TOKEN);
  const result = validateInitData(raw, BOT_TOKEN, 3600);
  assert.equal(result.valid, true);
  assert.equal(result.user.id, 42);
});

test('validateInitData rejects a tampered hash', () => {
  const raw = buildInitData({ id: 42, first_name: 'Test' }, BOT_TOKEN);
  const tampered = raw.replace(/hash=[0-9a-f]+/, 'hash=deadbeef');
  const result = validateInitData(tampered, BOT_TOKEN, 3600);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'bad_signature');
});

test('validateInitData rejects a signature signed with a different bot token', () => {
  const raw = buildInitData({ id: 42, first_name: 'Test' }, 'a-different-token');
  const result = validateInitData(raw, BOT_TOKEN, 3600);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'bad_signature');
});

test('validateInitData rejects a stale auth_date', () => {
  const oldAuthDate = Math.floor(Date.now() / 1000) - 10000;
  const raw = buildInitData({ id: 42, first_name: 'Test' }, BOT_TOKEN, oldAuthDate);
  const result = validateInitData(raw, BOT_TOKEN, 3600);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'stale_signature');
});

test('validateInitData rejects a missing payload', () => {
  assert.equal(validateInitData(null, BOT_TOKEN, 3600).valid, false);
  assert.equal(validateInitData('', BOT_TOKEN, 3600).valid, false);
});
