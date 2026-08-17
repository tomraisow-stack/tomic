// src/server.js
const express = require('express');
const path = require('path');
const { requireUser, requireAdmin } = require('./auth');
const categoriesQ = require('./queries/categories');
const itemsQ = require('./queries/items');

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function createServer({ pool, config, bot }) {
  const app = express();
  app.use(express.json());

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

  app.use(express.static(path.join(__dirname, '..', 'webapp')));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

module.exports = { createServer };
