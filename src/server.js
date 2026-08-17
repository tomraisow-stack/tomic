// src/server.js
const express = require('express');
const path = require('path');
const { requireUser, requireAdmin } = require('./auth');

function createServer({ pool, config, bot }) {
  const app = express();
  app.use(express.json());

  const userGate = requireUser({ botToken: config.botToken, maxAgeSeconds: config.userInitDataMaxAgeSeconds });
  const adminGate = requireAdmin({ botToken: config.botToken, adminIds: config.adminIds, maxAgeSeconds: config.adminInitDataMaxAgeSeconds });

  app.get('/api/config', userGate, (req, res) => {
    res.json({ isAdmin: config.adminIds.has(String(req.telegramUser.id)) });
  });

  app.use(express.static(path.join(__dirname, '..', 'webapp')));

  return app;
}

module.exports = { createServer };
