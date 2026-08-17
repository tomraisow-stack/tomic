# Atgshmot Shop — backend + Mini App

Second-hand clothing shop Telegram bot + Mini App.

## Try it locally right now (no Postgres, no bot token)

```
npm install
npm run demo
```

Then open **http://localhost:8081** in a normal browser. This runs the full
Express app + `webapp/` frontend against an in-memory PostgreSQL (`pg-mem`)
seeded with sample categories/items, with a stub bot instead of a real
Telegram bot token. The demo user is auto-authenticated as an admin, so both
the customer storefront and the "⚙️ Админ" tab are reachable from one
browser tab. Data resets every time you restart the demo. See
`scripts/demo.js` for how the auth bypass works — it only exists in demo
mode, never in `src/main.js`.

## Real local development

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
- `src/main.js` — production process entrypoint, wires everything together.
- `webapp/` — the Mini App frontend: plain HTML/CSS/JS
  (`index.html`/`style.css`/`app.js`), no build step, no framework. Talks
  to `/api/*` via `X-Telegram-Init-Data`. Product photos uploaded through
  the admin panel land in `webapp/photos/` (git-ignored) and are served by
  the same `express.static` mount.
- `scripts/demo.js` — local demo harness described above.
- `scripts/smoke.js` — a one-off Playwright smoke test that drives the demo
  through the full customer + admin flow in a real headless browser and
  screenshots every screen into `docs/smoke-*.png`. Not part of `npm test`
  (Playwright is a ~120MB browser download, deliberately not a saved
  dependency). To re-run it: `npm install --no-save playwright && npx
  playwright install chromium && node scripts/smoke.js`.

## Known gaps before this is production-ready

- **Payment requisites are a placeholder.** `webapp/app.js`'s
  `PAYMENT_INFO_HTML` constant currently shows demo text, not real bank
  details — replace it before accepting real orders (deliberately not
  fabricated, per this project's own principle of not inventing facts that
  aren't real).
- **Deployment hasn't happened yet** — no VPS systemd unit, no Postgres
  database, no subdomain/TLS, no deploy script, no DB backup timer. All of
  that is scoped in `docs/superpowers/specs/2026-08-17-atgshmot-shop-design.md`'s
  "Deployment" section but deliberately not started, since it touches a
  shared production server (see the project's own reference memory on
  that box) and real infra changes shouldn't happen unsupervised.
