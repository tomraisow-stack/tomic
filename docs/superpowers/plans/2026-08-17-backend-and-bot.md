# Atgshmot Shop — Backend & Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the REST API + Telegram bot + PostgreSQL data layer for the
Atgshmot second-hand clothing shop — item catalog, atomic cart reservation
(prevents double-selling a one-of-a-kind item), checkout, payment-proof
upload, and an admin action layer — fully testable and runnable locally
without the frontend webapp.

**Architecture:** A single Node.js process (`src/main.js`) wires together a
PostgreSQL connection pool, an Express REST API (`src/server.js`), and a
grammY bot (`src/bot.js`) used only for admin notifications and proof-photo
relaying — no chat-based ordering flow. Query logic lives in
`src/queries/*.js`, one file per table group, each function taking an
explicit `pool` argument so tests can inject an in-memory PostgreSQL
(`pg-mem`) instead of a real server. Admin-only compound actions
(confirm/cancel/mark-done) live in `src/adminActions.js`, shared by nothing
else yet but structured so the future admin *and* any future chat-based
admin path could reuse them without duplicating logic — mirroring the
`do_*` pattern that worked well in the sister `shop-mini-app` project.

**Tech Stack:** Node.js >= 18, Express 4, grammY, `pg` (raw SQL, no ORM),
`multer` (multipart photo upload), `dotenv`. Tests: Node's built-in
`node:test` + `assert`, `supertest` for HTTP-level tests, `pg-mem` as an
in-memory PostgreSQL for all automated tests (no local Postgres install
required — confirmed with the user, real Postgres is server-only).

**Spec:** `docs/superpowers/specs/2026-08-17-atgshmot-shop-design.md`

## Global Constraints

- Node.js >= 18 (grammY requirement) — the VPS needs this installed via
  `nvm`, per the spec's deployment section (not part of this plan).
- No ORM. All SQL is raw, parameterized, written directly against `pg`.
- Payment is by requisites + receipt photo upload — no Telegram Payments
  integration anywhere in this codebase.
- Item status is exactly one of: `'available'`, `'reserved'`, `'sold'`
  (these literal strings, used verbatim in SQL and JS — no other values).
- Order status is exactly one of (Russian, verbatim):
  `'ожидает оплаты'`, `'оплачен'`, `'отменён'`, `'выполнен'`.
- Reservation TTL defaults to 30 minutes, configurable via
  `RESERVATION_TTL_MINUTES` env var.
- Every admin endpoint independently re-validates the Telegram `initData`
  HMAC signature and checks the caller's id against `ADMIN_IDS` — never
  trust a client-reported "I'm an admin" flag as the real gate.
