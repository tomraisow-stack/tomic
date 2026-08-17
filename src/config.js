function loadConfig(env) {
  function required(name) {
    const value = env[name];
    if (!value) throw new Error(`Missing required env var: ${name}`);
    return value;
  }
  return {
    botToken: required('BOT_TOKEN'),
    databaseUrl: required('DATABASE_URL'),
    adminIds: new Set(
      (env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)
    ),
    port: Number(env.PORT || 8080),
    reservationTtlMs: Number(env.RESERVATION_TTL_MINUTES || 30) * 60 * 1000,
    adminInitDataMaxAgeSeconds: Number(
      env.ADMIN_INITDATA_MAX_AGE_SECONDS || 30 * 24 * 3600
    ),
    userInitDataMaxAgeSeconds: Number(
      env.USER_INITDATA_MAX_AGE_SECONDS || 7 * 24 * 3600
    ),
  };
}

module.exports = { loadConfig };
