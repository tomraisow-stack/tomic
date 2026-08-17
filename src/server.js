// src/server.js
const express = require('express');
const path = require('path');
const multer = require('multer');
const { requireUser, requireAdmin } = require('./auth');
const categoriesQ = require('./queries/categories');
const itemsQ = require('./queries/items');
const ordersQ = require('./queries/orders');
const adminActions = require('./adminActions');

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function createServer({ pool, config, bot }) {
  const app = express();
  app.use(express.json());
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

  const userGate = requireUser({ botToken: config.botToken, maxAgeSeconds: config.userInitDataMaxAgeSeconds });
  const adminGate = requireAdmin({ botToken: config.botToken, adminIds: config.adminIds, maxAgeSeconds: config.adminInitDataMaxAgeSeconds });

  app.get('/api/config', userGate, asyncHandler((req, res) => {
    res.json({ isAdmin: config.adminIds.has(String(req.telegramUser.id)) });
  }));

  app.get('/api/categories', asyncHandler(async (req, res) => {
    res.json(await categoriesQ.listCategories(pool));
  }));

  app.get('/api/items', asyncHandler(async (req, res) => {
    const { categoryId, size, sort, search } = req.query;
    const items = await itemsQ.listItems(pool, {
      categoryId: categoryId ? Number(categoryId) : undefined,
      size, sort, search,
    });
    res.json(items);
  }));

  app.get('/api/items/:id', asyncHandler(async (req, res) => {
    const item = await itemsQ.getItem(pool, Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'not_found' });
    res.json(item);
  }));

  app.post('/api/cart/add', userGate, asyncHandler(async (req, res) => {
    const itemId = Number(req.body.itemId);
    const reservation = await itemsQ.reserveItem(pool, itemId, req.telegramUser.id, config.reservationTtlMs);
    if (!reservation) return res.status(409).json({ error: 'already_reserved' });
    res.json(reservation);
  }));

  app.delete('/api/cart/:itemId', userGate, asyncHandler(async (req, res) => {
    const itemId = Number(req.params.itemId);
    if (!Number.isInteger(itemId)) return res.status(400).json({ error: 'invalid_item_id' });
    const released = await itemsQ.releaseItemForUser(pool, itemId, req.telegramUser.id);
    if (!released) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  }));

  app.get('/api/cart', userGate, asyncHandler(async (req, res) => {
    res.json(await ordersQ.getUserCartReservations(pool, req.telegramUser.id));
  }));

  app.post('/api/orders', userGate, asyncHandler(async (req, res) => {
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
  }));

  app.get('/api/my-orders', userGate, asyncHandler(async (req, res) => {
    res.json(await ordersQ.listOrdersForUser(pool, req.telegramUser.id));
  }));

  app.post('/api/proof', userGate, upload.single('photo'), asyncHandler(async (req, res) => {
    const orderId = Number(req.body.orderId);
    if (!Number.isInteger(orderId)) return res.status(400).json({ error: 'invalid_order_id' });
    if (!req.file) return res.status(400).json({ error: 'missing_photo' });
    const order = await ordersQ.getOrder(pool, orderId);
    if (!order) return res.status(404).json({ error: 'not_found' });
    // order.user_id is a string on real Postgres (BIGINT) and a number on pg-mem.
    if (String(order.user_id) !== String(req.telegramUser.id)) return res.status(403).json({ error: 'forbidden' });
    if (!bot) return res.status(503).json({ error: 'bot_unavailable' });
    const fileId = await bot.sendProofPhoto(orderId, req.file.buffer);
    const proof = await ordersQ.addPaymentProof(pool, orderId, fileId);
    res.json(proof);
  }));

  app.get('/api/admin/orders', adminGate, asyncHandler(async (req, res) => {
    res.json(await ordersQ.listOrdersAdmin(pool, { status: req.query.status }));
  }));

  app.get('/api/admin/orders/:id', adminGate, asyncHandler(async (req, res) => {
    const order = await ordersQ.getOrder(pool, Number(req.params.id));
    if (!order) return res.status(404).json({ error: 'not_found' });
    res.json(order);
  }));

  app.post('/api/admin/orders/:id/confirm', adminGate, asyncHandler(async (req, res) => {
    const result = await adminActions.confirmOrderPayment(pool, Number(req.params.id));
    if (result.error) return res.status(400).json(result);
    res.json(result.order);
  }));

  app.post('/api/admin/orders/:id/cancel', adminGate, asyncHandler(async (req, res) => {
    const result = await adminActions.cancelOrder(pool, Number(req.params.id));
    if (result.error) return res.status(400).json(result);
    res.json(result.order);
  }));

  app.post('/api/admin/orders/:id/done', adminGate, asyncHandler(async (req, res) => {
    const result = await adminActions.markOrderDone(pool, Number(req.params.id));
    if (result.error) return res.status(400).json(result);
    res.json(result.order);
  }));

  app.delete('/api/admin/orders/:id', adminGate, asyncHandler(async (req, res) => {
    res.json({ ok: await ordersQ.deleteOrder(pool, Number(req.params.id)) });
  }));

  app.get('/api/admin/items', adminGate, asyncHandler(async (req, res) => {
    res.json(await itemsQ.listItemsAdmin(pool, {}));
  }));

  app.post('/api/admin/items', adminGate, asyncHandler(async (req, res) => {
    res.json(await itemsQ.createItem(pool, req.body));
  }));

  app.put('/api/admin/items/:id', adminGate, asyncHandler(async (req, res) => {
    const item = await itemsQ.updateItem(pool, Number(req.params.id), req.body);
    if (!item) return res.status(404).json({ error: 'not_found' });
    res.json(item);
  }));

  app.delete('/api/admin/items/:id', adminGate, asyncHandler(async (req, res) => {
    res.json({ ok: await itemsQ.deleteItem(pool, Number(req.params.id)) });
  }));

  app.post('/api/admin/categories', adminGate, asyncHandler(async (req, res) => {
    res.json(await categoriesQ.createCategory(pool, req.body));
  }));

  app.put('/api/admin/categories/:id', adminGate, asyncHandler(async (req, res) => {
    const category = await categoriesQ.updateCategory(pool, Number(req.params.id), req.body);
    if (!category) return res.status(404).json({ error: 'not_found' });
    res.json(category);
  }));

  app.delete('/api/admin/categories/:id', adminGate, asyncHandler(async (req, res) => {
    res.json({ ok: await categoriesQ.deleteCategory(pool, Number(req.params.id)) });
  }));

  app.use(express.static(path.join(__dirname, '..', 'webapp')));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

module.exports = { createServer };
