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
