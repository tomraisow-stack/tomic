// scripts/smoke.js — one-off Playwright smoke test against `npm run demo`.
// Not part of the automated suite (playwright isn't a saved dependency);
// this is a manual verification pass for tonight's build, run once and
// then this file (or the temp playwright install) can be deleted.
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = 8091;
const BASE = `http://localhost:${PORT}`;

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  async function attempt() {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch (e) {}
    if (Date.now() > deadline) throw new Error('server did not come up in time');
    await new Promise((r) => setTimeout(r, 300));
    return attempt();
  }
  return attempt();
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, 'demo.js')], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: 'pipe',
  });
  server.stdout.on('data', (d) => process.stdout.write(`[demo] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[demo:err] ${d}`));

  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + detail : ''}`);
  }

  try {
    await waitForServer(BASE + '/api/categories', 15000);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (err) => check('no JS runtime errors', false, err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') check('no console.error', false, msg.text()); });

    await page.goto(BASE);
    await page.waitForSelector('.grid .card', { timeout: 8000 });
    const cardCount = await page.locator('.grid .card').count();
    check('catalog grid renders seeded items', cardCount > 0, `${cardCount} cards`);
    await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'smoke-1-catalog.png') });

    // sort sheet
    await page.click('[data-action="sort-open"]');
    await page.waitForSelector('.sheet-option');
    await page.click('[data-action="sort-set"][data-value="price_asc"]');
    await page.waitForTimeout(300);
    check('sort sheet applies and closes', await page.locator('#sheet').isHidden());

    // category filter -> size chips appear
    await page.selectOption('#category-select', { index: 1 });
    await page.waitForTimeout(300);
    const chipCount = await page.locator('.size-chips .chip').count();
    check('size chips appear after picking a category', chipCount > 0, `${chipCount} chips`);

    // open product detail
    await page.click('.grid .card >> nth=0');
    await page.waitForSelector('.product-info', { timeout: 5000 });
    check('product detail screen renders', await page.locator('.product-price').isVisible());
    await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'smoke-2-product.png') });

    // add to cart
    await page.click('[data-action="add-to-cart"]');
    await page.waitForTimeout(600);
    const badgeText = await page.locator('#cart-badge').textContent();
    check('cart badge updates after add-to-cart', badgeText && badgeText.trim() !== '0', `badge="${badgeText}"`);

    // go to cart
    await page.click('.tab[data-tab="cart"]');
    await page.waitForSelector('.cart-row', { timeout: 5000 });
    check('cart row renders', await page.locator('.cart-row').count() > 0);
    const countdownText = await page.locator('.countdown').first().textContent();
    check('reservation countdown is ticking', /осталось/.test(countdownText || ''), countdownText);
    await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'smoke-3-cart.png') });

    // checkout
    await page.click('[data-action="checkout-open"]');
    await page.waitForSelector('#checkout-form');
    await page.fill('input[name="fio"]', 'Иван Иванов');
    await page.fill('input[name="phone"]', '+79990000000');
    await page.fill('textarea[name="address"]', 'г. Уфа, ул. Тестовая, 1');
    await page.click('#checkout-form button[type="submit"]');
    await page.waitForSelector('.success-icon', { timeout: 5000 });
    check('order success screen renders', await page.locator('.success-icon').isVisible());
    await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'smoke-4-success.png') });

    // upload a fake proof photo
    const fs = require('fs');
    const tmpImg = path.join(__dirname, '..', 'docs', '_smoke_proof.png');
    fs.writeFileSync(tmpImg, Buffer.from('89504e470d0a1a0a', 'hex'));
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('[data-action="upload-proof"]'),
    ]);
    await fileChooser.setFiles(tmpImg);
    await page.waitForTimeout(600);
    const proofStatus = await page.locator('#proof-status').textContent();
    check('payment proof upload succeeds', /отправлен/.test(proofStatus || ''), proofStatus);
    fs.unlinkSync(tmpImg);

    // admin flow
    await page.click('.tab[data-tab="admin"]');
    await page.waitForSelector('.order-card', { timeout: 5000 });
    check('admin sees the new order', await page.locator('.order-card').count() > 0);
    await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'smoke-5-admin-orders.png') });

    await page.click('[data-action="admin-order-confirm"]');
    await page.waitForTimeout(500);
    const statusText = await page.locator('.order-status').first().textContent();
    check('admin confirm-payment updates order status', /Оплачен/.test(statusText || ''), statusText);

    // admin items + categories tabs render without error
    await page.click('[data-action="admin-subtab"][data-tab="items"]');
    await page.waitForSelector('.list-row, .empty-state', { timeout: 5000 });
    check('admin items subtab renders', true);
    await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'smoke-6-admin-items.png') });

    await page.click('[data-action="admin-subtab"][data-tab="categories"]');
    await page.waitForSelector('.list-row, .empty-state', { timeout: 5000 });
    check('admin categories subtab renders', true);

    await page.click('[data-action="admin-subtab"][data-tab="items"]');
    await page.waitForSelector('.fab', { timeout: 5000 });
    await page.click('.fab');
    await page.waitForSelector('#item-form', { timeout: 5000 });
    check('admin item-add form renders', await page.locator('#item-form').isVisible());
    await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'smoke-7-admin-item-form.png') });

    await page.click('.tab[data-tab="catalog"]');
    await page.waitForSelector('.grid .card');
    await page.click('[data-action="sort-open"]');
    await page.waitForSelector('.sheet-option');
    await page.waitForTimeout(300);
    const sheetBox = await page.locator('.sheet-option').first().boundingBox();
    check('sort sheet is actually on screen (not mid-animation)', !!sheetBox && sheetBox.y < 844 && sheetBox.y > 0, JSON.stringify(sheetBox));
    await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'smoke-8-sort-sheet.png') });
    await page.click('[data-action="sheet-close"]');
    await page.waitForSelector('#sheet', { state: 'hidden' });
    await page.click('[data-action="search-open"]');
    await page.waitForSelector('.search-screen');
    await page.fill('#search-input', 'куртка');
    await page.waitForTimeout(500);
    check('search filters results', await page.locator('#search-results .card').count() > 0);
    await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'smoke-9-search.png') });

    await browser.close();
  } finally {
    server.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILURES:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('smoke test crashed', err);
  process.exit(1);
});