- Sort options are exactly `price_asc`, `price_desc`, `new` — no
  "popularity" sort (each item sells once, so there is no honest
  popularity signal — see spec's "Explicitly out of scope").
- Size is a free-text field per item, not a size-grid/stock system.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `README.md`
- Create: `src/` (empty dir, populated by later tasks)
- Create: `tests/` (empty dir, populated by later tasks)

**Interfaces:**
- Produces: `npm test` (runs `node --test tests/`), `npm start` (runs
  `node src/main.js`), `npm run dev` (runs `node --watch src/main.js`) —
  every later task relies on these scripts existing.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "atgshmot-shop",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "engines": { "node": ">=18" },
  "scripts": {
    "start": "node src/main.js",
    "dev": "node --watch src/main.js",
    "test": "node --test tests/"
  },
  "dependencies": {
    "express": "^4.19.2",
    "grammy": "^1.24.0",
    "pg": "^8.12.0",
    "dotenv": "^16.4.5",
    "multer": "^1.4.5-lts.1"
  },
  "devDependencies": {
    "pg-mem": "^2.9.0",
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors. If any package version above
is unavailable, install the latest version in the same major line instead
(e.g. `npm install express@4 grammy@1 pg@8 dotenv@16 multer@1 --save` and
`npm install pg-mem@2 supertest@7 --save-dev`) — do not silently jump to
an incompatible major version.

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
.env
*.log
```

- [ ] **Step 4: Create `.env.example`**

```
BOT_TOKEN=123456:your-bot-token-here
DATABASE_URL=postgres://user:password@localhost:5432/atgshmot
ADMIN_IDS=971604088
PORT=8080
RESERVATION_TTL_MINUTES=30
ADMIN_INITDATA_MAX_AGE_SECONDS=2592000
USER_INITDATA_MAX_AGE_SECONDS=604800
```

- [ ] **Step 5: Create `README.md`**

```markdown
# Atgshmot Shop — backend

Second-hand clothing shop Telegram bot + Mini App API.

## Local development

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `BOT_TOKEN` (from
   @BotFather) and `ADMIN_IDS` (your Telegram numeric id). `DATABASE_URL`
   needs a real PostgreSQL instance reachable from your machine — this
   project has none bundled; automated tests instead use `pg-mem`, an
   in-memory PostgreSQL emulator, so `npm test` works without installing
   PostgreSQL.
3. `npm run dev` — starts the API + bot with auto-reload.
4. `npm test` — runs the full test suite against `pg-mem`.

## Project layout

- `src/queries/` — one file per table group, raw parameterized SQL.
- `src/server.js` — Express app and all `/api/*` routes.
- `src/bot.js` — grammY bot: admin notifications + proof-photo relaying.
- `src/adminActions.js` — shared confirm/cancel/mark-done logic.
- `src/main.js` — process entrypoint, wires everything together.
- `webapp/` — Mini App frontend (built in a separate plan).
```

- [ ] **Step 6: Create empty `src/` and `tests/` directories**

Run: `mkdir src tests tests/helpers tests/queries src/queries`

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example README.md src tests
git commit -m "chore: scaffold Atgshmot Shop backend project"
```

---

## Task 2: Config loading

**Files:**
- Create: `src/config.js`
- Test: `tests/config.test.js`

**Interfaces:**
- Produces: `loadConfig(env) -> { botToken, databaseUrl, adminIds: Set<string>, port, reservationTtlMs, adminInitDataMaxAgeSeconds, userInitDataMaxAgeSeconds }`. Every later module that needs configuration takes this shape as an argument — no module reads `process.env` directly except `src/main.js`.

- [ ] **Step 1: Write the failing test**

```js
// tests/config.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/config'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/config.js
function loadConfig(env) {
  function required(name) {
    const value = env[name];
    if (!value) throw new Error(`Missing required env var: ${name}`);
    return value;
  }
  return {
    botToken: required('BOT_TOKEN'),
    databaseUrl: required('DATABASE_URL'),
    adminIds: new Set(
      (env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)
    ),
    port: Number(env.PORT || 8080),
    reservationTtlMs: Number(env.RESERVATION_TTL_MINUTES || 30) * 60 * 1000,
    adminInitDataMaxAgeSeconds: Number(
      env.ADMIN_INITDATA_MAX_AGE_SECONDS || 30 * 24 * 3600
    ),
    userInitDataMaxAgeSeconds: Number(
      env.USER_INITDATA_MAX_AGE_SECONDS || 7 * 24 * 3600
    ),
  };
}

module.exports = { loadConfig };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config.js tests/config.test.js
git commit -m "feat: add config loader"
```

---

## Task 3: Database pool + schema

**Files:**
- Create: `src/db.js`
- Create: `src/schema.sql`
- Create: `tests/helpers/testDb.js`
- Test: `tests/db.test.js`

**Interfaces:**
- Produces: `createPool(connectionString) -> pg.Pool` (real Postgres, used
  only by `src/main.js`), `initSchema(pool) -> Promise<void>` (runs
  `schema.sql`, used by both production and tests), and
  `tests/helpers/testDb.js`'s `createTestPool() -> Promise<pg.Pool>` (an
  in-memory `pg-mem`-backed pool with the schema already applied) — every
  later query-layer test imports `createTestPool` from this file.

- [ ] **Step 1: Write the failing test**

```js
// tests/db.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool } = require('./helpers/testDb');

test('initSchema creates all expected tables', async () => {
  const pool = await createTestPool();
  const tables = ['categories', 'items', 'cart_reservations', 'orders', 'order_items', 'payment_proofs'];
  for (const table of tables) {
    const result = await pool.query(`SELECT * FROM ${table} LIMIT 1`);
    assert.equal(result.rows.length, 0, `table ${table} should exist and be empty`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './helpers/testDb'`

- [ ] **Step 3: Write `src/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  size TEXT NOT NULL DEFAULT '',
  condition_text TEXT NOT NULL DEFAULT '',
  photos JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cart_reservations (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL UNIQUE REFERENCES items(id),
  user_id BIGINT NOT NULL,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  fio TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ожидает оплаты',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  price_at_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_proofs (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  telegram_file_id TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Note: status values are deliberately enforced only in application code
(`src/queries/*.js`), not via SQL `CHECK` constraints — `pg-mem`'s CHECK
support is inconsistent across versions and this isn't worth risking a
false test failure over. If, when running the test in Step 6, `pg-mem`
also errors on the `REFERENCES` foreign keys, remove those specific
`REFERENCES categories(id)` / `REFERENCES orders(id)` / `REFERENCES
items(id)` clauses (keep the plain column definitions) — real PostgreSQL
in production still gets the same guarantees enforced at the application
layer by the query functions built in later tasks.

- [ ] **Step 4: Write `src/db.js`**

```js
// src/db.js
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function createPool(connectionString) {
  return new Pool({ connectionString });
}

async function initSchema(pool) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
}

module.exports = { createPool, initSchema };
```

- [ ] **Step 5: Write `tests/helpers/testDb.js`**

```js
// tests/helpers/testDb.js
const { newDb } = require('pg-mem');
const { initSchema } = require('../../src/db');

async function createTestPool() {
  const memDb = newDb();
  const { Pool } = memDb.adapters.createPg();
  const pool = new Pool();
  await initSchema(pool);
  return pool;
}

module.exports = { createTestPool };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS. If it fails on `REFERENCES`, apply the Step 3 fallback
note and re-run.

- [ ] **Step 7: Commit**

```bash
git add src/db.js src/schema.sql tests/db.test.js tests/helpers/testDb.js
git commit -m "feat: add PostgreSQL schema and connection pool"
```

---

## Task 4: Categories queries

**Files:**
- Create: `src/queries/categories.js`
- Test: `tests/queries/categories.test.js`

**Interfaces:**
- Consumes: `createTestPool()` from Task 3.
- Produces: `listCategories(pool) -> Promise<{id, name, sort_order}[]>`,
  `createCategory(pool, {name, sortOrder}) -> Promise<{id, name, sort_order}>`,
  `updateCategory(pool, id, {name, sortOrder}) -> Promise<{id, name, sort_order}|null>`,
  `deleteCategory(pool, id) -> Promise<boolean>` — used by the catalog and
  admin routes in Task 13/16.

- [ ] **Step 1: Write the failing test**

```js
// tests/queries/categories.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool } = require('../helpers/testDb');
const categoriesQ = require('../../src/queries/categories');

test('create, list, update, delete category', async () => {
  const pool = await createTestPool();

  const created = await categoriesQ.createCategory(pool, { name: 'Верх', sortOrder: 1 });
  assert.equal(created.name, 'Верх');

  let list = await categoriesQ.listCategories(pool);
  assert.equal(list.length, 1);

  const updated = await categoriesQ.updateCategory(pool, created.id, { name: 'Верх (куртки)', sortOrder: 2 });
  assert.equal(updated.name, 'Верх (куртки)');

  const deleted = await categoriesQ.deleteCategory(pool, created.id);
  assert.equal(deleted, true);

  list = await categoriesQ.listCategories(pool);
  assert.equal(list.length, 0);
});

test('updateCategory returns null for a missing id', async () => {
  const pool = await createTestPool();
  const result = await categoriesQ.updateCategory(pool, 999, { name: 'x', sortOrder: 0 });
  assert.equal(result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../src/queries/categories'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/queries/categories.js
async function listCategories(pool) {
  const { rows } = await pool.query(
    'SELECT id, name, sort_order FROM categories ORDER BY sort_order, id'
  );
  return rows;
}

async function createCategory(pool, { name, sortOrder = 0 }) {
  const { rows } = await pool.query(
    'INSERT INTO categories (name, sort_order) VALUES ($1, $2) RETURNING id, name, sort_order',
    [name, sortOrder]
  );
  return rows[0];
}

async function updateCategory(pool, id, { name, sortOrder }) {
  const { rows } = await pool.query(
    'UPDATE categories SET name = $2, sort_order = $3 WHERE id = $1 RETURNING id, name, sort_order',
    [id, name, sortOrder]
  );
  return rows[0] || null;
}

async function deleteCategory(pool, id) {
  const { rowCount } = await pool.query('DELETE FROM categories WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = { listCategories, createCategory, updateCategory, deleteCategory };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/queries/categories.js tests/queries/categories.test.js
git commit -m "feat: add category queries"
```

---

## Task 5: Item queries (CRUD + filtered listing)

**Files:**
- Create: `src/queries/items.js`
- Test: `tests/queries/items.test.js`

**Interfaces:**
- Consumes: `createTestPool()` (Task 3), `createCategory(pool, {name})`
  (Task 4).
- Produces: `listItems(pool, {categoryId, size, sort, search, status}) ->
  Promise<Item[]>` (public catalog, defaults `status: 'available'`),
  `listItemsAdmin(pool, {categoryId}) -> Promise<Item[]>` (all statuses),
  `getItem(pool, id) -> Promise<Item|null>`, `createItem(pool, {categoryId,
  name, price, size, conditionText, photos}) -> Promise<Item>`,
  `updateItem(pool, id, {categoryId, name, price, size, conditionText,
  photos}) -> Promise<Item|null>`, `deleteItem(pool, id) ->
  Promise<boolean>`, where `Item = {id, category_id, name, price, size,
  condition_text, photos, status, created_at}`. These are consumed by
  Task 6 (reservation), Task 13 (catalog routes) and Task 16 (admin
  routes).

- [ ] **Step 1: Write the failing test**

```js
// tests/queries/items.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool } = require('../helpers/testDb');
const categoriesQ = require('../../src/queries/categories');
const itemsQ = require('../../src/queries/items');

async function setupCategory(pool, name = 'Верх') {
  return categoriesQ.createCategory(pool, { name, sortOrder: 0 });
}

test('createItem defaults status to available', async () => {
  const pool = await createTestPool();
  const category = await setupCategory(pool);
  const item = await itemsQ.createItem(pool, {
    categoryId: category.id, name: 'Куртка', price: 1500,
    size: 'M', conditionText: 'хорошее', photos: ['file1'],
  });
  assert.equal(item.status, 'available');
  assert.deepEqual(item.photos, ['file1']);
});

test('listItems defaults to available-only and filters by category/size/search', async () => {
  const pool = await createTestPool();
  const top = await setupCategory(pool, 'Верх');
  const bottom = await setupCategory(pool, 'Низ');
  const jacket = await itemsQ.createItem(pool, { categoryId: top.id, name: 'Куртка кожаная', price: 3000, size: 'M', conditionText: 'отл.', photos: [] });
  await itemsQ.createItem(pool, { categoryId: top.id, name: 'Свитер', price: 800, size: 'L', conditionText: 'хор.', photos: [] });
  await itemsQ.createItem(pool, { categoryId: bottom.id, name: 'Джинсы', price: 1200, size: 'M', conditionText: 'хор.', photos: [] });

  const inTop = await itemsQ.listItems(pool, { categoryId: top.id });
  assert.equal(inTop.length, 2);

  const sizeM = await itemsQ.listItems(pool, { categoryId: top.id, size: 'M' });
  assert.equal(sizeM.length, 1);
  assert.equal(sizeM[0].id, jacket.id);

  const found = await itemsQ.listItems(pool, { search: 'кожан' });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, jacket.id);
});

test('listItems sorts by price_asc, price_desc, new', async () => {
  const pool = await createTestPool();
  const category = await setupCategory(pool);
  const cheap = await itemsQ.createItem(pool, { categoryId: category.id, name: 'A', price: 100, size: 'S', conditionText: '', photos: [] });
  const expensive = await itemsQ.createItem(pool, { categoryId: category.id, name: 'B', price: 900, size: 'S', conditionText: '', photos: [] });

  const asc = await itemsQ.listItems(pool, { sort: 'price_asc' });
  assert.deepEqual(asc.map((i) => i.id), [cheap.id, expensive.id]);

  const desc = await itemsQ.listItems(pool, { sort: 'price_desc' });
  assert.deepEqual(desc.map((i) => i.id), [expensive.id, cheap.id]);
});

test('listItems excludes non-available items by default; listItemsAdmin includes everything', async () => {
  const pool = await createTestPool();
  const category = await setupCategory(pool);
  const item = await itemsQ.createItem(pool, { categoryId: category.id, name: 'A', price: 100, size: 'S', conditionText: '', photos: [] });
  await pool.query("UPDATE items SET status = 'sold' WHERE id = $1", [item.id]);

  const publicList = await itemsQ.listItems(pool);
  assert.equal(publicList.length, 0);

  const adminList = await itemsQ.listItemsAdmin(pool, {});
  assert.equal(adminList.length, 1);
});

test('updateItem replaces fields; deleteItem removes the row', async () => {
  const pool = await createTestPool();
  const category = await setupCategory(pool);
  const item = await itemsQ.createItem(pool, { categoryId: category.id, name: 'A', price: 100, size: 'S', conditionText: '', photos: [] });

  const updated = await itemsQ.updateItem(pool, item.id, {
    categoryId: category.id, name: 'A (обновлено)', price: 150, size: 'M', conditionText: 'новое', photos: ['x'],
  });
  assert.equal(updated.name, 'A (обновлено)');
  assert.equal(updated.price, 150);

  const deleted = await itemsQ.deleteItem(pool, item.id);
  assert.equal(deleted, true);
  assert.equal(await itemsQ.getItem(pool, item.id), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../src/queries/items'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/queries/items.js
const ALLOWED_SORTS = {
  price_asc: 'price ASC',
  price_desc: 'price DESC',
  new: 'created_at DESC',
};

const SELECT_COLUMNS = 'id, category_id, name, price, size, condition_text, photos, status, created_at';

async function listItems(pool, { categoryId, size, sort = 'new', search, status = 'available' } = {}) {
  const clauses = [];
  const params = [];
  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (categoryId) {
    params.push(categoryId);
    clauses.push(`category_id = $${params.length}`);
  }
  if (size) {
    params.push(size);
    clauses.push(`size = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`name ILIKE $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderBy = ALLOWED_SORTS[sort] || ALLOWED_SORTS.new;
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM items ${where} ORDER BY ${orderBy}`,
    params
  );
  return rows;
}

async function listItemsAdmin(pool, { categoryId } = {}) {
  const clauses = [];
  const params = [];
  if (categoryId) {
    params.push(categoryId);
    clauses.push(`category_id = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM items ${where} ORDER BY created_at DESC`,
    params
  );
  return rows;
}

async function getItem(pool, id) {
  const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} FROM items WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function createItem(pool, { categoryId, name, price, size, conditionText, photos = [] }) {
  const { rows } = await pool.query(
    `INSERT INTO items (category_id, name, price, size, condition_text, photos, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'available')
     RETURNING ${SELECT_COLUMNS}`,
    [categoryId, name, price, size, conditionText, JSON.stringify(photos)]
  );
  return rows[0];
}

async function updateItem(pool, id, { categoryId, name, price, size, conditionText, photos }) {
  const { rows } = await pool.query(
    `UPDATE items SET category_id = $2, name = $3, price = $4, size = $5, condition_text = $6, photos = $7
     WHERE id = $1
     RETURNING ${SELECT_COLUMNS}`,
    [id, categoryId, name, price, size, conditionText, JSON.stringify(photos)]
  );
  return rows[0] || null;
}

async function deleteItem(pool, id) {
  const { rowCount } = await pool.query('DELETE FROM items WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = { listItems, listItemsAdmin, getItem, createItem, updateItem, deleteItem };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/queries/items.js tests/queries/items.test.js
git commit -m "feat: add item CRUD and filtered listing queries"
```

---

## Task 6: Atomic item reservation

**Files:**
- Modify: `src/queries/items.js` (add reservation functions)
- Modify: `tests/queries/items.test.js` (add reservation tests)

**Interfaces:**
- Consumes: `createTestPool()`, `createCategory`, `createItem` (Tasks 3-5).
- Produces: `reserveItem(pool, itemId, userId, ttlMs) ->
  Promise<{id, item_id, user_id, expires_at}|null>` (null means the item
  was not `'available'`), `releaseItem(pool, itemId) -> Promise<void>`
  (flips a `'reserved'` item back to `'available'`, no-op otherwise),
  `markItemSold(pool, itemId) -> Promise<void>`. These are the functions
  that make the "don't double-sell a unique item" guarantee from the
  spec — Task 7 (reservation sweep), Task 9 (admin actions), and Task 14
  (cart routes) all depend on them.

- [ ] **Step 1: Write the failing test**

```js
// append to tests/queries/items.test.js

test('reserveItem: only one concurrent reservation succeeds for the same item', async () => {
  const pool = await createTestPool();
  const category = await setupCategory(pool);
  const item = await itemsQ.createItem(pool, { categoryId: category.id, name: 'Куртка', price: 1500, size: 'M', conditionText: 'хор.', photos: [] });

  const [first, second] = await Promise.all([
    itemsQ.reserveItem(pool, item.id, 111, 30 * 60 * 1000),
    itemsQ.reserveItem(pool, item.id, 222, 30 * 60 * 1000),
  ]);

  const succeeded = [first, second].filter(Boolean);
  assert.equal(succeeded.length, 1);

  const reloaded = await itemsQ.getItem(pool, item.id);
  assert.equal(reloaded.status, 'reserved');
});

test('reserveItem returns null for an already-sold item', async () => {
  const pool = await createTestPool();
  const category = await setupCategory(pool);
  const item = await itemsQ.createItem(pool, { categoryId: category.id, name: 'A', price: 100, size: 'S', conditionText: '', photos: [] });
  await pool.query("UPDATE items SET status = 'sold' WHERE id = $1", [item.id]);

  const result = await itemsQ.reserveItem(pool, item.id, 111, 1000);
  assert.equal(result, null);
});

test('releaseItem flips a reserved item back to available; no-op on a sold item', async () => {
  const pool = await createTestPool();
  const category = await setupCategory(pool);
  const item = await itemsQ.createItem(pool, { categoryId: category.id, name: 'A', price: 100, size: 'S', conditionText: '', photos: [] });
  await itemsQ.reserveItem(pool, item.id, 111, 1000);

  await itemsQ.releaseItem(pool, item.id);
  assert.equal((await itemsQ.getItem(pool, item.id)).status, 'available');

  await pool.query("UPDATE items SET status = 'sold' WHERE id = $1", [item.id]);
  await itemsQ.releaseItem(pool, item.id);
  assert.equal((await itemsQ.getItem(pool, item.id)).status, 'sold');
});

test('markItemSold sets status to sold', async () => {
  const pool = await createTestPool();
  const category = await setupCategory(pool);
  const item = await itemsQ.createItem(pool, { categoryId: category.id, name: 'A', price: 100, size: 'S', conditionText: '', photos: [] });
  await itemsQ.markItemSold(pool, item.id);
  assert.equal((await itemsQ.getItem(pool, item.id)).status, 'sold');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `itemsQ.reserveItem is not a function`

- [ ] **Step 3: Add reservation functions to `src/queries/items.js`**

```js
// append to src/queries/items.js, before module.exports

async function reserveItem(pool, itemId, userId, ttlMs) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updateRes = await client.query(
      `UPDATE items SET status = 'reserved' WHERE id = $1 AND status = 'available' RETURNING id`,
      [itemId]
    );
    if (updateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const expiresAt = new Date(Date.now() + ttlMs);
    const reservationRes = await client.query(
      `INSERT INTO cart_reservations (item_id, user_id, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id, item_id, user_id, expires_at`,
      [itemId, userId, expiresAt]
    );
    await client.query('COMMIT');
    return reservationRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function releaseItem(pool, itemId) {
  await pool.query(`UPDATE items SET status = 'available' WHERE id = $1 AND status = 'reserved'`, [itemId]);
}

async function markItemSold(pool, itemId) {
  await pool.query(`UPDATE items SET status = 'sold' WHERE id = $1`, [itemId]);
}
```

Update the `module.exports` line to:

```js
module.exports = {
  listItems, listItemsAdmin, getItem, createItem, updateItem, deleteItem,
  reserveItem, releaseItem, markItemSold,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. If `pool.connect()` is unsupported by the `pg-mem`
adapter, replace the transaction with a single conditional `UPDATE ...
WHERE status = 'available' RETURNING id` on `pool` directly followed by
a plain (non-transactional) `INSERT` — the `UPDATE`'s `WHERE` clause
alone is what makes the operation atomic against a second concurrent
caller; the surrounding `BEGIN`/`COMMIT` is defense in depth, not the
core guarantee. Re-run the concurrency test after making this change to
confirm the guarantee still holds.

- [ ] **Step 5: Commit**

```bash
git add src/queries/items.js tests/queries/items.test.js
git commit -m "feat: add atomic item reservation to prevent double-selling"
```

---

## Task 7: Reservation expiry sweep

**Files:**
- Create: `src/reservations.js`
- Test: `tests/reservations.test.js`

**Interfaces:**
- Consumes: `reserveItem`, `getItem` (Task 6).
- Produces: `sweepExpiredReservations(pool) -> Promise<number>` (returns
  count of swept reservations). Wired into `src/main.js` on a 60-second
  interval in Task 18.

- [ ] **Step 1: Write the failing test**

```js
// tests/reservations.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool } = require('./helpers/testDb');
const categoriesQ = require('../src/queries/categories');
const itemsQ = require('../src/queries/items');
const { sweepExpiredReservations } = require('../src/reservations');

test('sweepExpiredReservations releases only expired reservations', async () => {
  const pool = await createTestPool();
  const category = await categoriesQ.createCategory(pool, { name: 'Верх' });
  const expiredItem = await itemsQ.createItem(pool, { categoryId: category.id, name: 'A', price: 100, size: 'S', conditionText: '', photos: [] });
  const freshItem = await itemsQ.createItem(pool, { categoryId: category.id, name: 'B', price: 100, size: 'S', conditionText: '', photos: [] });

  await itemsQ.reserveItem(pool, expiredItem.id, 111, -1000); // already expired
  await itemsQ.reserveItem(pool, freshItem.id, 222, 30 * 60 * 1000); // not expired

  const swept = await sweepExpiredReservations(pool);
  assert.equal(swept, 1);

  assert.equal((await itemsQ.getItem(pool, expiredItem.id)).status, 'available');
  assert.equal((await itemsQ.getItem(pool, freshItem.id)).status, 'reserved');

  const remainingReservations = await pool.query('SELECT * FROM cart_reservations');
  assert.equal(remainingReservations.rows.length, 1);
});

test('sweepExpiredReservations is a no-op when nothing is expired', async () => {
  const pool = await createTestPool();
  const swept = await sweepExpiredReservations(pool);
  assert.equal(swept, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/reservations'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/reservations.js
async function sweepExpiredReservations(pool) {
  const { rows } = await pool.query(
    'SELECT id, item_id FROM cart_reservations WHERE expires_at < now()'
  );
  let swept = 0;
  for (const row of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM cart_reservations WHERE id = $1', [row.id]);
      await client.query(
        `UPDATE items SET status = 'available' WHERE id = $1 AND status = 'reserved'`,
        [row.item_id]
      );
      await client.query('COMMIT');
      swept += 1;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  return swept;
}

module.exports = { sweepExpiredReservations };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/reservations.js tests/reservations.test.js
git commit -m "feat: add expired-reservation sweep"
```

---

## Task 8: Order queries

**Files:**
- Create: `src/queries/orders.js`
- Test: `tests/queries/orders.test.js`

**Interfaces:**
- Consumes: `createTestPool`, `createCategory`, `createItem`,
  `reserveItem` (Tasks 3-6).
- Produces: `getUserCartReservations(pool, userId) ->
  Promise<{reservation_id, item_id, expires_at, name, price, size,
  photos}[]>`, `createOrder(pool, {userId, fio, phone, address}) ->
  Promise<{order}|{itemCount}|{error: 'empty_cart'}>`, `getOrder(pool, id)
  -> Promise<{id, user_id, fio, phone, address, total, status, created_at,
  items: {item_id, price_at_order, name, size, photos}[]}|null>`,
  `listOrdersForUser(pool, userId, limit) -> Promise<Order[]>`,
  `listOrdersAdmin(pool, {status}) -> Promise<Order[]>`,
  `setOrderStatus(pool, id, status) -> Promise<{id, status}|null>`,
  `deleteOrder(pool, id) -> Promise<boolean>`, `addPaymentProof(pool,
  orderId, telegramFileId) -> Promise<{id, order_id, telegram_file_id,
  uploaded_at}>`. Consumed by Task 9 (admin actions) and Tasks 14-16
  (routes).

- [ ] **Step 1: Write the failing test**

```js
// tests/queries/orders.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool } = require('../helpers/testDb');
const categoriesQ = require('../../src/queries/categories');
const itemsQ = require('../../src/queries/items');
const ordersQ = require('../../src/queries/orders');

async function setupReservedItems(pool, userId, prices) {
  const category = await categoriesQ.createCategory(pool, { name: 'Верх' });
  const items = [];
  for (const price of prices) {
    const item = await itemsQ.createItem(pool, { categoryId: category.id, name: `Item ${price}`, price, size: 'M', conditionText: '', photos: [] });
    await itemsQ.reserveItem(pool, item.id, userId, 30 * 60 * 1000);
    items.push(item);
  }
  return items;
}

test('createOrder converts cart reservations into an order and clears the cart', async () => {
  const pool = await createTestPool();
  const items = await setupReservedItems(pool, 555, [500, 700]);

  const result = await ordersQ.createOrder(pool, { userId: 555, fio: 'Иван Иванов', phone: '+79990000000', address: 'ул. Ленина 1' });
  assert.equal(result.order.total, 1200);
  assert.equal(result.order.status, 'ожидает оплаты');
  assert.equal(result.itemCount, 2);

  const cart = await ordersQ.getUserCartReservations(pool, 555);
  assert.equal(cart.length, 0);

  const order = await ordersQ.getOrder(pool, result.order.id);
  assert.equal(order.items.length, 2);
  assert.equal((await itemsQ.getItem(pool, items[0].id)).status, 'reserved');
});

test('createOrder returns empty_cart error when the user has nothing reserved', async () => {
  const pool = await createTestPool();
  const result = await ordersQ.createOrder(pool, { userId: 999, fio: 'x', phone: 'x', address: 'x' });
  assert.equal(result.error, 'empty_cart');
});

test('listOrdersForUser and listOrdersAdmin filter correctly', async () => {
  const pool = await createTestPool();
  await setupReservedItems(pool, 1, [100]);
  await ordersQ.createOrder(pool, { userId: 1, fio: 'A', phone: 'A', address: 'A' });
  await setupReservedItems(pool, 2, [200]);
  await ordersQ.createOrder(pool, { userId: 2, fio: 'B', phone: 'B', address: 'B' });

  const forUser1 = await ordersQ.listOrdersForUser(pool, 1);
  assert.equal(forUser1.length, 1);

  const allPending = await ordersQ.listOrdersAdmin(pool, { status: 'ожидает оплаты' });
  assert.equal(allPending.length, 2);

  const allConfirmed = await ordersQ.listOrdersAdmin(pool, { status: 'оплачен' });
  assert.equal(allConfirmed.length, 0);
});

test('setOrderStatus, addPaymentProof, deleteOrder', async () => {
  const pool = await createTestPool();
  await setupReservedItems(pool, 1, [100]);
  const { order } = await ordersQ.createOrder(pool, { userId: 1, fio: 'A', phone: 'A', address: 'A' });

  const updated = await ordersQ.setOrderStatus(pool, order.id, 'оплачен');
  assert.equal(updated.status, 'оплачен');

  const proof = await ordersQ.addPaymentProof(pool, order.id, 'telegram_file_123');
  assert.equal(proof.telegram_file_id, 'telegram_file_123');

  const deleted = await ordersQ.deleteOrder(pool, order.id);
  assert.equal(deleted, true);
  assert.equal(await ordersQ.getOrder(pool, order.id), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../src/queries/orders'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/queries/orders.js
async function getUserCartReservations(pool, userId) {
  const { rows } = await pool.query(
    `SELECT cr.id AS reservation_id, cr.item_id, cr.expires_at, i.name, i.price, i.size, i.photos
     FROM cart_reservations cr JOIN items i ON i.id = cr.item_id
     WHERE cr.user_id = $1 AND cr.expires_at > now()
     ORDER BY cr.reserved_at`,
    [userId]
  );
  return rows;
}

async function createOrder(pool, { userId, fio, phone, address }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cartRes = await client.query(
      `SELECT cr.id AS reservation_id, cr.item_id, i.price
       FROM cart_reservations cr JOIN items i ON i.id = cr.item_id
       WHERE cr.user_id = $1 AND cr.expires_at > now()`,
      [userId]
    );
    if (cartRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { error: 'empty_cart' };
    }
    const total = cartRes.rows.reduce((sum, row) => sum + row.price, 0);
    const orderRes = await client.query(
      `INSERT INTO orders (user_id, fio, phone, address, total, status)
       VALUES ($1, $2, $3, $4, $5, 'ожидает оплаты')
       RETURNING id, user_id, fio, phone, address, total, status, created_at`,
      [userId, fio, phone, address, total]
    );
    const order = orderRes.rows[0];
    for (const row of cartRes.rows) {
      await client.query(
        'INSERT INTO order_items (order_id, item_id, price_at_order) VALUES ($1, $2, $3)',
        [order.id, row.item_id, row.price]
      );
      await client.query('DELETE FROM cart_reservations WHERE id = $1', [row.reservation_id]);
    }
    await client.query('COMMIT');
    return { order, itemCount: cartRes.rows.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getOrder(pool, id) {
  const orderRes = await pool.query(
    'SELECT id, user_id, fio, phone, address, total, status, created_at FROM orders WHERE id = $1',
    [id]
  );
  if (!orderRes.rows[0]) return null;
  const itemsRes = await pool.query(
    `SELECT oi.item_id, oi.price_at_order, i.name, i.size, i.photos
     FROM order_items oi JOIN items i ON i.id = oi.item_id
     WHERE oi.order_id = $1`,
    [id]
  );
  return { ...orderRes.rows[0], items: itemsRes.rows };
}

async function listOrdersForUser(pool, userId, limit = 20) {
  const { rows } = await pool.query(
    'SELECT id, total, status, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
  return rows;
}

async function listOrdersAdmin(pool, { status } = {}) {
  const clauses = [];
  const params = [];
  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id, user_id, fio, phone, address, total, status, created_at FROM orders ${where} ORDER BY created_at DESC`,
    params
  );
  return rows;
}

async function setOrderStatus(pool, id, status) {
  const { rows } = await pool.query(
    'UPDATE orders SET status = $2 WHERE id = $1 RETURNING id, status',
    [id, status]
  );
  return rows[0] || null;
}

async function deleteOrder(pool, id) {
  await pool.query('DELETE FROM order_items WHERE order_id = $1', [id]);
  await pool.query('DELETE FROM payment_proofs WHERE order_id = $1', [id]);
  const { rowCount } = await pool.query('DELETE FROM orders WHERE id = $1', [id]);
  return rowCount > 0;
}

async function addPaymentProof(pool, orderId, telegramFileId) {
  const { rows } = await pool.query(
    'INSERT INTO payment_proofs (order_id, telegram_file_id) VALUES ($1, $2) RETURNING id, order_id, telegram_file_id, uploaded_at',
    [orderId, telegramFileId]
  );
  return rows[0];
}

module.exports = {
  getUserCartReservations, createOrder, getOrder, listOrdersForUser,
  listOrdersAdmin, setOrderStatus, deleteOrder, addPaymentProof,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/queries/orders.js tests/queries/orders.test.js
git commit -m "feat: add order queries and checkout transaction"
```

---

## Task 9: Admin actions (confirm / cancel / mark done)

**Files:**
- Create: `src/adminActions.js`
- Test: `tests/adminActions.test.js`

**Interfaces:**
- Consumes: `getOrder`, `setOrderStatus` (Task 8), `markItemSold`,
  `releaseItem`, `getItem` (Task 6).
- Produces: `confirmOrderPayment(pool, orderId) ->
  Promise<{order}|{error}>`, `cancelOrder(pool, orderId) ->
  Promise<{order}|{error}>`, `markOrderDone(pool, orderId) ->
  Promise<{order}|{error}>`. Consumed by Task 16 (admin routes).

- [ ] **Step 1: Write the failing test**

```js
// tests/adminActions.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool } = require('./helpers/testDb');
const categoriesQ = require('../src/queries/categories');
const itemsQ = require('../src/queries/items');
const ordersQ = require('../src/queries/orders');
const adminActions = require('../src/adminActions');

async function setupOrder(pool, userId = 1, price = 500) {
  const category = await categoriesQ.createCategory(pool, { name: 'Верх' });
  const item = await itemsQ.createItem(pool, { categoryId: category.id, name: 'A', price, size: 'M', conditionText: '', photos: [] });
  await itemsQ.reserveItem(pool, item.id, userId, 30 * 60 * 1000);
  const { order } = await ordersQ.createOrder(pool, { userId, fio: 'A', phone: 'A', address: 'A' });
  return { order, item };
}

test('confirmOrderPayment marks the order paid and its items sold', async () => {
  const pool = await createTestPool();
  const { order, item } = await setupOrder(pool);

  const result = await adminActions.confirmOrderPayment(pool, order.id);
  assert.equal(result.order.status, 'оплачен');
  assert.equal((await itemsQ.getItem(pool, item.id)).status, 'sold');
});

test('confirmOrderPayment rejects an order that is not pending payment', async () => {
  const pool = await createTestPool();
  const { order } = await setupOrder(pool);
  await adminActions.confirmOrderPayment(pool, order.id);

  const second = await adminActions.confirmOrderPayment(pool, order.id);
  assert.equal(second.error, 'wrong_status');
});

test('cancelOrder marks the order cancelled and releases its items', async () => {
  const pool = await createTestPool();
  const { order, item } = await setupOrder(pool);

  const result = await adminActions.cancelOrder(pool, order.id);
  assert.equal(result.order.status, 'отменён');
  assert.equal((await itemsQ.getItem(pool, item.id)).status, 'available');
});

test('markOrderDone requires the order to already be paid', async () => {
  const pool = await createTestPool();
  const { order } = await setupOrder(pool);

  const tooEarly = await adminActions.markOrderDone(pool, order.id);
  assert.equal(tooEarly.error, 'wrong_status');

  await adminActions.confirmOrderPayment(pool, order.id);
  const result = await adminActions.markOrderDone(pool, order.id);
  assert.equal(result.order.status, 'выполнен');
});

test('all three actions return not_found for a missing order id', async () => {
  const pool = await createTestPool();
  assert.equal((await adminActions.confirmOrderPayment(pool, 9999)).error, 'not_found');
  assert.equal((await adminActions.cancelOrder(pool, 9999)).error, 'not_found');
  assert.equal((await adminActions.markOrderDone(pool, 9999)).error, 'not_found');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/adminActions'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/adminActions.js
const itemsQ = require('./queries/items');
const ordersQ = require('./queries/orders');

async function confirmOrderPayment(pool, orderId) {
  const order = await ordersQ.getOrder(pool, orderId);
  if (!order) return { error: 'not_found' };
  if (order.status !== 'ожидает оплаты') return { error: 'wrong_status', order };
  await ordersQ.setOrderStatus(pool, orderId, 'оплачен');
  for (const item of order.items) {
    await itemsQ.markItemSold(pool, item.item_id);
  }
  return { order: await ordersQ.getOrder(pool, orderId) };
}

async function cancelOrder(pool, orderId) {
  const order = await ordersQ.getOrder(pool, orderId);
  if (!order) return { error: 'not_found' };
  if (order.status === 'отменён') return { error: 'already_cancelled', order };
  await ordersQ.setOrderStatus(pool, orderId, 'отменён');
  for (const item of order.items) {
    await itemsQ.releaseItem(pool, item.item_id);
  }
  return { order: await ordersQ.getOrder(pool, orderId) };
}

async function markOrderDone(pool, orderId) {
  const order = await ordersQ.getOrder(pool, orderId);
  if (!order) return { error: 'not_found' };
  if (order.status !== 'оплачен') return { error: 'wrong_status', order };
  await ordersQ.setOrderStatus(pool, orderId, 'выполнен');
  return { order: await ordersQ.getOrder(pool, orderId) };
}

module.exports = { confirmOrderPayment, cancelOrder, markOrderDone };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adminActions.js tests/adminActions.test.js
git commit -m "feat: add shared admin order actions"
```

---

## Task 10: Telegram initData validation

**Files:**
- Create: `src/initData.js`
- Create: `tests/helpers/initData.js`
- Test: `tests/initData.test.js`

**Interfaces:**
- Produces: `validateInitData(initDataRaw, botToken, maxAgeSeconds) ->
  {valid: true, user, authDate} | {valid: false, reason}`.
  `tests/helpers/initData.js`'s `buildInitData(user, botToken, authDate) ->
  string` builds a correctly-signed init-data string for tests — every
  later route test that needs an authenticated request imports this.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/initData'`

- [ ] **Step 3: Write `tests/helpers/initData.js`**

```js
// tests/helpers/initData.js
const crypto = require('crypto');

function buildInitData(user, botToken, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams();
  params.set('user', JSON.stringify(user));
  params.set('auth_date', String(authDate));
  params.set('query_id', 'test_query_id');

  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);

  return params.toString();
}

module.exports = { buildInitData };
```

- [ ] **Step 4: Write `src/initData.js`**

```js
// src/initData.js
const crypto = require('crypto');

function validateInitData(initDataRaw, botToken, maxAgeSeconds) {
  if (!initDataRaw) return { valid: false, reason: 'missing' };

  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash) return { valid: false, reason: 'missing_hash' };
  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computedHash !== hash) return { valid: false, reason: 'bad_signature' };

  const authDate = Number(params.get('auth_date'));
  if (!authDate) return { valid: false, reason: 'missing_auth_date' };
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > maxAgeSeconds) return { valid: false, reason: 'stale_signature' };

  let user = null;
  const userRaw = params.get('user');
  if (userRaw) {
    try {
      user = JSON.parse(userRaw);
    } catch {
      user = null;
    }
  }

  return { valid: true, user, authDate };
}

module.exports = { validateInitData };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/initData.js tests/helpers/initData.js tests/initData.test.js
git commit -m "feat: add Telegram initData HMAC validation"
```

---

## Task 11: Auth middleware

**Files:**
- Create: `src/auth.js`
- Test: `tests/auth.test.js`

**Interfaces:**
- Consumes: `validateInitData` (Task 10).
- Produces: `requireUser({botToken, maxAgeSeconds}) -> ExpressMiddleware`
  (sets `req.telegramUser`, 403s on invalid signature — used by cart/
  order routes in Tasks 14-15), `requireAdmin({botToken, adminIds,
  maxAgeSeconds}) -> ExpressMiddleware` (as `requireUser`, plus 403s if
  the caller's id is not in `adminIds` — used by admin routes in Task
  16).

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/auth'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/auth.js
const { validateInitData } = require('./initData');

function readInitData(req) {
  return req.get('X-Telegram-Init-Data') || req.query.init_data;
}

function requireUser({ botToken, maxAgeSeconds }) {
  return (req, res, next) => {
    const result = validateInitData(readInitData(req), botToken, maxAgeSeconds);
    if (!result.valid) {
      return res.status(403).json({ error: 'forbidden', stale_signature: result.reason === 'stale_signature' });
    }
    req.telegramUser = result.user;
    next();
  };
}

function requireAdmin({ botToken, adminIds, maxAgeSeconds }) {
  return (req, res, next) => {
    const result = validateInitData(readInitData(req), botToken, maxAgeSeconds);
    if (!result.valid) {
      return res.status(403).json({ error: 'forbidden', stale_signature: result.reason === 'stale_signature' });
    }
    if (!result.user || !adminIds.has(String(result.user.id))) {
      return res.status(403).json({ error: 'forbidden' });
    }
    req.telegramUser = result.user;
    next();
  };
}

module.exports = { requireUser, requireAdmin };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth.js tests/auth.test.js
git commit -m "feat: add initData-based auth middleware"
```

---

## Task 12: Express app skeleton + `/api/config`

**Files:**
- Create: `src/server.js`
- Test: `tests/server.config.test.js`

**Interfaces:**
- Consumes: `requireUser` (Task 11).
- Produces: `createServer({pool, config, bot}) -> ExpressApp`. Every
  subsequent route task modifies this same file/function, appending more
  `app.<method>(...)` registrations before the final `return app;`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/server'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/server.js
const express = require('express');
const path = require('path');
const { requireUser, requireAdmin } = require('./auth');

function createServer({ pool, config, bot }) {
  const app = express();
  app.use(express.json());

  const userGate = requireUser({ botToken: config.botToken, maxAgeSeconds: config.userInitDataMaxAgeSeconds });
  const adminGate = requireAdmin({ botToken: config.botToken, adminIds: config.adminIds, maxAgeSeconds: config.adminInitDataMaxAgeSeconds });

  app.get('/api/config', userGate, (req, res) => {
    res.json({ isAdmin: config.adminIds.has(String(req.telegramUser.id)) });
  });

  app.use(express.static(path.join(__dirname, '..', 'webapp')));

  return app;
}

module.exports = { createServer };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server.js tests/server.config.test.js
git commit -m "feat: add Express app skeleton with /api/config"
```

---

## Task 13: Catalog routes

**Files:**
- Modify: `src/server.js` (insert routes before `app.use(express.static(...))`)
- Test: `tests/server.catalog.test.js`

**Interfaces:**
- Consumes: `listCategories` (Task 4), `listItems`, `getItem` (Task 5).
- Produces: `GET /api/categories`, `GET /api/items` (query params
  `categoryId`, `size`, `sort`, `search`), `GET /api/items/:id` — public,
  no auth gate (matches the spec: browsing the catalog doesn't require
  being logged into the bot).

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `expected 200 "OK", got 404 "Not Found"` (route doesn't exist yet)

- [ ] **Step 3: Add routes to `src/server.js`**

Add near the top of the file:

```js
const categoriesQ = require('./queries/categories');
const itemsQ = require('./queries/items');
```

Insert before `app.use(express.static(...))`:

```js
  app.get('/api/categories', async (req, res) => {
    res.json(await categoriesQ.listCategories(pool));
  });

  app.get('/api/items', async (req, res) => {
    const { categoryId, size, sort, search } = req.query;
    const items = await itemsQ.listItems(pool, {
      categoryId: categoryId ? Number(categoryId) : undefined,
      size, sort, search,
    });
    res.json(items);
  });

  app.get('/api/items/:id', async (req, res) => {
    const item = await itemsQ.getItem(pool, Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'not_found' });
    res.json(item);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server.js tests/server.catalog.test.js
git commit -m "feat: add public catalog routes"
```

---

## Task 14: Cart routes

**Files:**
- Modify: `src/server.js`
- Test: `tests/server.cart.test.js`

**Interfaces:**
- Consumes: `reserveItem`, `releaseItem` (Task 6),
  `getUserCartReservations` (Task 8), `userGate` (Task 12).
- Produces: `POST /api/cart/add` (body `{itemId}`, 200 with reservation
  or 409 `{error: 'already_reserved'}`), `DELETE /api/cart/:itemId`,
  `GET /api/cart` — all behind `userGate`.

- [ ] **Step 1: Write the failing test**

```js
// tests/server.cart.test.js
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
    botToken: BOT_TOKEN, adminIds: new Set(),
    reservationTtlMs: 1800000, adminInitDataMaxAgeSeconds: 3600, userInitDataMaxAgeSeconds: 3600,
  };
}

async function setupItem(pool) {
  const category = await categoriesQ.createCategory(pool, { name: 'Верх' });
  return itemsQ.createItem(pool, { categoryId: category.id, name: 'Куртка', price: 1500, size: 'M', conditionText: 'хор.', photos: [] });
}

test('POST /api/cart/add reserves the item; a second add for another user 409s', async () => {
  const pool = await createTestPool();
  const item = await setupItem(pool);
  const app = createServer({ pool, config: testConfig(), bot: null });
  const userA = buildInitData({ id: 1 }, BOT_TOKEN);
  const userB = buildInitData({ id: 2 }, BOT_TOKEN);

  const first = await request(app).post('/api/cart/add').query({ init_data: userA }).send({ itemId: item.id });
  assert.equal(first.status, 200);

  const second = await request(app).post('/api/cart/add').query({ init_data: userB }).send({ itemId: item.id });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'already_reserved');
});

test('GET /api/cart lists the caller\'s reservations; DELETE releases one', async () => {
  const pool = await createTestPool();
  const item = await setupItem(pool);
  const app = createServer({ pool, config: testConfig(), bot: null });
  const user = buildInitData({ id: 1 }, BOT_TOKEN);

  await request(app).post('/api/cart/add').query({ init_data: user }).send({ itemId: item.id });
  const cartRes = await request(app).get('/api/cart').query({ init_data: user });
  assert.equal(cartRes.body.length, 1);

  await request(app).delete(`/api/cart/${item.id}`).query({ init_data: user });
  const afterDelete = await request(app).get('/api/cart').query({ init_data: user });
  assert.equal(afterDelete.body.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — 404 on `/api/cart/add`

- [ ] **Step 3: Add routes to `src/server.js`**

Add near the top:

```js
const ordersQ = require('./queries/orders');
```

Insert before `app.use(express.static(...))`:

```js
  app.post('/api/cart/add', userGate, async (req, res) => {
    const itemId = Number(req.body.itemId);
    const reservation = await itemsQ.reserveItem(pool, itemId, req.telegramUser.id, config.reservationTtlMs);
    if (!reservation) return res.status(409).json({ error: 'already_reserved' });
    res.json(reservation);
  });

  app.delete('/api/cart/:itemId', userGate, async (req, res) => {
    await itemsQ.releaseItem(pool, Number(req.params.itemId));
    res.json({ ok: true });
  });

  app.get('/api/cart', userGate, async (req, res) => {
    res.json(await ordersQ.getUserCartReservations(pool, req.telegramUser.id));
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server.js tests/server.cart.test.js
git commit -m "feat: add cart routes with reservation conflict handling"
```

---

## Task 15: Order & payment-proof routes

**Files:**
- Modify: `src/server.js`
- Test: `tests/server.orders.test.js`

**Interfaces:**
- Consumes: `createOrder`, `listOrdersForUser`, `addPaymentProof` (Task
  8), `userGate` (Task 12). Introduces a `bot` shape:
  `{notifyNewOrder(order) -> Promise<void>, sendProofPhoto(orderId,
  buffer) -> Promise<string>}` (implemented for real in Task 17; tests
  here pass a fake).
- Produces: `POST /api/orders` (body `{fio, phone, address}`), `GET
  /api/my-orders`, `POST /api/proof` (multipart, fields `orderId` +
  `photo`) — all behind `userGate`.

- [ ] **Step 1: Write the failing test**

```js
// tests/server.orders.test.js
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
    botToken: BOT_TOKEN, adminIds: new Set(),
    reservationTtlMs: 1800000, adminInitDataMaxAgeSeconds: 3600, userInitDataMaxAgeSeconds: 3600,
  };
}

function fakeBot() {
  const notified = [];
  const proofsSent = [];
  return {
    notifyNewOrder: async (order) => { notified.push(order); },
    sendProofPhoto: async (orderId, buffer) => { proofsSent.push({ orderId, size: buffer.length }); return 'fake_file_id'; },
    _notified: notified,
    _proofsSent: proofsSent,
  };
}

test('POST /api/orders creates an order from the cart and notifies the bot', async () => {
  const pool = await createTestPool();
  const category = await categoriesQ.createCategory(pool, { name: 'Верх' });
  const item = await itemsQ.createItem(pool, { categoryId: category.id, name: 'Куртка', price: 1500, size: 'M', conditionText: '', photos: [] });
  const bot = fakeBot();
  const app = createServer({ pool, config: testConfig(), bot });
  const user = buildInitData({ id: 1 }, BOT_TOKEN);

  await request(app).post('/api/cart/add').query({ init_data: user }).send({ itemId: item.id });
  const orderRes = await request(app).post('/api/orders').query({ init_data: user }).send({ fio: 'Иван', phone: '+7900', address: 'ул. Ленина 1' });

  assert.equal(orderRes.status, 200);
  assert.equal(orderRes.body.total, 1500);
  assert.equal(bot._notified.length, 1);

  const myOrders = await request(app).get('/api/my-orders').query({ init_data: user });
  assert.equal(myOrders.body.length, 1);
});

test('POST /api/orders 400s on an empty cart', async () => {
  const pool = await createTestPool();
  const app = createServer({ pool, config: testConfig(), bot: fakeBot() });
  const user = buildInitData({ id: 1 }, BOT_TOKEN);
  const res = await request(app).post('/api/orders').query({ init_data: user }).send({ fio: 'A', phone: 'A', address: 'A' });
  assert.equal(res.status, 400);
});

test('POST /api/proof relays the photo through the bot and stores the file id', async () => {
  const pool = await createTestPool();
  const category = await categoriesQ.createCategory(pool, { name: 'Верх' });
  const item = await itemsQ.createItem(pool, { categoryId: category.id, name: 'Куртка', price: 1500, size: 'M', conditionText: '', photos: [] });
  const bot = fakeBot();
  const app = createServer({ pool, config: testConfig(), bot });
  const user = buildInitData({ id: 1 }, BOT_TOKEN);

  await request(app).post('/api/cart/add').query({ init_data: user }).send({ itemId: item.id });
  const orderRes = await request(app).post('/api/orders').query({ init_data: user }).send({ fio: 'A', phone: 'A', address: 'A' });

  const proofRes = await request(app)
    .post('/api/proof')
    .query({ init_data: user })
    .field('orderId', String(orderRes.body.id))
    .attach('photo', Buffer.from('fake-image-bytes'), 'receipt.jpg');

  assert.equal(proofRes.status, 200);
  assert.equal(proofRes.body.telegram_file_id, 'fake_file_id');
  assert.equal(bot._proofsSent.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — 404 on `/api/orders`

- [ ] **Step 3: Add routes to `src/server.js`**

Add near the top:

```js
const multer = require('multer');
```

Add right after `app.use(express.json());`:

```js
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
```

Insert before `app.use(express.static(...))`:

```js
  app.post('/api/orders', userGate, async (req, res) => {
    const { fio, phone, address } = req.body;
    if (!fio || !phone || !address) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    const result = await ordersQ.createOrder(pool, { userId: req.telegramUser.id, fio, phone, address });
    if (result.error) return res.status(400).json({ error: result.error });
    if (bot) {
      bot.notifyNewOrder(result.order).catch(() => {});
    }
    res.json(result.order);
  });

  app.get('/api/my-orders', userGate, async (req, res) => {
    res.json(await ordersQ.listOrdersForUser(pool, req.telegramUser.id));
  });

  app.post('/api/proof', userGate, upload.single('photo'), async (req, res) => {
    const orderId = Number(req.body.orderId);
    if (!req.file) return res.status(400).json({ error: 'missing_photo' });
    if (!bot) return res.status(503).json({ error: 'bot_unavailable' });
    const fileId = await bot.sendProofPhoto(orderId, req.file.buffer);
    const proof = await ordersQ.addPaymentProof(pool, orderId, fileId);
    res.json(proof);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server.js tests/server.orders.test.js
git commit -m "feat: add order creation and payment-proof upload routes"
```

---

## Task 16: Admin routes

**Files:**
- Modify: `src/server.js`
- Test: `tests/server.admin.test.js`

**Interfaces:**
- Consumes: `adminActions.*` (Task 9), `listOrdersAdmin`, `getOrder`,
  `deleteOrder` (Task 8), `listItemsAdmin`, `createItem`, `updateItem`,
  `deleteItem` (Task 5), `createCategory`, `updateCategory`,
  `deleteCategory` (Task 4), `adminGate` (Task 12).
- Produces: `GET/POST/PUT/DELETE /api/admin/orders*`,
  `GET/POST/PUT/DELETE /api/admin/items*`,
  `POST/PUT/DELETE /api/admin/categories*` — all behind `adminGate`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — 404 on `/api/admin/*` routes

- [ ] **Step 3: Add routes to `src/server.js`**

Add near the top:

```js
const adminActions = require('./adminActions');
```

Insert before `app.use(express.static(...))`:

```js
  app.get('/api/admin/orders', adminGate, async (req, res) => {
    res.json(await ordersQ.listOrdersAdmin(pool, { status: req.query.status }));
  });

  app.get('/api/admin/orders/:id', adminGate, async (req, res) => {
    const order = await ordersQ.getOrder(pool, Number(req.params.id));
    if (!order) return res.status(404).json({ error: 'not_found' });
    res.json(order);
  });

  app.post('/api/admin/orders/:id/confirm', adminGate, async (req, res) => {
    const result = await adminActions.confirmOrderPayment(pool, Number(req.params.id));
    if (result.error) return res.status(400).json(result);
    res.json(result.order);
  });

  app.post('/api/admin/orders/:id/cancel', adminGate, async (req, res) => {
    const result = await adminActions.cancelOrder(pool, Number(req.params.id));
    if (result.error) return res.status(400).json(result);
    res.json(result.order);
  });

  app.post('/api/admin/orders/:id/done', adminGate, async (req, res) => {
    const result = await adminActions.markOrderDone(pool, Number(req.params.id));
    if (result.error) return res.status(400).json(result);
    res.json(result.order);
  });

  app.delete('/api/admin/orders/:id', adminGate, async (req, res) => {
    res.json({ ok: await ordersQ.deleteOrder(pool, Number(req.params.id)) });
  });

  app.get('/api/admin/items', adminGate, async (req, res) => {
    res.json(await itemsQ.listItemsAdmin(pool, {}));
  });

  app.post('/api/admin/items', adminGate, async (req, res) => {
    res.json(await itemsQ.createItem(pool, req.body));
  });

  app.put('/api/admin/items/:id', adminGate, async (req, res) => {
    const item = await itemsQ.updateItem(pool, Number(req.params.id), req.body);
    if (!item) return res.status(404).json({ error: 'not_found' });
    res.json(item);
  });

  app.delete('/api/admin/items/:id', adminGate, async (req, res) => {
    res.json({ ok: await itemsQ.deleteItem(pool, Number(req.params.id)) });
  });

  app.post('/api/admin/categories', adminGate, async (req, res) => {
    res.json(await categoriesQ.createCategory(pool, req.body));
  });

  app.put('/api/admin/categories/:id', adminGate, async (req, res) => {
    const category = await categoriesQ.updateCategory(pool, Number(req.params.id), req.body);
    if (!category) return res.status(404).json({ error: 'not_found' });
    res.json(category);
  });

  app.delete('/api/admin/categories/:id', adminGate, async (req, res) => {
    res.json({ ok: await categoriesQ.deleteCategory(pool, Number(req.params.id)) });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server.js tests/server.admin.test.js
git commit -m "feat: add admin routes for orders, items, categories"
```

---

## Task 17: Telegram bot (grammY)

**Files:**
- Create: `src/bot.js`
- Test: `tests/bot.test.js`

**Interfaces:**
- Produces: `formatOrderNotification(order) -> string` (pure, unit
  tested), `createBot({token, adminIds}) -> {bot: GrammyBot,
  notifyNewOrder(order) -> Promise<void>, sendProofPhoto(orderId, buffer)
  -> Promise<string>}` — matches the `bot` shape assumed by Tasks 15-16
  and wired into `src/main.js` in Task 18.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/bot'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/bot.js
const { Bot, InputFile } = require('grammy');

function formatOrderNotification(order) {
  return `Новый заказ #${order.id}\nСумма: ${order.total} ₽\nСтатус: ${order.status}`;
}

function createBot({ token, adminIds }) {
  const bot = new Bot(token);

  bot.command('start', (ctx) => {
    ctx.reply('Открой каталог через кнопку меню, чтобы посмотреть товары.');
  });

  async function notifyNewOrder(order) {
    const text = formatOrderNotification(order);
    for (const adminId of adminIds) {
      await bot.api.sendMessage(adminId, text).catch(() => {});
    }
  }

  async function sendProofPhoto(orderId, buffer) {
    let fileId = null;
    for (const adminId of adminIds) {
      const message = await bot.api.sendPhoto(adminId, new InputFile(buffer), {
        caption: `Чек к заказу #${orderId}`,
      });
      if (!fileId) {
        fileId = message.photo[message.photo.length - 1].file_id;
      }
    }
    return fileId;
  }

  return { bot, notifyNewOrder, sendProofPhoto };
}

module.exports = { formatOrderNotification, createBot };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. If `require('grammy')` throws `ERR_REQUIRE_ESM`, change
the top of this file to a factory that dynamically imports grammY:

```js
async function createBot({ token, adminIds }) {
  const { Bot, InputFile } = await import('grammy');
  // ... rest of the function body unchanged, still returns { bot, notifyNewOrder, sendProofPhoto }
}
```

and update `tests/bot.test.js`'s second test to `await createBot(...)`,
plus update Task 18's `main.js` to `await createBot(...)`.

- [ ] **Step 5: Commit**

```bash
git add src/bot.js tests/bot.test.js
git commit -m "feat: add grammY bot for admin notifications and proof relaying"
```

---

## Task 18: Process entrypoint

**Files:**
- Create: `src/main.js`

**Interfaces:**
- Consumes: `loadConfig` (Task 2), `createPool`, `initSchema` (Task 3),
  `createServer` (Task 12), `createBot` (Task 17),
  `sweepExpiredReservations` (Task 7). This is the process entrypoint —
  no later task depends on anything it produces.

- [ ] **Step 1: Write `src/main.js`**

```js
// src/main.js
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

  await botWrapper.bot.start();

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
```

Note: if Task 17's `createBot` ended up async (the `ERR_REQUIRE_ESM`
fallback), change the line above to
`const botWrapper = await createBot({ ... });`.

- [ ] **Step 2: Verify it starts (manual, no automated test — this file only wires already-tested pieces)**

This step requires a real reachable PostgreSQL instance and a real bot
token, which aren't available in the local dev environment set up for
this plan (tests use `pg-mem`; `DATABASE_URL` in `.env` has no live
server behind it yet). Confirm correctness statically instead:

Run: `node --check src/main.js`
Expected: no output (syntax valid).

Document in a code comment at the top of `src/main.js` that a live run
requires a reachable `DATABASE_URL` and a real `BOT_TOKEN` — full
end-to-end verification (`npm start`, confirm the "listening on port"
log line, confirm `bot.start()` doesn't throw an auth error) happens once
this project is deployed to the VPS in the deployment plan, where a real
PostgreSQL instance exists.

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat: add process entrypoint wiring server, bot, and reservation sweep"
```

---

## Task 19: Full test suite run + final review

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: PASS — every test file from Tasks 2-17 (config, db,
categories, items, reservations, orders, adminActions, initData, auth,
server.config, server.catalog, server.cart, server.orders, server.admin,
bot).

- [ ] **Step 2: Confirm no leftover placeholder code**

Run: `grep -rn "TODO\|TBD\|FIXME" src/`
Expected: no output. If anything appears, resolve it before considering
this plan complete.

- [ ] **Step 3: Confirm `node --check` passes on every source file**

Run (bash): `for f in src/*.js src/queries/*.js; do node --check "$f" || echo "FAILED: $f"; done`
Expected: no `FAILED` lines.

- [ ] **Step 4: Commit (if Steps 2-3 required any fixes)**

```bash
git add -A
git commit -m "chore: final review pass on backend implementation"
```
