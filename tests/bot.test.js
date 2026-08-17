// tests/bot.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatOrderNotification, createBot } = require('../src/bot');

test('formatOrderNotification includes order id, total, and status', () => {
  const text = formatOrderNotification({ id: 7, total: 1500, status: 'ожидает оплаты' });
  assert.match(text, /#7/);
  assert.match(text, /1500/);
  assert.match(text, /ожидает оплаты/);
});

test('createBot returns an object with the expected shape', () => {
  const wrapper = createBot({ token: 'fake:token', adminIds: new Set(['1']) });
  assert.equal(typeof wrapper.notifyNewOrder, 'function');
  assert.equal(typeof wrapper.sendProofPhoto, 'function');
  assert.ok(wrapper.bot);
});
