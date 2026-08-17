// src/initData.js
const crypto = require('crypto');

function validateInitData(initDataRaw, botToken, maxAgeSeconds) {
  if (!initDataRaw) return { valid: false, reason: 'missing' };

  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash) return { valid: false, reason: 'missing_hash' };
  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computedHash !== hash) return { valid: false, reason: 'bad_signature' };

  const authDate = Number(params.get('auth_date'));
  if (!authDate) return { valid: false, reason: 'missing_auth_date' };
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > maxAgeSeconds) return { valid: false, reason: 'stale_signature' };

  let user = null;
  const userRaw = params.get('user');
  if (userRaw) {
    try {
      user = JSON.parse(userRaw);
    } catch {
      user = null;
    }
  }

  return { valid: true, user, authDate };
}

module.exports = { validateInitData };
