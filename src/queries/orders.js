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
