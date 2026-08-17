// src/server.js
const express = require('express');
const path = require('path');
const multer = require('multer');
const { requireUser, requireAdmin } = require('./auth');
const categoriesQ = require('./queries/categories');
const itemsQ = require('./queries/items');
const ordersQ = require('./queries/orders');

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
    await itemsQ.releaseItem(pool, Number(req.params.itemId));
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
    if (!req.file) return res.status(400).json({ error: 'missing_photo' });
    if (!bot) return res.status(503).json({ error: 'bot_unavailable' });
    const fileId = await bot.sendProofPhoto(orderId, req.file.buffer);
    const proof = await ordersQ.addPaymentProof(pool, orderId, fileId);
    res.json(proof);
  }));

  app.use(express.static(path.join(__dirname, '..', 'webapp')));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

module.exports = { createServer };
