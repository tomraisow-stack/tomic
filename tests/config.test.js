const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('loadConfig reads and normalizes env vars', () => {
  const config = loadConfig({
    BOT_TOKEN: 'abc:123',
    DATABASE_URL: 'postgres://localhost/test',
    ADMIN_IDS: '111, 222 ,333',
    PORT: '9090',
    RESERVATION_TTL_MINUTES: '15',
  });
  assert.equal(config.botToken, 'abc:123');
  assert.equal(config.databaseUrl, 'postgres://localhost/test');
  assert.deepEqual([...config.adminIds].sort(), ['111', '222', '333']);
  assert.equal(config.port, 9090);
  assert.equal(config.reservationTtlMs, 15 * 60 * 1000);
});

test('loadConfig throws when a required var is missing', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: 'x' }), /BOT_TOKEN/);
});

test('loadConfig applies defaults for optional vars', () => {
  const config = loadConfig({ BOT_TOKEN: 'a', DATABASE_URL: 'b' });
  assert.equal(config.port, 8080);
  assert.equal(config.reservationTtlMs, 30 * 60 * 1000);
  assert.equal(config.adminInitDataMaxAgeSeconds, 30 * 24 * 3600);
  assert.equal(config.userInitDataMaxAgeSeconds, 7 * 24 * 3600);
  assert.equal(config.adminIds.size, 0);
});
