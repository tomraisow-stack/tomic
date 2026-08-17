# Atgshmot Shop — Telegram Mini App (design spec)

Date: 2026-08-17

## Purpose

A new, fully independent Telegram bot + Mini App storefront for a
second-hand clothing shop ("Atgshmot"). Every item is a unique,
one-of-a-kind piece (no per-size stock) — condition, size and photos
matter per item, not per SKU. This is a **third project**, separate
from `Bot/` (the original grocery/VPN bot) and `shop-mini-app` (the
food/VPN Mini App) — own bot token, own database, own service, own
domain, deployed alongside them on the same VPS.

## Stack

- **Bot + API server**: Node.js + [grammY](https://grammy.dev) for the
  bot (order/payment notifications to the admin only — no chat-based
  ordering flow) + Express for REST API and static `webapp/` hosting.
  One process, mirroring the existing Python projects' pattern of
  bot-polling + web-server sharing a single process.
- **Database**: PostgreSQL. New database (e.g. `atgshmot`) on the VPS.
  Access via the `pg` package with hand-written SQL — no ORM. Chosen
  to stay close to the raw-SQL style already used in `shop-mini-app`'s
  `db.py`, and an ORM isn't justified at this scale (a single small
  shop).
- **Frontend**: plain HTML/CSS/JS + Telegram's `telegram-web-app.js`
  SDK. Theme follows `Telegram.WebApp.themeParams` automatically
  (dark/light).
