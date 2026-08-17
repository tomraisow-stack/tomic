// tests/bot.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatOrderNotification, createBot, handleBotError } = require('../src/bot');

const FAKE_BOT_INFO = {
  id: 1, is_bot: true, first_name: 'Test', username: 'test_bot',
  can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
};

function startUpdate() {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 42, type: 'private', first_name: 'T' },
      from: { id: 42, is_bot: false, first_name: 'T' },
      text: '/start',
      entities: [{ type: 'bot_command', offset: 0, length: 6 }],
    },
  };
}

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

test('createBot installs an error handler on the bot instance', () => {
  const wrapper = createBot({ token: 'fake:token', adminIds: new Set(['1']) });
  // grammY's bot.catch just assigns bot.errorHandler; the polling loop calls it
  // instead of rethrowing, which is what keeps a failed update from killing the bot.
  assert.equal(wrapper.bot.errorHandler, handleBotError);
});

test('handleBotError logs the underlying error and does not throw', () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => { logged.push(args); };
  try {
    handleBotError({ error: new Error('boom'), ctx: {} });
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], 'bot error');
  assert.equal(logged[0][1].message, 'boom');
});

test('the /start handler returns its reply promise so a failed reply is surfaced, not floated', async () => {
  const wrapper = createBot({ token: 'fake:token', adminIds: new Set(['1']) });
  wrapper.bot.botInfo = FAKE_BOT_INFO;
  // Intercept every API call locally - nothing goes to the network.
  wrapper.bot.api.config.use(() => Promise.reject(new Error('network down')));

  // If ctx.reply() were floated, handleUpdate would resolve and the rejection
  // would escape as an unhandled rejection instead.
  await assert.rejects(
    () => wrapper.bot.handleUpdate(startUpdate()),
    (err) => {
      assert.equal(err.error.message, 'network down');
      return true;
    }
  );
});
