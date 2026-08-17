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
  // Only a still-unpaid order can be cancelled: items of a paid/completed order
  // are already 'sold', and releaseItem below would not revert them.
  if (order.status !== 'ожидает оплаты') return { error: 'wrong_status', order };
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
