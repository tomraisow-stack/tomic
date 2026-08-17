// scripts/demo.js
//
// Local demo harness — NOT the production entrypoint (that's src/main.js).
// Runs the full Express app + Mini App frontend against an in-memory
// PostgreSQL (pg-mem, same engine the automated tests use) with seeded
// sample data and a stub bot, so the storefront and admin panel can be
// clicked through in a plain desktop browser without a real Postgres
// instance, a real Telegram bot token, or opening it inside Telegram.
//
// Usage: npm run demo   (then open http://localhost:8081)

const crypto = require('crypto');
const { createTestPool } = require('../tests/helpers/testDb');
const { createServer } = require('../src/server');
const { sweepExpiredReservations } = require('../src/reservations');
const categoriesQ = require('../src/queries/categories');
const itemsQ = require('../src/queries/items');

const BOT_TOKEN = 'demo-bot-token';
const DEMO_USER = { id: 1000001, first_name: 'Демо' };
const PORT = Number(process.env.PORT) || 8081;

function buildInitData(user, botToken, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams();
  params.set('user', JSON.stringify(user));
  params.set('auth_date', String(authDate));
  params.set('query_id', 'demo_query_id');
  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push(`${key}=${value}`);
  pairs.sort();
  const dataCheckString = pairs.join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

function stubBot() {
  return {
    async notifyNewOrder(order) {
      console.log(`[demo-bot] новый заказ #${order.id} на ${order.total}₽ (уведомление админу в реальном боте)`);
    },
    async sendProofPhoto(orderId, buffer) {
      console.log(`[demo-bot] чек по заказу #${orderId} получен (${buffer.length} байт), в реальном боте ушёл бы админу`);
      return `demo_file_${orderId}_${Date.now()}`;
    },
  };
}

const PHOTO_POOL = [
  'https://picsum.photos/seed/atg-a/600/800',
  'https://picsum.photos/seed/atg-b/600/800',
  'https://picsum.photos/seed/atg-c/600/800',
  'https://picsum.photos/seed/atg-d/600/800',
  'https://picsum.photos/seed/atg-e/600/800',
  'https://picsum.photos/seed/atg-f/600/800',
];

function photosFor(index) {
  const first = PHOTO_POOL[index % PHOTO_POOL.length];
  const second = PHOTO_POOL[(index + 2) % PHOTO_POOL.length];
  return [first, second];
}

const SEED = {
  categories: [
    { name: 'Верх', sortOrder: 0 },
    { name: 'Низ', sortOrder: 1 },
    { name: 'Обувь', sortOrder: 2 },
    { name: 'Аксессуары', sortOrder: 3 },
  ],
  items: [
    { cat: 'Верх', name: 'Косуха из тёмно-коричневой кожи', price: 4200, size: 'M', conditionText: 'Отличное состояние, почти новая, без потёртостей. Носили пару раз.' },
    { cat: 'Верх', name: 'Оверсайз худи, серый меланж', price: 1300, size: 'L', conditionText: 'Хорошее состояние, есть небольшой катышек на рукаве.' },
    { cat: 'Верх', name: 'Джинсовая куртка, светлый деним', price: 2100, size: 'S', conditionText: 'Отличное состояние, как новая.' },
    { cat: 'Верх', name: 'Вязаный свитер, тёмно-зелёный', price: 1500, size: 'M', conditionText: 'Хорошее состояние, немного растянут ворот.' },
    { cat: 'Низ', name: 'Джинсы прямого кроя, синие', price: 1600, size: '48', conditionText: 'Хорошее состояние.' },
    { cat: 'Низ', name: 'Карго-брюки, хаки', price: 1900, size: 'M', conditionText: 'Отличное состояние, все карманы рабочие.' },
    { cat: 'Низ', name: 'Юбка миди, чёрная', price: 900, size: 'S', conditionText: 'Хорошее состояние.' },
    { cat: 'Обувь', name: 'Кроссовки New Balance 574', price: 3200, size: '42', conditionText: 'Хорошее состояние, подошва без сильного износа.' },
    { cat: 'Обувь', name: 'Челси, чёрная кожа', price: 2800, size: '40', conditionText: 'Отличное состояние.' },
    { cat: 'Обувь', name: 'Кеды Converse Chuck 70', price: 2200, size: '39', conditionText: 'Хорошее состояние, есть лёгкие потёртости на носке.' },
    { cat: 'Аксессуары', name: 'Кожаный ремень, коричневый', price: 500, size: '105 см', conditionText: 'Отличное состояние.' },
    { cat: 'Аксессуары', name: 'Шарф шерстяной, клетка', price: 400, size: 'один размер', conditionText: 'Хорошее состояние.' },
  ],
};

async function seed(pool) {
  const categoriesByName = {};
  for (const c of SEED.categories) {
    categoriesByName[c.name] = await categoriesQ.createCategory(pool, c);
  }
  let i = 0;
  for (const item of SEED.items) {
    await itemsQ.createItem(pool, {
      categoryId: categoriesByName[item.cat].id,
      name: item.name,
      price: item.price,
      size: item.size,
      conditionText: item.conditionText,
      photos: photosFor(i),
    });
    i += 1;
  }
}

async function main() {
  const pool = await createTestPool();
  await seed(pool);

  const config = {
    botToken: BOT_TOKEN,
    adminIds: new Set([String(DEMO_USER.id)]),
    reservationTtlMs: 30 * 60 * 1000,
    adminInitDataMaxAgeSeconds: 30 * 24 * 3600,
    userInitDataMaxAgeSeconds: 7 * 24 * 3600,
  };

  const app = createServer({ pool, config, bot: stubBot() });

  // Demo-only: hands the browser a validly-signed initData string so the
  // Mini App works outside Telegram, where window.Telegram.WebApp.initData
  // is always empty. Never exists in production (src/main.js never adds
  // this route).
  const demoInitData = buildInitData(DEMO_USER, BOT_TOKEN);
  app.get('/api/demo/init-data', (req, res) => res.json({ initData: demoInitData }));

  setInterval(() => {
    sweepExpiredReservations(pool).catch((err) => console.error('demo sweep failed', err));
  }, 60 * 1000);

  app.listen(PORT, () => {
    console.log(`\nAtgshmot Shop — DEMO режим`);
    console.log(`Открой в браузере: http://localhost:${PORT}`);
    console.log(`(данные в памяти, реальный Postgres/бот не нужны — при перезапуске каталог и заказы сбрасываются к сиду)\n`);
  });
}

main().catch((err) => {
  console.error('demo failed to start', err);
  process.exit(1);
});
