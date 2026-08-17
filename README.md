# Atgshmot Shop — backend

Second-hand clothing shop Telegram bot + Mini App API.

## Local development

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `BOT_TOKEN` (from
   @BotFather) and `ADMIN_IDS` (your Telegram numeric id). `DATABASE_URL`
   needs a real PostgreSQL instance reachable from your machine — this
   project has none bundled; automated tests instead use `pg-mem`, an
   in-memory PostgreSQL emulator, so `npm test` works without installing
   PostgreSQL.
3. `npm run dev` — starts the API + bot with auto-reload.
4. `npm test` — runs the full test suite against `pg-mem`.

## Project layout

- `src/queries/` — one file per table group, raw parameterized SQL.
- `src/server.js` — Express app and all `/api/*` routes.
- `src/bot.js` — grammY bot: admin notifications + proof-photo relaying.
- `src/adminActions.js` — shared confirm/cancel/mark-done logic.
- `src/main.js` — process entrypoint, wires everything together.
- `webapp/` — Mini App frontend (built in a separate plan).
