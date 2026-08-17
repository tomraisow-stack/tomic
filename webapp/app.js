// webapp/app.js — Atgshmot Mini App frontend. Plain JS, no build step,
// no framework: talks to the REST API in src/server.js and renders one
// screen at a time into #screen. Works both inside Telegram (real
// initData from the WebApp SDK) and in a plain browser against
// `npm run demo` (falls back to a signed demo initData from
// /api/demo/init-data, a route that only exists in demo mode).

(function () {
  'use strict';

  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    try { tg.ready(); tg.expand(); } catch (e) {}
  }

  // ---------------------------------------------------------------------
  // Telegram theme + haptics + native dialogs (all no-ops outside Telegram)
  // ---------------------------------------------------------------------

  function applyTelegramTheme() {
    if (!tg || !tg.themeParams) return;
    var map = {
      '--tg-bg': tg.themeParams.bg_color,
      '--tg-secondary-bg': tg.themeParams.secondary_bg_color,
      '--tg-text': tg.themeParams.text_color,
      '--tg-hint': tg.themeParams.hint_color,
      '--tg-link': tg.themeParams.link_color,
      '--tg-button': tg.themeParams.button_color,
      '--tg-button-text': tg.themeParams.button_text_color,
    };
    Object.keys(map).forEach(function (key) {
      if (map[key]) document.documentElement.style.setProperty(key, map[key]);
    });
    try {
      tg.setHeaderColor && tg.setHeaderColor('secondary_bg_color');
      tg.setBackgroundColor && tg.setBackgroundColor(tg.themeParams.bg_color || '#0e0e12');
    } catch (e) {}
  }
  applyTelegramTheme();
  if (tg && tg.onEvent) tg.onEvent('themeChanged', applyTelegramTheme);

  function haptic(kind) {
    if (!tg || !tg.HapticFeedback) return;
    try {
      if (kind === 'success' || kind === 'error' || kind === 'warning') {
        tg.HapticFeedback.notificationOccurred(kind);
      } else {
        tg.HapticFeedback.impactOccurred(kind || 'light');
      }
    } catch (e) {}
  }

  function confirmDialog(message) {
    return new Promise(function (resolve) {
      if (tg && tg.showConfirm) {
        try { tg.showConfirm(message, function (ok) { resolve(!!ok); }); return; } catch (e) {}
      }
      resolve(window.confirm(message));
    });
  }

  function alertDialog(message) {
    if (tg && tg.showAlert) {
      try { tg.showAlert(message); return; } catch (e) {}
    }
    window.alert(message);
  }

  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2200);
  }

  // ---------------------------------------------------------------------
  // Auth: Telegram initData, with a demo fallback for plain-browser use
  // ---------------------------------------------------------------------

  var initDataCache = null;

  function getInitData() {
    if (initDataCache !== null) return Promise.resolve(initDataCache);
    if (tg && tg.initData) {
      initDataCache = tg.initData;
      return Promise.resolve(initDataCache);
    }
    return fetch('/api/demo/init-data')
      .then(function (res) { return res.ok ? res.json() : { initData: '' }; })
      .then(function (data) { initDataCache = data.initData || ''; return initDataCache; })
      .catch(function () { initDataCache = ''; return initDataCache; });
  }

  function api(path, options) {
    options = options || {};
    return getInitData().then(function (initData) {
      var headers = Object.assign({ 'X-Telegram-Init-Data': initData }, options.headers || {});
      var body = options.body;
      if (body && !(body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body);
      }
      return fetch(path, Object.assign({}, options, { headers: headers, body: body }));
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) {}
        if (!res.ok) {
          var err = new Error((data && data.error) || ('HTTP ' + res.status));
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) {
    return Number(n || 0).toLocaleString('ru-RU') + ' ₽';
  }

  function firstPhoto(photos) {
    return Array.isArray(photos) && photos.length ? photos[0] : null;
  }

  function photoTag(url, cssClass) {
    return url
      ? '<img src="' + escapeHtml(url) + '" alt="" loading="lazy" class="' + (cssClass || '') + '">'
      : '<div class="no-photo">🧥</div>';
  }

  var ORDER_STATUS_LABEL = {
    'ожидает оплаты': 'Ожидает оплаты',
    'оплачен': 'Оплачен',
    'отменён': 'Отменён',
    'выполнен': 'Выполнен',
  };
  var ORDER_STATUS_CLASS = {
    'ожидает оплаты': 'pending',
    'оплачен': 'paid',
    'отменён': 'cancelled',
    'выполнен': 'done',
  };

  var SORT_OPTIONS = [
    { value: 'new', label: 'Сначала новые' },
    { value: 'price_asc', label: 'Сначала дешевле' },
    { value: 'price_desc', label: 'Сначала дороже' },
  ];

  // Placeholder — the shop owner must replace this with real payment
  // requisites before going live; deliberately not fabricated.
  var PAYMENT_INFO_HTML =
    '<b>Оплата по реквизитам</b>\n' +
    'Переведите сумму заказа и пришлите скриншот/чек об оплате.\n\n' +
    '⚠️ Демонстрационный текст — замените на реальные реквизиты\n' +
    'в webapp/app.js (переменная PAYMENT_INFO_HTML) перед запуском.';

  function paymentInfoHtml() {
    return PAYMENT_INFO_HTML.replace(/\n/g, '<br>');
  }

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  var state = {
    tab: 'catalog',
    isAdmin: false,
    categories: [],
    filter: { categoryId: '', size: '', sort: 'new', search: '' },
    adminSubtab: 'orders',
  };

  var screenEl = document.getElementById('screen');
  var backBtn = document.getElementById('back-btn');
  var tabbarEl = document.getElementById('tabbar');
  var adminTabEl = document.getElementById('admin-tab');
  var cartBadgeEl = document.getElementById('cart-badge');
  var sheetEl = document.getElementById('sheet');
  var sheetOverlayEl = document.getElementById('sheet-overlay');

  var activeInterval = null;
  function clearActiveInterval() {
    if (activeInterval) { clearInterval(activeInterval); activeInterval = null; }
  }

  var goBackTarget = null;

  function renderScreen(html, opts) {
    opts = opts || {};
    clearActiveInterval();
    screenEl.innerHTML = html;
    screenEl.scrollTop = 0;
    goBackTarget = opts.back || null;
    backBtn.hidden = !goBackTarget;
    if (tg && tg.BackButton) {
      try {
        if (goBackTarget) { tg.BackButton.show(); } else { tg.BackButton.hide(); }
      } catch (e) {}
    }
  }

  if (tg && tg.BackButton && tg.BackButton.onClick) {
    try { tg.BackButton.onClick(function () { if (goBackTarget) goBackTarget(); }); } catch (e) {}
  }

  function setActiveTab(tab) {
    state.tab = tab;
    Array.prototype.forEach.call(tabbarEl.querySelectorAll('.tab'), function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
  }

  function goToTab(tab) {
    haptic('light');
    setActiveTab(tab);
    if (tab === 'catalog') return renderCatalog();
    if (tab === 'cart') return renderCart();
    if (tab === 'admin') return renderAdminHome();
  }

  tabbarEl.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.tab');
    if (!btn || btn.hidden) return;
    goToTab(btn.dataset.tab);
  });

  backBtn.addEventListener('click', function () { if (goBackTarget) goBackTarget(); });

  // ---------------------------------------------------------------------
  // Bottom sheet (generic)
  // ---------------------------------------------------------------------

  function openSheet(html) {
    sheetEl.innerHTML = html;
    sheetEl.hidden = false;
    sheetOverlayEl.hidden = false;
  }
  function closeSheet() {
    sheetEl.hidden = true;
    sheetOverlayEl.hidden = true;
    sheetEl.innerHTML = '';
  }
  sheetOverlayEl.addEventListener('click', closeSheet);

  function openSortSheet() {
    haptic('light');
    var html = '<div class="handle"></div><div class="sheet-title">Сортировка</div>' +
      SORT_OPTIONS.map(function (opt) {
        var active = state.filter.sort === opt.value;
        return '<button class="sheet-option' + (active ? ' active' : '') + '" data-action="sort-set" data-value="' + opt.value + '">' +
          escapeHtml(opt.label) + (active ? ' ✓' : '') + '</button>';
      }).join('');
    openSheet(html);
  }

  // ---------------------------------------------------------------------
  // Cart badge
  // ---------------------------------------------------------------------

  function refreshCartBadge() {
    return api('/api/cart').then(function (rows) {
      var count = rows.length;
      cartBadgeEl.hidden = count === 0;
      cartBadgeEl.textContent = count > 9 ? '9+' : String(count);
      return rows;
    }).catch(function () { return []; });
  }

  // ---------------------------------------------------------------------
  // Catalog
  // ---------------------------------------------------------------------

  function renderCatalog() {
    renderScreen(
      '<div class="filterbar">' +
        '<button class="filter-btn" data-action="sort-open">↕ ' + escapeHtml(sortLabel()) + '</button>' +
        '<select class="filter-select" id="category-select">' +
          '<option value="">Все категории</option>' +
          state.categories.map(function (c) {
            return '<option value="' + c.id + '"' + (String(state.filter.categoryId) === String(c.id) ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>';
          }).join('') +
        '</select>' +
        '<button class="filter-btn icon-square" data-action="search-open">🔍</button>' +
      '</div>' +
      '<div id="size-chips"></div>' +
      '<div id="catalog-grid"><div class="skeleton-block"></div></div>'
    );

    var categorySelect = document.getElementById('category-select');
    categorySelect.addEventListener('change', function () {
      state.filter.categoryId = categorySelect.value;
      state.filter.size = '';
      haptic('light');
      loadCatalogGrid();
    });

    loadCatalogGrid();
  }

  function sortLabel() {
    var found = SORT_OPTIONS.filter(function (o) { return o.value === state.filter.sort; })[0];
    return found ? found.label : 'Сортировка';
  }

  function loadCatalogGrid() {
    var gridEl = document.getElementById('catalog-grid');
    var chipsEl = document.getElementById('size-chips');
    if (!gridEl) return;

    var query = { sort: state.filter.sort };
    if (state.filter.categoryId) query.categoryId = state.filter.categoryId;
    if (state.filter.search) query.search = state.filter.search;

    var qs = Object.keys(query).map(function (k) { return k + '=' + encodeURIComponent(query[k]); }).join('&');

    api('/api/items?' + qs).then(function (items) {
      if (chipsEl) {
        if (state.filter.categoryId) {
          var sizes = Array.from(new Set(items.map(function (i) { return i.size; }).filter(Boolean))).sort();
          chipsEl.innerHTML = sizes.length
            ? '<div class="size-chips">' + sizes.map(function (s) {
                var active = state.filter.size === s;
                return '<button class="chip' + (active ? ' active' : '') + '" data-action="size-chip" data-value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</button>';
              }).join('') + '</div>'
            : '';
        } else {
          chipsEl.innerHTML = '';
        }
      }

      var filtered = state.filter.size ? items.filter(function (i) { return i.size === state.filter.size; }) : items;

      if (!filtered.length) {
        gridEl.innerHTML = '<div class="empty-state"><div class="emoji">🔎</div><div>Ничего не найдено</div></div>';
        return;
      }

      gridEl.innerHTML = '<div class="grid">' + filtered.map(renderCard).join('') + '</div>';
    }).catch(function () {
      gridEl.innerHTML = '<div class="empty-state"><div class="emoji">⚠️</div><div>Не удалось загрузить каталог</div></div>';
    });
  }

  function renderCard(item) {
    var badge = '';
    if (item.status === 'reserved') badge = '<span class="status-badge reserved">В корзине у другого</span>';
    if (item.status === 'sold') badge = '<span class="status-badge sold">Продано</span>';
    return (
      '<div class="card" data-action="open-product" data-id="' + item.id + '">' +
        '<div class="card-photo">' + badge + photoTag(firstPhoto(item.photos)) + '</div>' +
        '<div class="card-body">' +
          '<div class="card-price">' + money(item.price) + '</div>' +
          '<div class="card-name">' + escapeHtml(item.name) + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------------
  // Search (full-screen)
  // ---------------------------------------------------------------------

  function renderSearch() {
    renderScreen(
      '<div class="search-screen">' +
        '<div class="search-input-row">' +
          '<input type="search" id="search-input" class="search-input" placeholder="Поиск по названию" value="' + escapeHtml(state.filter.search) + '">' +
          '<button class="icon-btn" data-action="search-close">✕</button>' +
        '</div>' +
        '<div id="search-results"></div>' +
      '</div>',
      { back: renderCatalog }
    );

    var input = document.getElementById('search-input');
    input.focus();
    var timer = null;
    function runSearch() {
      var q = input.value.trim();
      var resultsEl = document.getElementById('search-results');
      if (!q) { resultsEl.innerHTML = ''; return; }
      api('/api/items?search=' + encodeURIComponent(q)).then(function (items) {
        resultsEl.innerHTML = items.length
          ? '<div class="grid">' + items.map(renderCard).join('') + '</div>'
          : '<div class="empty-state"><div class="emoji">🔎</div><div>Ничего не найдено</div></div>';
      });
    }
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(runSearch, 300);
    });
    if (state.filter.search) runSearch();
  }

  function closeSearch(finalQuery) {
    state.filter.search = finalQuery || '';
    renderCatalog();
  }

  // ---------------------------------------------------------------------
  // Product detail
  // ---------------------------------------------------------------------

  function renderProduct(id) {
    renderScreen('<div class="skeleton-block"></div>', { back: renderCatalog });
    api('/api/items/' + id).then(function (item) {
      var photos = Array.isArray(item.photos) ? item.photos : [];
      var slides = photos.length
        ? photos.map(function (p) { return '<div class="carousel-slide">' + photoTag(p) + '</div>'; }).join('')
        : '<div class="carousel-slide"><div class="no-photo">🧥</div></div>';
      var dots = photos.length > 1
        ? '<div class="carousel-dots">' + photos.map(function (_, i) { return '<span class="dot' + (i === 0 ? ' active' : '') + '"></span>'; }).join('') + '</div>'
        : '';

      var ctaLabel = 'Добавить в корзину';
      var ctaDisabled = false;
      if (item.status === 'reserved') { ctaLabel = 'Уже в чьей-то корзине'; ctaDisabled = true; }
      if (item.status === 'sold') { ctaLabel = 'Продано'; ctaDisabled = true; }

      renderScreen(
        '<div class="carousel">' +
          '<div class="carousel-track" id="carousel-track">' + slides + '</div>' +
          dots +
          '<button class="carousel-share" data-action="share" data-id="' + item.id + '" aria-label="Поделиться">↗</button>' +
        '</div>' +
        '<div class="product-info">' +
          '<div class="product-price">' + money(item.price) + '</div>' +
          '<div class="product-chips">' +
            (item.size ? '<span class="product-chip">Размер: ' + escapeHtml(item.size) + '</span>' : '') +
          '</div>' +
          '<div style="font-size:16px;font-weight:600;margin-top:4px;">' + escapeHtml(item.name) + '</div>' +
          (item.condition_text
            ? '<div class="condition-block"><h4>Состояние</h4><p>' + escapeHtml(item.condition_text) + '</p></div>'
            : '') +
        '</div>' +
        '<div style="height:76px;"></div>' +
        '<div class="sticky-cta">' +
          '<button class="btn btn-shadow" data-action="add-to-cart" data-id="' + item.id + '"' + (ctaDisabled ? ' disabled' : '') + '>' + escapeHtml(ctaLabel) + '</button>' +
        '</div>',
        { back: renderCatalog }
      );

      var track = document.getElementById('carousel-track');
      if (track) {
        track.addEventListener('scroll', function () {
          var idx = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
          var dotEls = screenEl.querySelectorAll('.carousel-dots .dot');
          Array.prototype.forEach.call(dotEls, function (d, i) { d.classList.toggle('active', i === idx); });
        });
      }
    }).catch(function () {
      renderScreen('<div class="empty-state"><div class="emoji">⚠️</div><div>Товар не найден</div></div>', { back: renderCatalog });
    });
  }

  function shareItem(id) {
    var url = window.location.origin + window.location.pathname + '#item-' + id;
    if (tg && tg.switchInlineQuery) {
      try { tg.switchInlineQuery(String(id), ['users', 'groups']); return; } catch (e) {}
    }
    if (navigator.share) {
      navigator.share({ title: 'Atgshmot', url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { toast('Ссылка скопирована'); });
      return;
    }
    toast(url);
  }

  function addToCart(id) {
    api('/api/cart/add', { method: 'POST', body: { itemId: Number(id) } }).then(function () {
      haptic('success');
      toast('Добавлено в корзину');
      refreshCartBadge();
      renderProduct(id);
    }).catch(function (err) {
      haptic('error');
      if (err.status === 409) {
        alertDialog('Этот товар только что забронировал кто-то другой.');
        renderProduct(id);
      } else if (err.status === 403) {
        alertDialog('Не удалось подтвердить сессию Telegram. Переоткройте приложение.');
      } else {
        alertDialog('Не получилось добавить товар в корзину.');
      }
    });
  }

  // ---------------------------------------------------------------------
  // Cart
  // ---------------------------------------------------------------------

  function renderCart() {
    renderScreen('<div class="skeleton-block"></div>');
    api('/api/cart').then(function (rows) {
      cartBadgeEl.hidden = rows.length === 0;
      cartBadgeEl.textContent = rows.length > 9 ? '9+' : String(rows.length);

      if (!rows.length) {
        renderScreen('<div class="empty-state"><div class="emoji">🛍</div><div>Корзина пуста</div>' +
          '<button class="btn small" data-action="goto-catalog" style="width:auto;padding:0 20px;">В каталог</button></div>');
        return;
      }

      var total = rows.reduce(function (sum, r) { return sum + Number(r.price); }, 0);

      renderScreen(
        rows.map(cartRowHtml).join('') +
        '<div style="height:96px;"></div>' +
        '<div class="cart-summary">' +
          '<div class="total-row"><span>Итого (' + rows.length + ')</span><b>' + money(total) + '</b></div>' +
          '<button class="btn" data-action="checkout-open">Оформить заказ</button>' +
        '</div>'
      );

      activeInterval = setInterval(function () { tickCartCountdowns(rows); }, 1000);
      tickCartCountdowns(rows);
    }).catch(function () {
      renderScreen('<div class="empty-state"><div class="emoji">⚠️</div><div>Не удалось загрузить корзину</div></div>');
    });
  }

  function cartRowHtml(row) {
    return (
      '<div class="cart-row">' +
        '<div class="thumb">' + photoTag(firstPhoto(row.photos)) + '</div>' +
        '<div class="meta">' +
          '<div class="name">' + escapeHtml(row.name) + '</div>' +
          (row.size ? '<div class="sub">Размер: ' + escapeHtml(row.size) + '</div>' : '') +
          '<div class="price">' + money(row.price) + '</div>' +
          '<div class="countdown" id="cd-' + row.reservation_id + '" data-expires="' + escapeHtml(row.expires_at) + '"></div>' +
        '</div>' +
        '<button class="icon-btn remove" data-action="cart-remove" data-reservation="' + row.reservation_id + '" data-item="' + row.item_id + '" aria-label="Убрать">✕</button>' +
      '</div>'
    );
  }

  var cartExpiredHandled = false;
  function tickCartCountdowns() {
    var els = screenEl.querySelectorAll('[id^="cd-"]');
    var anyExpired = false;
    Array.prototype.forEach.call(els, function (el) {
      var expires = Date.parse(el.dataset.expires + (el.dataset.expires.endsWith('Z') ? '' : 'Z'));
      var msLeft = expires - Date.now();
      if (msLeft <= 0) {
        el.textContent = 'бронь истекла…';
        el.classList.add('warn');
        anyExpired = true;
        return;
      }
      var totalSec = Math.floor(msLeft / 1000);
      var mm = Math.floor(totalSec / 60);
      var ss = totalSec % 60;
      el.textContent = 'осталось ' + mm + ':' + (ss < 10 ? '0' : '') + ss;
      if (msLeft < 60000) el.classList.add('warn'); else el.classList.remove('warn');
    });
    if (anyExpired && !cartExpiredHandled) {
      cartExpiredHandled = true;
      setTimeout(function () { cartExpiredHandled = false; if (state.tab === 'cart') renderCart(); }, 2000);
    }
  }

  function removeFromCart(itemId) {
    api('/api/cart/' + itemId, { method: 'DELETE' }).then(function () {
      haptic('light');
      renderCart();
    }).catch(function () {
      alertDialog('Не получилось убрать товар из корзины.');
    });
  }

  // ---------------------------------------------------------------------
  // Checkout + success + payment proof
  // ---------------------------------------------------------------------

  function renderCheckout() {
    renderScreen(
      '<form id="checkout-form">' +
        '<div class="info-block">' + paymentInfoHtml() + '</div>' +
        '<div class="form-group"><label>ФИО</label><input class="form-input" name="fio" required autocomplete="name"></div>' +
        '<div class="form-group"><label>Телефон</label><input class="form-input" name="phone" required autocomplete="tel" inputmode="tel"></div>' +
        '<div class="form-group"><label>Адрес доставки</label><textarea class="form-textarea" name="address" required autocomplete="street-address"></textarea></div>' +
        '<div id="checkout-error" class="form-error"></div>' +
        '<button type="submit" class="btn">Оформить заказ</button>' +
      '</form>',
      { back: renderCart }
    );

    document.getElementById('checkout-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var form = ev.target;
      var errorEl = document.getElementById('checkout-error');
      errorEl.textContent = '';
      var payload = {
        fio: form.fio.value.trim(),
        phone: form.phone.value.trim(),
        address: form.address.value.trim(),
      };
      if (!payload.fio || !payload.phone || !payload.address) {
        errorEl.textContent = 'Заполните все поля.';
        return;
      }
      var submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      api('/api/orders', { method: 'POST', body: payload }).then(function (order) {
        haptic('success');
        refreshCartBadge();
        renderSuccess(order);
      }).catch(function (err) {
        haptic('error');
        submitBtn.disabled = false;
        errorEl.textContent = err.status === 400 && err.data && err.data.error === 'empty_cart'
          ? 'Корзина пуста — вернитесь и добавьте товары.'
          : 'Не получилось оформить заказ. Попробуйте ещё раз.';
      });
    });
  }

  function renderSuccess(order) {
    renderScreen(
      '<div style="text-align:center;padding-top:8px;">' +
        '<div class="success-icon">✓</div>' +
        '<div style="font-size:18px;font-weight:700;">Заказ #' + order.id + ' оформлен</div>' +
        '<div style="color:var(--muted);margin-top:4px;">Сумма: ' + money(order.total) + '</div>' +
      '</div>' +
      '<div class="info-block" style="margin-top:20px;">' + paymentInfoHtml() + '</div>' +
      '<button class="btn" id="proof-btn" data-action="upload-proof" data-order="' + order.id + '">📎 Прикрепить чек об оплате</button>' +
      '<input type="file" id="proof-file" accept="image/*" hidden>' +
      '<div id="proof-status" class="upload-row"></div>' +
      '<button class="btn secondary" style="margin-top:12px;" data-action="goto-catalog">Продолжить покупки</button>',
      { back: renderCatalog }
    );
  }

  function triggerProofUpload(orderId) {
    var fileInput = document.getElementById('proof-file');
    fileInput.onchange = function () {
      var file = fileInput.files[0];
      if (!file) return;
      var statusEl = document.getElementById('proof-status');
      statusEl.textContent = 'Загрузка…';
      var fd = new FormData();
      fd.append('orderId', orderId);
      fd.append('photo', file);
      api('/api/proof', { method: 'POST', body: fd }).then(function () {
        haptic('success');
        statusEl.textContent = '✅ Чек отправлен продавцу';
        var btn = document.getElementById('proof-btn');
        if (btn) btn.textContent = '📎 Отправить ещё раз';
      }).catch(function () {
        haptic('error');
        statusEl.textContent = '⚠️ Не получилось отправить чек, попробуйте ещё раз';
      });
    };
    fileInput.click();
  }

  // ---------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------

  function renderAdminHome() {
    renderScreen(
      '<div class="admin-subtabs">' +
        adminSubtabBtn('orders', 'Заказы') +
        adminSubtabBtn('items', 'Товары') +
        adminSubtabBtn('categories', 'Категории') +
      '</div>' +
      '<div id="admin-body"><div class="skeleton-block"></div></div>'
    );
    loadAdminSubtab();
  }

  function adminSubtabBtn(key, label) {
    return '<button class="pill' + (state.adminSubtab === key ? ' active' : '') + '" data-action="admin-subtab" data-tab="' + key + '">' + label + '</button>';
  }

  function setAdminSubtab(tab) {
    state.adminSubtab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('.admin-subtabs .pill'), function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    loadAdminSubtab();
  }

  function loadAdminSubtab() {
    if (state.adminSubtab === 'orders') return loadAdminOrders();
    if (state.adminSubtab === 'items') return loadAdminItems();
    if (state.adminSubtab === 'categories') return loadAdminCategories();
  }

  // ---- admin: orders ----

  function loadAdminOrders() {
    var body = document.getElementById('admin-body');
    api('/api/admin/orders').then(function (orders) {
      if (!orders.length) {
        body.innerHTML = '<div class="empty-state"><div class="emoji">📦</div><div>Заказов пока нет</div></div>';
        return;
      }
      body.innerHTML = orders.map(orderCardHtml).join('');
    }).catch(function () {
      body.innerHTML = '<div class="empty-state"><div class="emoji">⚠️</div><div>Не удалось загрузить заказы</div></div>';
    });
  }

  function orderCardHtml(order) {
    var cls = ORDER_STATUS_CLASS[order.status] || '';
    var label = ORDER_STATUS_LABEL[order.status] || order.status;
    var actions = [];
    if (order.status === 'ожидает оплаты') {
      actions.push('<button class="btn small" data-action="admin-order-confirm" data-id="' + order.id + '">Подтвердить оплату</button>');
      actions.push('<button class="btn small secondary" data-action="admin-order-cancel" data-id="' + order.id + '">Отменить</button>');
    } else if (order.status === 'оплачен') {
      actions.push('<button class="btn small" data-action="admin-order-done" data-id="' + order.id + '">Отметить выполненным</button>');
      actions.push('<button class="btn small secondary" data-action="admin-order-cancel" data-id="' + order.id + '">Отменить</button>');
    }
    actions.push('<button class="btn small danger" data-action="admin-order-delete" data-id="' + order.id + '">Удалить</button>');

    return (
      '<div class="order-card">' +
        '<div class="head"><span class="id">Заказ #' + order.id + '</span><span class="order-status ' + cls + '">' + escapeHtml(label) + '</span></div>' +
        '<div class="line">' + escapeHtml(order.fio) + ' · ' + escapeHtml(order.phone) + '</div>' +
        '<div class="line">' + escapeHtml(order.address) + '</div>' +
        '<div class="line"><b>' + money(order.total) + '</b></div>' +
        '<div class="order-actions">' + actions.join('') + '</div>' +
      '</div>'
    );
  }

  function adminOrderAction(action, id) {
    var endpoints = {
      confirm: { method: 'POST', url: '/api/admin/orders/' + id + '/confirm' },
      cancel: { method: 'POST', url: '/api/admin/orders/' + id + '/cancel' },
      done: { method: 'POST', url: '/api/admin/orders/' + id + '/done' },
      delete: { method: 'DELETE', url: '/api/admin/orders/' + id },
    };
    var ep = endpoints[action];
    var run = function () {
      api(ep.url, { method: ep.method }).then(function () {
        haptic('success');
        loadAdminOrders();
      }).catch(function () {
        haptic('error');
        alertDialog('Действие не выполнено.');
      });
    };
    if (action === 'delete' || action === 'cancel') {
      confirmDialog(action === 'delete' ? 'Удалить заказ безвозвратно?' : 'Отменить заказ и вернуть товары в продажу?').then(function (ok) {
        if (ok) run();
      });
    } else {
      run();
    }
  }

  // ---- admin: items ----

  function loadAdminItems() {
    var body = document.getElementById('admin-body');
    api('/api/admin/items').then(function (items) {
      body.innerHTML = (items.length
        ? items.map(adminItemRowHtml).join('')
        : '<div class="empty-state"><div class="emoji">🧥</div><div>Товаров пока нет</div></div>'
      ) + '<button class="fab" data-action="admin-item-new" aria-label="Добавить товар">+</button>';
    }).catch(function () {
      body.innerHTML = '<div class="empty-state"><div class="emoji">⚠️</div><div>Не удалось загрузить товары</div></div>';
    });
  }

  function adminItemRowHtml(item) {
    return (
      '<div class="list-row">' +
        '<div class="thumb">' + photoTag(firstPhoto(item.photos)) + '</div>' +
        '<div class="info">' +
          '<div class="name">' + escapeHtml(item.name) + '</div>' +
          '<div class="sub">' + money(item.price) + ' · ' + escapeHtml(item.status) + '</div>' +
        '</div>' +
        '<div class="row-actions">' +
          '<button data-action="admin-item-edit" data-id="' + item.id + '">✎</button>' +
          '<button data-action="admin-item-delete" data-id="' + item.id + '">🗑</button>' +
        '</div>' +
      '</div>'
    );
  }

  function deleteAdminItem(id) {
    confirmDialog('Удалить товар безвозвратно?').then(function (ok) {
      if (!ok) return;
      api('/api/admin/items/' + id, { method: 'DELETE' }).then(function () {
        haptic('success');
        loadAdminItems();
      }).catch(function () { alertDialog('Не получилось удалить товар.'); });
    });
  }

  var itemFormPhotos = [];

  function renderAdminItemForm(existing) {
    itemFormPhotos = existing && Array.isArray(existing.photos) ? existing.photos.slice() : [];
    var isEdit = !!existing;

    renderScreen(
      '<form id="item-form">' +
        '<div class="form-group"><label>Название</label><input class="form-input" name="name" required value="' + (existing ? escapeHtml(existing.name) : '') + '"></div>' +
        '<div class="form-group"><label>Категория</label><select class="form-input" name="categoryId" required>' +
          state.categories.map(function (c) {
            var selected = existing && String(existing.category_id) === String(c.id);
            return '<option value="' + c.id + '"' + (selected ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>';
          }).join('') +
        '</select></div>' +
        '<div class="form-group"><label>Цена, ₽</label><input class="form-input" name="price" type="number" min="0" required value="' + (existing ? existing.price : '') + '"></div>' +
        '<div class="form-group"><label>Размер</label><input class="form-input" name="size" value="' + (existing ? escapeHtml(existing.size) : '') + '"></div>' +
        '<div class="form-group"><label>Состояние</label><textarea class="form-textarea" name="conditionText">' + (existing ? escapeHtml(existing.condition_text) : '') + '</textarea></div>' +
        '<div class="form-group"><label>Фото</label><div class="photo-thumbs" id="item-photos"></div></div>' +
        '<input type="file" id="item-photo-input" accept="image/*" hidden>' +
        '<div id="item-form-error" class="form-error"></div>' +
        '<button type="submit" class="btn">' + (isEdit ? 'Сохранить' : 'Добавить товар') + '</button>' +
      '</form>',
      { back: function () { setAdminSubtab('items'); renderAdminHome(); } }
    );

    renderItemFormPhotos();

    document.getElementById('item-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var form = ev.target;
      var errorEl = document.getElementById('item-form-error');
      var payload = {
        name: form.name.value.trim(),
        categoryId: Number(form.categoryId.value),
        price: Number(form.price.value),
        size: form.size.value.trim(),
        conditionText: form.conditionText.value.trim(),
        photos: itemFormPhotos,
      };
      if (!payload.name || !payload.categoryId || !(payload.price >= 0)) {
        errorEl.textContent = 'Заполните название, категорию и цену.';
        return;
      }
      var request = isEdit
        ? api('/api/admin/items/' + existing.id, { method: 'PUT', body: payload })
        : api('/api/admin/items', { method: 'POST', body: payload });
      request.then(function () {
        haptic('success');
        setAdminSubtab('items');
        renderAdminHome();
      }).catch(function () {
        errorEl.textContent = 'Не получилось сохранить товар.';
      });
    });
  }

  function renderItemFormPhotos() {
    var el = document.getElementById('item-photos');
    if (!el) return;
    el.innerHTML = itemFormPhotos.map(function (url, i) {
      return '<div class="photo-thumb"><img src="' + escapeHtml(url) + '" alt=""><button type="button" class="rm" data-action="admin-item-photo-remove" data-index="' + i + '">✕</button></div>';
    }).join('') + '<button type="button" class="photo-add" data-action="admin-item-photo-add">+</button>';
  }

  function uploadItemPhoto() {
    var input = document.getElementById('item-photo-input');
    input.onchange = function () {
      var file = input.files[0];
      if (!file) return;
      var fd = new FormData();
      fd.append('photo', file);
      api('/api/admin/upload-photo', { method: 'POST', body: fd }).then(function (res) {
        itemFormPhotos.push(res.url);
        renderItemFormPhotos();
      }).catch(function () { alertDialog('Не получилось загрузить фото.'); });
    };
    input.click();
  }

  // ---- admin: categories ----

  function loadAdminCategories() {
    var body = document.getElementById('admin-body');
    api('/api/categories').then(function (categories) {
      body.innerHTML =
        '<div class="form-group" style="display:flex;gap:8px;">' +
          '<input class="form-input" id="new-cat-name" placeholder="Новая категория" style="flex:1;">' +
          '<button class="btn small" style="width:auto;padding:0 16px;" data-action="admin-cat-new">Добавить</button>' +
        '</div>' +
        (categories.length
          ? categories.map(function (c) {
              return '<div class="list-row">' +
                '<div class="info"><div class="name">' + escapeHtml(c.name) + '</div><div class="sub">Порядок: ' + c.sort_order + '</div></div>' +
                '<div class="row-actions">' +
                  '<button data-action="admin-cat-edit" data-id="' + c.id + '" data-name="' + escapeHtml(c.name) + '">✎</button>' +
                  '<button data-action="admin-cat-delete" data-id="' + c.id + '">🗑</button>' +
                '</div>' +
              '</div>';
            }).join('')
          : '<div class="empty-state"><div class="emoji">🗂</div><div>Категорий пока нет</div></div>');
    }).catch(function () {
      body.innerHTML = '<div class="empty-state"><div class="emoji">⚠️</div><div>Не удалось загрузить категории</div></div>';
    });
  }

  function createCategory() {
    var input = document.getElementById('new-cat-name');
    var name = input.value.trim();
    if (!name) return;
    api('/api/admin/categories', { method: 'POST', body: { name: name, sortOrder: state.categories.length } }).then(function () {
      haptic('success');
      return reloadCategories();
    }).then(function () {
      loadAdminCategories();
    }).catch(function () { alertDialog('Не получилось создать категорию.'); });
  }

  function editCategory(id, currentName) {
    var name = window.prompt('Новое название категории', currentName);
    if (name === null) return;
    name = name.trim();
    if (!name) return;
    api('/api/admin/categories/' + id, { method: 'PUT', body: { name: name, sortOrder: 0 } }).then(function () {
      haptic('success');
      return reloadCategories();
    }).then(function () {
      loadAdminCategories();
    }).catch(function () { alertDialog('Не получилось обновить категорию.'); });
  }

  function deleteCategory(id) {
    confirmDialog('Удалить категорию? Это не удалит товары в ней.').then(function (ok) {
      if (!ok) return;
      api('/api/admin/categories/' + id, { method: 'DELETE' }).then(function () {
        haptic('success');
        return reloadCategories();
      }).then(function () {
        loadAdminCategories();
      }).catch(function () { alertDialog('Не получилось удалить категорию.'); });
    });
  }

  function reloadCategories() {
    return api('/api/categories').then(function (categories) {
      state.categories = categories;
    });
  }

  // ---------------------------------------------------------------------
  // Event delegation
  // ---------------------------------------------------------------------

  document.addEventListener('click', function (ev) {
    var target = ev.target.closest('[data-action]');
    if (!target) return;
    var action = target.dataset.action;

    switch (action) {
      case 'back':
        if (goBackTarget) goBackTarget();
        break;
      case 'sheet-close':
        closeSheet();
        break;
      case 'sort-open':
        openSortSheet();
        break;
      case 'sort-set':
        state.filter.sort = target.dataset.value;
        closeSheet();
        loadCatalogGrid();
        break;
      case 'size-chip':
        state.filter.size = state.filter.size === target.dataset.value ? '' : target.dataset.value;
        loadCatalogGrid();
        break;
      case 'search-open':
        renderSearch();
        break;
      case 'search-close':
        closeSearch(document.getElementById('search-input') ? document.getElementById('search-input').value.trim() : '');
        break;
      case 'open-product':
        renderProduct(target.dataset.id);
        break;
      case 'share':
        shareItem(target.dataset.id);
        break;
      case 'add-to-cart':
        addToCart(target.dataset.id);
        break;
      case 'cart-remove':
        removeFromCart(target.dataset.item);
        break;
      case 'checkout-open':
        renderCheckout();
        break;
      case 'goto-catalog':
        goToTab('catalog');
        break;
      case 'upload-proof':
        triggerProofUpload(target.dataset.order);
        break;
      case 'admin-subtab':
        setAdminSubtab(target.dataset.tab);
        break;
      case 'admin-order-confirm':
        adminOrderAction('confirm', target.dataset.id);
        break;
      case 'admin-order-cancel':
        adminOrderAction('cancel', target.dataset.id);
        break;
      case 'admin-order-done':
        adminOrderAction('done', target.dataset.id);
        break;
      case 'admin-order-delete':
        adminOrderAction('delete', target.dataset.id);
        break;
      case 'admin-item-new':
        renderAdminItemForm(null);
        break;
      case 'admin-item-edit':
        api('/api/items/' + target.dataset.id).then(renderAdminItemForm);
        break;
      case 'admin-item-delete':
        deleteAdminItem(target.dataset.id);
        break;
      case 'admin-item-photo-add':
        uploadItemPhoto();
        break;
      case 'admin-item-photo-remove':
        itemFormPhotos.splice(Number(target.dataset.index), 1);
        renderItemFormPhotos();
        break;
      case 'admin-cat-new':
        createCategory();
        break;
      case 'admin-cat-edit':
        editCategory(target.dataset.id, target.dataset.name);
        break;
      case 'admin-cat-delete':
        deleteCategory(target.dataset.id);
        break;
      default:
        break;
    }
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  function boot() {
    api('/api/config').then(function (config) {
      state.isAdmin = !!config.isAdmin;
      adminTabEl.hidden = !state.isAdmin;
    }).catch(function () {
      state.isAdmin = false;
    }).then(function () {
      return reloadCategories();
    }).then(function () {
      return refreshCartBadge();
    }).then(function () {
      goToTab('catalog');
    });
  }

  boot();
})();
