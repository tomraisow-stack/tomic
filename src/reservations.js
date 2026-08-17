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
