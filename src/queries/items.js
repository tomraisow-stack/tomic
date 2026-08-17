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