- **Node runtime on the server**: the VPS currently has Node.js 12
  (installed for `shop-mini-app`'s JS test harness), too old for
  grammY/modern Express (need 18+). A prior attempt to upgrade via
  NodeSource broke `dpkg` (file conflict with the apt `libnode-dev`
  package). **Install Node 18+ via `nvm`** (user-space, does not touch
  the system apt package) to avoid repeating that conflict. The old
  apt Node 12 stays untouched for whatever still uses it.

## Data model (PostgreSQL)

- **categories** — `id, name, sort_order`
- **items** — `id, category_id, name, price, size (text, free-form),
  condition_text, photos (jsonb array of Telegram file_id/url),
  status ('available' | 'reserved' | 'sold'), created_at`. No stock
  table — each item is exactly one physical piece, tracked entirely
  through `status`.
- **cart_reservations** — `id, item_id (unique while active), user_id,
  reserved_at, expires_at`. An item counts as "in someone's cart" for
  as long as a live reservation row exists.
- **orders** — `id, user_id, fio, phone, address, total, status
  ('ожидает оплаты' | 'оплачен' | 'отменён' | 'выполнен'), created_at`
- **order_items** — `order_id, item_id, price_at_order` (price is
  captured at order time so later catalog edits can't retroactively
  change a placed order's total)
- **payment_proofs** — `id, order_id, telegram_file_id, uploaded_at`

### Reservation / concurrency (prevents double-selling a unique item)

`POST /api/cart/add` atomically flips the target item from
`available` → `reserved` with a conditional `UPDATE ... WHERE status =
'available'` and inserts a `cart_reservations` row in the same
transaction. If the row-count from the UPDATE is 0 (already reserved
or sold), the endpoint returns 409 and the frontend shows "this item
was just reserved by someone else."

A reservation lasts **30 minutes** (mirrors the existing
unpaid-order-auto-cancel pattern from `shop-mini-app`). A background
task, run via `setInterval` inside the same Express process (not
relying on a PTB-style `post_init` hook — that pattern silently never
fired in the sister project and is explicitly not being repeated
here), sweeps expired `cart_reservations` every ~60s: deletes the
reservation row and flips the item back to `available` unless an order
was placed for it in the meantime.

**Order → sold transition**: placing an order moves the reservation
into `orders`/`order_items`; the item's `status` stays `reserved` (not
yet `sold`) until an admin confirms payment. This lets the admin
cancel a fraudulent/unpaid order and put the item back on sale without
a stuck "sold" item that was never actually paid for. Only an explicit
admin "confirm payment" action sets `status = 'sold'`.

## Screens

Categories default to **Верх / Низ / Обувь / Аксессуары** (easily
edited later via the admin tab — not hardcoded assumptions, just a
starting seed). Size is a **free-text field per item**, not a
size-grid — each item is one real garment with one real size, so
there's no S/M/L stock concept. The "Размер" filter shown after
picking a category is built from the distinct size values actually
present among that category's items.

1. **Каталог** — two-column card grid (photo/price/name), top tabs
   Каталог/Корзина.
2. **Filter bar** — sort icon (bottom-sheet: дешевле / дороже / новые
   — no "по популярности", see below), category dropdown, full-screen
   search icon, and a size-chip filter row that appears once a
   category is selected.
3. **Product card** — swipeable photo carousel with dot indicators, a
   share icon (`Telegram.WebApp.switchInlineQuery` or native share),
   price, a size chip, a "Состояние" text block, and a full-width
   sticky "Добавить в корзину" button at the bottom. If the item is
   currently reserved by someone else, the button is disabled with an
   explanatory label instead of hidden (so browsing still makes sense).
4. **Корзина** — list of reserved items (no quantity >1 per row —
   each item is a unique piece), a running total, a countdown per row
   showing time left before the reservation expires, and a checkout
   button. Empty state: centered "Корзина пуста".
5. **Оформление заказа** — form (ФИО / телефон / адрес доставки).
   Submitting converts the reservation into `orders` +`order_items`.
   Payment is **by requisites** (bank transfer details shown in-app) +
   photo/screenshot proof upload (`POST /api/proof`), mirroring
   `shop-mini-app`'s existing flow — no Telegram Payments integration.
   Success screen offers the upload button immediately.
6. **Админка (tab inside the Mini App, not bot commands)** — order
   list with confirm-payment / cancel / mark-done actions; item
   CRUD (add/edit/delete, photo upload via the bot); category list
   management. Gated the same way as `shop-mini-app`: Telegram
   `initData` HMAC signature validated server-side plus an `ADMIN_IDS`
   allowlist, checked independently on every admin endpoint (never
   trust client-side tab visibility as the real gate).

### Sorting

The original request's "по популярности" sort is **dropped** — since
each item sells exactly once and then disappears from the catalog,
there is no sound popularity signal to sort by (unlike
`shop-mini-app`'s repeat-purchase groceries, where real order counts
work). Sort options are: **сначала дешевле**, **сначала дороже**,
**сначала новые** (by `created_at`).

## Style

Dark Telegram-native theme (falls back to light via
`Telegram.WebApp.themeParams`), rounded cards, pill-shaped buttons,
minimal color — product photos are the primary visual element.

## Deployment

New, fully separate deployment on the same VPS as `Bot/` and
`shop-mini-app`:

- `/opt/atgshmot-shop/` (server) / `c:\Users\Lenovo\Desktop\atgshmot-shop\`
  (local), own git history.
- New systemd unit `atgshmot-shop.service`, `Restart=always`.
- New subdomain + its own TLS cert (same DuckDNS-based pattern as
  `shop-mini-app`).
- Own `.env` (bot token, DB credentials, admin IDs) — never shared
  with the other two projects' secrets.
- New PostgreSQL database, separate from anything SQLite-based the
  other two projects use.
- **Gated deploy script**, following the proven `safe_deploy.sh` +
  `predeploy_check.py` pattern from `shop-mini-app`: syntax/schema
  checks on the candidate before promotion, automatic rollback on any
  post-deploy health-check failure (service active, no
  `Traceback`/`ERROR` in the journal, a real `curl` 200 against the
  running service).
- **Daily DB backup**: `pg_dump` equivalent of the existing
  `sqlite3 .backup` pattern, sent to `ADMIN_IDS` via Telegram
  `sendDocument`, pruned locally after 14 days, via its own systemd
  timer (offset from the other two projects' backup timers so they
  don't collide).

Deployment work happens after the local implementation is built and
tested — this section fixes the *plan*, not an immediate action.

## Explicitly out of scope (per user's answers)

- Telegram Payments / payment-provider integration (using
  pay-by-requisites + receipt photo instead).
- Per-size stock / multi-quantity items (this is a one-of-a-kind
  second-hand shop).
- "Popularity" sort (no honest signal exists for single-sale items).
- Cross-project VPN/catalog sharing — this project has no VPN feature
  and does not touch `Bot/` or `shop-mini-app`'s databases.
