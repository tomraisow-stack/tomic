// src/auth.js
const { validateInitData } = require('./initData');

function readInitData(req) {
  return req.get('X-Telegram-Init-Data') || req.query.init_data;
}

function requireUser({ botToken, maxAgeSeconds }) {
  return (req, res, next) => {
    const result = validateInitData(readInitData(req), botToken, maxAgeSeconds);
    if (!result.valid) {
      return res.status(403).json({ error: 'forbidden', stale_signature: result.reason === 'stale_signature' });
    }
    req.telegramUser = result.user;
    next();
  };
}

function requireAdmin({ botToken, adminIds, maxAgeSeconds }) {
  return (req, res, next) => {
    const result = validateInitData(readInitData(req), botToken, maxAgeSeconds);
    if (!result.valid) {
      return res.status(403).json({ error: 'forbidden', stale_signature: result.reason === 'stale_signature' });
    }
    if (!result.user || !adminIds.has(String(result.user.id))) {
      return res.status(403).json({ error: 'forbidden' });
    }
    req.telegramUser = result.user;
    next();
  };
}

module.exports = { requireUser, requireAdmin };
