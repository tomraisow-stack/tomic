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
