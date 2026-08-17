// src/main.js
// This is the process entrypoint that wires the entire application.
// To run this file successfully, you need:
// 1. A reachable PostgreSQL instance (DATABASE_URL env var)
// 2. A real Telegram bot token (BOT_TOKEN env var)
// End-to-end verification (npm start, confirm "listening on port" log and bot starts without auth errors)
// will happen once deployed to the VPS in the deployment plan.

require('dotenv').config();
const { loadConfig } = require('./config');
const { createPool, initSchema } = require('./db');
const { createServer } = require('./server');
const { createBot } = require('./bot');
const { sweepExpiredReservations } = require('./reservations');

async function main() {
  const config = loadConfig(process.env);
  const pool = createPool(config.databaseUrl);
  await initSchema(pool);

  const botWrapper = createBot({ token: config.botToken, adminIds: config.adminIds });
  const app = createServer({ pool, config, bot: botWrapper });

  app.listen(config.port, () => {
    console.log(`Atgshmot Shop server listening on port ${config.port}`);
  });

  botWrapper.bot.start().catch((err) => {
    console.error('bot polling failed', err);
  });

  setInterval(() => {
    sweepExpiredReservations(pool).catch((err) => {
      console.error('reservation sweep failed', err);
    });
  }, 60 * 1000);
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
