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
