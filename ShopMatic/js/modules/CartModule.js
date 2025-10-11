import { MiniCart } from './MiniCart.js';

export class CartModule {
  constructor({ storage, productService, renderer, notifications, favorites = null, opts = {} }) {
    this.storage = storage;
    this.productService = productService;
    this.renderer = renderer;
    this.notifications = notifications;
    this.favorites = favorites;

    this.opts = Object.assign({
      saveDebounceMs: 200,
      debug: false,
      parallelProductFetch: true,
      productFetchBatchSize: 20
    }, opts);

    this.cart = [];
    this._idIndex = new Map();

    // DOM refs
    this.headerCartNum = null;
    this.cartGrid = null;
    this.cartCountInline = null;
    this.cartTotal = null;

    this.miniCart = new MiniCart({ renderer: this.renderer, notifications: this.notifications, opts: opts.miniCart || {} });

    // internals
    this._saveTimeout = null;
    this._gridHandler = null;
    this._gridInputHandler = null;
    this._gridListenersAttachedTo = null;
    this._pendingChangedIds = new Set();

    this._cssEscape = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') ? CSS.escape : (s => String(s).replace(/["\\]/g, '\\$&'));
  }

  /* ========================= Logging helper ========================= */
  _logError(...args) {
    if (this.opts.debug) console.error('[CartModule]', ...args);
  }

  /* ================= Helpers / Normalization ================= */
  _normalizeId(id) {
    if (id === undefined || id === null) return '';
    if (typeof id === 'object') {
      return String(id.id ?? id.name ?? id.productId ?? id.cartId ?? id.itemId ?? '').trim();
    }
    return String(id).trim();
  }

  // canonical key used in index and comparisons (lowercase trimmed)
  _normalizeIdKey(id) {
    const n = this._normalizeId(id);
    return n ? String(n).toLowerCase() : '';
  }

  _rebuildIndex() {
    this._idIndex.clear();
    for (let i = 0; i < this.cart.length; i++) {
      const key = this._normalizeIdKey(this.cart[i].name);
      if (key) this._idIndex.set(String(key), i);
    }
  }

  _updateIndexOnInsert(id, index) {
    // safe: rebuild for correctness
    this._rebuildIndex();
  }

  _updateIndexOnRemove(id) {
    this._rebuildIndex();
  }

  _findCartIndexById(id) {
    const sid = this._normalizeIdKey(id);
    if (!sid) return -1;
    const maybe = this._idIndex.get(String(sid));
    if (typeof maybe === 'number' && this.cart[maybe] && this._normalizeIdKey(this.cart[maybe].name) === String(sid)) {
      return maybe;
    }
    // fallback linear scan
    for (let i = 0; i < this.cart.length; i++) {
      if (this._normalizeIdKey(this.cart[i].name) === String(sid)) {
        this._rebuildIndex();
        return i;
      }
    }
    return -1;
  }

  _getCartItemById(id) {
    const idx = this._findCartIndexById(id);
    return idx >= 0 ? this.cart[idx] : null;
  }

  _getCartQtyById(id) {
    const item = this._getCartItemById(id);
    return item ? Number(item.qty || 0) : 0;
  }

  _formatPrice(value) {
    try {
      return Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(Number(value || 0));
    } catch (e) {
      return String(value || '0');
    }
  }

  _noteChangedId(id) {
    const key = this._normalizeIdKey(id);
    if (key) this._pendingChangedIds.add(String(key));
  }

  _clearPendingChanged() {
    this._pendingChangedIds.clear();
  }

  _scheduleSave() {
    if (!this.storage || typeof this.storage.saveCart !== 'function') return;
    if (this._saveTimeout) clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => {
      try {
        this.storage.saveCart(this.cart);
      } catch (e) {
        this._logError('saveCart failed', e);
      }
      this._saveTimeout = null;
    }, Math.max(0, Number(this.opts.saveDebounceMs || 200)));
  }

  _emitUpdateEvent() {
    try {
      const totalCount = this.cart.reduce((s, it) => s + Number(it.qty || 0), 0);
      const totalSum = this.cart.reduce((s, it) => s + (Number(it.price || 0) * Number(it.qty || 0)), 0);

      const changedIds = Array.from(this._pendingChangedIds);
      this._pendingChangedIds.clear();

      const ev = new CustomEvent('cart:updated', { detail: { cart: this.cart.slice(), totalCount, totalSum, changedIds } });
      window.dispatchEvent(ev);
    } catch (e) {
      this._logError('emitUpdateEvent failed', e);
    }
  }

  /* ================= Storage ================= */

  loadFromStorage() {
    let raw = [];
    try {
      raw = this.storage && typeof this.storage.loadCart === 'function' ? (this.storage.loadCart() || []) : [];
    } catch (e) {
      this._logError('loadFromStorage: storage.loadCart failed', e);
      raw = [];
    }

    this.cart = (Array.isArray(raw) ? raw : []).map(entry => {
      if (!entry) return null;
      const name = this._normalizeId(entry.name ?? entry.id ?? entry.title ?? entry.fullname ?? entry.productId ?? entry.cartId ?? '');
      let qty = Number(entry.qty ?? entry.quantity ?? 1);
      if (!Number.isFinite(qty) || qty < 1) qty = 1;

      let prod = null;
      try {
        prod = this.productService && typeof this.productService.findById === 'function' ? this.productService.findById(name) : null;
      } catch (e) { prod = null; }
      if (prod && typeof prod.then === 'function') prod = null;

      if (prod) {
        const stock = Number(prod.stock || 0);
        if (stock > 0) qty = Math.min(qty, stock);
        return this._normalizeCartItemFromProduct(prod, qty);
      }

      return {
        name,
        fullname: entry.fullname || entry.title || entry.name || entry.productName || 'Товар',
        price: Number(entry.price ?? 0),
        qty,
        picture: entry.picture || entry.image || '/assets/no-image.png',
        stock: Number(entry.stock ?? 0),
        specs: entry.specs || {}
      };
    }).filter(Boolean);

    // dedupe model (important to avoid duplicates)
    this._dedupeCart();

    this._rebuildIndex();
    for (const i of this.cart) this._noteChangedId(i.name);
    return this.updateCartUI();
  }

  _normalizeCartItemFromProduct(prod, qty = 1) {
    return {
      name: this._normalizeId(prod.name ?? prod.id ?? prod.title ?? prod.fullname ?? prod.productId ?? ''),
      fullname: prod.fullname ?? prod.title ?? prod.name ?? prod.productName ?? '',
      price: Number(prod.price || 0),
      qty: Number(qty || 1),
      picture: prod.picture || prod.image || '',
      stock: Number(prod.stock || 0),
      specs: prod.specs || {}
    };
  }

  /* ================= DOM refs ================= */

  setDomRefs({ headerCartNum, miniCartList, miniCartHeaderTitle, cartGrid, cartCountInline, cartTotal } = {}) {
    this.headerCartNum = headerCartNum || this.headerCartNum;
    this.cartGrid = cartGrid || this.cartGrid;
    this.cartCountInline = cartCountInline || this.cartCountInline;
    this.cartTotal = cartTotal || this.cartTotal;

    if (miniCartList || miniCartHeaderTitle) {
      this.miniCart.setDomRefs({ listEl: miniCartList, headerTitleEl: miniCartHeaderTitle });
    }

    if (cartGrid) {
      this._attachGridListeners();
    }
  }

  /* ================= CRUD ================= */

  add(productId, qty = 1) {
    try {
      const id = this._normalizeId(productId);
      if (!id) {
        this._logError('add: empty productId', productId);
        return false;
      }

      const p = this.productService && typeof this.productService.findById === 'function' ? this.productService.findById(id) : null;
      if (p && typeof p.then === 'function') {
        return this._addRawEntry(id, qty, null);
      }

      return this._addRawEntry(id, qty, p);
    } catch (e) {
      this._logError('add failed', e);
      return false;
    }
  }

  _addRawEntry(id, qty, prod) {
    qty = Math.max(1, parseInt(qty || 1, 10));
    const key = this._normalizeId(id);
    if (!key) return false;

    if (prod) {
      const stock = Number(prod.stock || 0);
      if (stock <= 0) {
        this.notifications && typeof this.notifications.show === 'function' && this.notifications.show('Недостаточно товара на складе.', { type: 'warning' });
        return false;
      }
      if (qty > stock) {
        this.notifications && typeof this.notifications.show === 'function' && this.notifications.show(`В наличии только ${stock} шт.`, { type: 'warning' });
        qty = stock;
      }
    }

    const idx = this._findCartIndexById(key);
    if (idx >= 0) {
      const existing = this.cart[idx];
      const proposed = existing.qty + qty;
      const maxAllowed = prod ? Number(prod.stock || existing.stock || 0) : Number(existing.stock || 0);
      if (maxAllowed > 0 && proposed > maxAllowed) {
        this.notifications && typeof this.notifications.show === 'function' && this.notifications.show(`Недостаточно на складе. Доступно: ${maxAllowed}.`, { type: 'warning' });
        return false;
      }
      existing.qty = proposed;
      this._noteChangedId(key);
      this._rebuildIndex();
    } else {
      if (prod) {
        const item = this._normalizeCartItemFromProduct(prod, qty);
        this.cart.push(item);
        this._noteChangedId(item.name);
        this._updateIndexOnInsert(item.name, this.cart.length - 1);
      } else {
        const item = {
          name: key,
          fullname: key,
          price: 0,
          qty,
          picture: '/assets/no-image.png',
          stock: 0,
          specs: {}
        };
        this.cart.push(item);
        this._noteChangedId(item.name);
        this._updateIndexOnInsert(item.name, this.cart.length - 1);
      }
    }

    const p = this.updateCartUI();

    if (this.notifications && typeof this.notifications.show === 'function') {
      try {
        const title = (prod && (prod.fullname || prod.title)) ? (prod.fullname || prod.title) : key;
        try {
          this.notifications.show(`<span>Товар (${title}) x${qty} добавлен в корзину <a href="#page/cart">Перейти в корзину</a></span>`, { type: 'success', allowHtml: true });
        } catch (inner) {
          this.notifications.show(`Товар "${title}" x${qty} добавлен в корзину.`, { type: 'success' });
        }
      } catch (e) {
        this._logError('notifications.show failed on add', e);
      }
    }
    return p;
  }

  remove(productId) {
    const key = this._normalizeId(productId);
    const idx = this._findCartIndexById(key);
    if (idx >= 0) {
      this._noteChangedId(key);
      this.cart.splice(idx, 1);
      this._updateIndexOnRemove(key);
      return this.updateCartUI();
    }
    return false;
  }

  changeQty(productId, newQty) {
    try {
      const key = this._normalizeId(productId);
      const idx = this._findCartIndexById(key);
      if (idx < 0) return false;
      let qty = parseInt(newQty || 1, 10);
      if (isNaN(qty) || qty < 1) qty = 1;

      const item = this.cart[idx];
      const prod = this.productService && typeof this.productService.findById === 'function' ? this.productService.findById(key) : null;

      if (prod && typeof prod.then === 'function') {
        item.qty = qty;
      } else if (prod) {
        const stock = Number(prod.stock || item.stock || 0);
        if (stock > 0 && qty > stock) {
          this.notifications && typeof this.notifications.show === 'function' && this.notifications.show(`Недостаточно на складе. Доступно: ${stock}.`, { type: 'warning'});
          qty = stock;
        }
        item.qty = qty;
      } else {
        item.qty = qty;
      }

      this._noteChangedId(key);
      return this.updateCartUI();
    } catch (e) {
      this._logError('changeQty failed', e);
      return false;
    }
  }

  getCart() { return this.cart.map(i => Object.assign({}, i)); }

  /* ================= Model dedupe ================= */

  // объединяет дубли в модели (складывает qty и предпочитает последние данные)
  _dedupeCart() {
    if (!Array.isArray(this.cart) || this.cart.length < 2) return;
    const map = new Map();
    for (const item of this.cart) {
      const key = this._normalizeIdKey(item && item.name);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, Object.assign({}, item));
      } else {
        const existing = map.get(key);
        existing.qty = Number(existing.qty || 0) + Number(item.qty || 0);
        if (item.price || item.price === 0) existing.price = Number(item.price);
        if (item.picture) existing.picture = item.picture;
        if (item.fullname) existing.fullname = item.fullname;
        if (Number.isFinite(Number(item.stock))) existing.stock = Number(item.stock);
        existing.specs = Object.assign({}, existing.specs || {}, item.specs || {});
      }
    }
    const merged = Array.from(map.values()).map(it => {
      if (Number.isFinite(it.stock) && it.stock >= 0 && Number(it.qty) > it.stock) {
        it.qty = Math.max(1, it.stock);
      } else {
        it.qty = Math.max(1, Number(it.qty || 1));
      }
      return it;
    });
    this.cart = merged;
    this._rebuildIndex();
  }

  /* ================= UI Update ================= */

  async updateCartUI() {
    const changedIdsSnapshot = Array.from(this._pendingChangedIds);

    // защита: дедуплируем модель перед рендером
    this._dedupeCart();

    // 1) refresh product info
    try {
      if (this.productService && typeof this.productService.findById === 'function') {
        const fetchPromises = this.cart.map(item => {
          const id = this._normalizeId(item.name);
          try {
            const prod = this.productService.findById(id);
            if (prod && typeof prod.then === 'function') {
              return prod.then(resolved => ({ id, resolved })).catch(err => ({ id, resolved: null, error: err }));
            } else {
              return Promise.resolve({ id, resolved: prod || null });
            }
          } catch (e) {
            return Promise.resolve({ id, resolved: null, error: e });
          }
        });

        if (this.opts.parallelProductFetch) {
          const settled = await Promise.allSettled(fetchPromises);
          for (const r of settled) {
            if (r.status === 'fulfilled' && r.value) {
              const id = r.value.id;
              const resolved = r.value.resolved;
              if (!resolved) continue;
              const idx = this._findCartIndexById(id);
              if (idx >= 0) {
                const item = this.cart[idx];
                item.price = Number(resolved.price || item.price || 0);
                item.stock = Number(resolved.stock || item.stock || 0);
                item.fullname = resolved.fullname || resolved.title || item.fullname;
                item.picture = resolved.picture || item.picture;
                item.specs = resolved.specs || item.specs;
                if (Number.isFinite(item.stock) && item.stock >= 0 && item.qty > item.stock) {
                  item.qty = Math.max(1, item.stock);
                  this._noteChangedId(id);
                }
              }
            } else if (r.status === 'rejected') {
              this._logError('product fetch failed', r.reason);
            }
          }
        } else {
          for (let i = 0; i < this.cart.length; i++) {
            const item = this.cart[i];
            const id = this._normalizeId(item.name);
            try {
              const prod = this.productService.findById(id);
              if (prod && typeof prod.then === 'function') {
                const resolved = await prod.catch(() => null);
                if (resolved) {
                  item.price = Number(resolved.price || item.price || 0);
                  item.stock = Number(resolved.stock || item.stock || 0);
                  item.fullname = resolved.fullname || resolved.title || item.fullname;
                  item.picture = resolved.picture || item.picture;
                  item.specs = resolved.specs || item.specs;
                }
              } else if (prod) {
                item.price = Number(prod.price || item.price || 0);
                item.stock = Number(prod.stock || item.stock || 0);
                item.fullname = prod.fullname || prod.title || item.fullname;
                item.picture = prod.picture || item.picture;
                item.specs = prod.specs || item.specs;
              }
            } catch (e) { /* ignore per-item */ }
            if (Number.isFinite(item.stock) && item.stock >= 0 && item.qty > item.stock) {
              item.qty = Math.max(1, item.stock);
              this._noteChangedId(id);
            }
          }
        }
      }
    } catch (e) {
      this._logError('updateCartUI (product fetch) failed', e);
    }

    // 2) recompute totals
    let totalCount = 0;
    let totalSum = 0;
    for (const it of this.cart) {
      totalCount += Number(it.qty || 0);
      totalSum += (Number(it.price || 0) * Number(it.qty || 0));
    }

    // 3) quick inline updates
    try {
      if (this.headerCartNum) {
        this.headerCartNum.textContent = String(totalCount);
        this.headerCartNum.style.display = totalCount > 0 ? 'inline-flex' : 'none';
        this.headerCartNum.setAttribute('aria-hidden', totalCount > 0 ? 'false' : 'true');
      }
    } catch (e) { this._logError('headerCartNum update failed', e); }

    // mini-cart header
    try {
      if (this.miniCart && typeof this.miniCart.updateHeader === 'function') this.miniCart.updateHeader(totalCount);
    } catch (e) { this._logError('miniCart.updateHeader failed', e); }

    // 4) render mini cart
    try {
      if (this.miniCart && typeof this.miniCart.render === 'function') {
        const maybe = this.miniCart.render(this.cart);
        if (maybe && typeof maybe.then === 'function') await maybe.catch(err => this._logError('miniCart.render failed', err));
      }
    } catch (e) { this._logError('miniCart.render threw', e); }

    // 5) cart grid update (optimized, with safe replacements)
    try {
      if (this.cartGrid && this.renderer && typeof this.renderer._renderCartGrid === 'function') {
        if (!changedIdsSnapshot.length) {
          await this.renderer._renderCartGrid(this.cartGrid, this.cart, this.renderer.foxEngine).catch(err => { throw err; });
          this._attachGridListeners();
        } else {
          const changedSet = new Set(changedIdsSnapshot.map(id => String(id)));
          const toProcess = [];

          for (const id of changedSet) {
            const item = this._getCartItemById(id);
            const esc = this._cssEscape(String(id));
            let existingRow = null;
            try {
              existingRow = this.cartGrid.querySelector(`[data-id="${esc}"]`);
            } catch (e) {
              existingRow = null;
              const rows = this.cartGrid.querySelectorAll && this.cartGrid.querySelectorAll('.cart-item');
              if (rows) {
                for (const r of rows) {
                  const rid = this._getIdFromRow(r);
                  if (rid === id) { existingRow = r; break; }
                }
              }
            }
            if (existingRow) existingRow = this._findRowFromElement(existingRow) || existingRow;
            toProcess.push({ id, item, existingRow });
          }

          const renderPromises = toProcess.map(async entry => {
            const tmp = document.createElement('div');
            try {
              await this.renderer._renderCartGrid(tmp, entry.item ? [entry.item] : [], this.renderer.foxEngine);
              const producedRow = tmp.querySelector('.cart-item') || tmp.firstElementChild;
              return { ok: true, id: entry.id, producedRow, existingRow: entry.existingRow, item: entry.item };
            } catch (err) {
              return { ok: false, id: entry.id, error: err };
            }
          });

          const settled = await Promise.allSettled(renderPromises);
          const applyChanges = [];
          let hadFailure = false;

          for (const r of settled) {
            if (r.status === 'fulfilled' && r.value && r.value.ok && r.value.producedRow && r.value.producedRow.cloneNode) {
              applyChanges.push(r.value);
            } else {
              hadFailure = true;
              this._logError('partial render item failed', r);
            }
          }

          await new Promise(resolve => requestAnimationFrame(resolve));
          for (const c of applyChanges) {
            try {
              const produced = c.producedRow.cloneNode(true);
              if (c.id && produced.setAttribute) produced.setAttribute('data-id', String(c.id));

              // safe apply: replace first matching and remove duplicates
              this._applyProducedRowSafely(c.id, produced, c.existingRow);

              const mainRow = this._findRowFromElement(produced) || produced;
              if (c.item) this._syncRowControls(mainRow, c.item);
              this._updateFavButtonState(mainRow, c.id);
            } catch (e) {
              hadFailure = true;
              this._logError('applyChange failed', e);
            }
          }

          if (hadFailure) {
            try {
              await this.renderer._renderCartGrid(this.cartGrid, this.cart, this.renderer.foxEngine);
            } catch (e) {
              this._logError('fallback full render failed', e);
            }
          }
          this._attachGridListeners();
        }
      }
    } catch (e) {
      this._logError('cart grid update failed, attempting full render', e);
      try {
        if (this.cartGrid && this.renderer && typeof this.renderer._renderCartGrid === 'function') {
          await this.renderer._renderCartGrid(this.cartGrid, this.cart, this.renderer.foxEngine);
          this._attachGridListeners();
        }
      } catch (er) {
        this._logError('full render fallback failed', er);
      }
    }

    // 6) totals & inline counters
    try {
      if (this.cartTotal) this.cartTotal.textContent = this._formatPrice(totalSum);
      if (this.cartCountInline) this.cartCountInline.textContent = String(totalCount);
    } catch (e) { this._logError('totals update failed', e); }

    // 7) final safety sync for updated rows
    try {
      if (this.cartGrid && changedIdsSnapshot.length) {
        for (const id of changedIdsSnapshot) {
          const esc = this._cssEscape(String(id));
          let row = null;
          try {
            row = this.cartGrid.querySelector(`[data-id="${esc}"]`);
          } catch (err) {
            row = null;
          }
          const mainRow = this._findRowFromElement(row) || row;
          const item = this._getCartItemById(id);
          if (mainRow && item) {
            this._syncRowControls(mainRow, item);
            this._updateFavButtonState(mainRow, id);
          } else if (mainRow) {
            this._updateFavButtonState(mainRow, id);
          }
        }
      }
    } catch (e) { this._logError('final sync failed', e); }

    this._scheduleSave();
    this._emitUpdateEvent();

    return { cart: this.getCart(), totalCount, totalSum };
  }

  /* ================= Row helpers & sync ================= */

  _findRowFromElement(el) {
    if (!el) return null;
    let node = el;
    while (node && node !== document.documentElement) {
      if (node.classList && node.classList.contains('cart-item')) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  _getIdFromRow(row) {
    if (!row) return '';
    try {
      let id = row.getAttribute && (row.getAttribute('data-id') || row.getAttribute('data-cart-item'));
      if (id) return this._normalizeIdKey(id);

      const qc = row.querySelector && row.querySelector('.qty-controls[data-id]');
      if (qc) return this._normalizeIdKey(qc.getAttribute('data-id'));

      const rb = row.querySelector && row.querySelector('.remove-btn[data-id]');
      if (rb) return this._normalizeIdKey(rb.getAttribute('data-id'));

      const a = row.querySelector && row.querySelector('a[href*="#product/"]');
      if (a && a.getAttribute('href')) {
        const href = a.getAttribute('href');
        const m = href.match(/#product\/([^\/\?#]+)/);
        if (m) return this._normalizeIdKey(m[1]);
      }

      const anyData = row.querySelector && row.querySelector('[data-id],[data-product-id],[data-cart-id]');
      if (anyData) {
        return this._normalizeIdKey(anyData.getAttribute('data-id') || anyData.getAttribute('data-product-id') || anyData.getAttribute('data-cart-id'));
      }
    } catch (e) {
      this._logError('_getIdFromRow failed', e);
    }
    return '';
  }

  _showLimitMsg(row, text = 'У вас уже максимум в корзине') {
    if (!row) return;
    try {
      const controls = row.querySelector && row.querySelector('.qty-controls');
      if (!controls) return;

      let limitMsg = row.querySelector('.product-limit-msg');
      if (!limitMsg) {
        limitMsg = document.createElement('div');
        limitMsg.className = 'product-limit-msg';
        limitMsg.textContent = text;
        controls.insertAdjacentElement('afterend', limitMsg);
        requestAnimationFrame(() => { limitMsg.style.opacity = '1'; });
      } else {
        limitMsg.textContent = text;
        limitMsg.style.opacity = '1';
      }
    } catch (e) {
      this._logError('_showLimitMsg failed', e);
    }
  }

  _hideLimitMsg(row) {
    if (!row) return;
    try {
      const limitMsg = row.querySelector && row.querySelector('.product-limit-msg');
      if (!limitMsg) return;
      limitMsg.style.opacity = '0';
      setTimeout(() => {
        const el = row.querySelector && row.querySelector('.product-limit-msg');
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }, 320);
    } catch (e) {
      this._logError('_hideLimitMsg failed', e);
    }
  }

  _updateFavButtonState(row, id) {
    if (!row || !id || !this.favorites) return;
    try {
      const favBtn = row.querySelector && row.querySelector('.fav-btn');
      if (!favBtn) return;

      let isFav = false;
      try {
        if (typeof this.favorites.isFavorite === 'function') {
          isFav = !!this.favorites.isFavorite(id);
        } else if (Array.isArray(this.favorites.getAll && this.favorites.getAll())) {
          isFav = (this.favorites.getAll().indexOf(id) >= 0);
        }
      } catch (e) { isFav = false; }

      favBtn.classList.toggle('is-fav', isFav);
      favBtn.setAttribute('aria-pressed', String(isFav));
      const icon = favBtn.querySelector && favBtn.querySelector('i');
      if (icon) icon.classList.toggle('active', isFav);
    } catch (e) {
      this._logError('_updateFavButtonState failed', e);
    }
  }

  _syncRowControls(row, item) {
    if (!row) return;
    try {
      const qtyInput = row.querySelector && row.querySelector('.qty-input');
      const btnPlus = row.querySelector && (row.querySelector('.qty-btn.qty-incr') || row.querySelector('[data-action="qty-incr"]') || row.querySelector('[data-role="qty-plus"]'));
      const btnMinus = row.querySelector && (row.querySelector('.qty-btn.qty-decr') || row.querySelector('[data-action="qty-decr"]') || row.querySelector('[data-role="qty-minus"]'));
      const controls = row.querySelector && row.querySelector('.qty-controls');

      let stock = Number(item && (item.stock ?? item._stock) ? (item.stock ?? item._stock) : NaN);
      if (!Number.isFinite(stock)) {
        const ds = row.getAttribute && row.getAttribute('data-stock');
        stock = ds !== null ? Number(ds) : 0;
      }
      let qty = Number(item && item.qty ? item.qty : 0);
      if (!Number.isFinite(stock)) stock = 0;
      if (!Number.isFinite(qty)) qty = 0;

      let stockWarning = row.querySelector && row.querySelector('.stock-warning');
      if (!stockWarning) {
        stockWarning = document.createElement('div');
        stockWarning.className = 'stock-warning';
        stockWarning.style.cssText = 'color:#c62828;font-size:13px;margin-top:6px;display:none;';
        const right = row.querySelector('.cart-item__right') || row;
        right.appendChild(stockWarning);
      }

      if (qtyInput) {
        qtyInput.setAttribute('min', '1');
        qtyInput.setAttribute('max', String(stock));
        if (stock <= 0) {
          qtyInput.value = '0';
          qtyInput.disabled = true;
          qtyInput.setAttribute('aria-disabled', 'true');
        } else {
          if (qty > stock) qty = stock;
          qtyInput.value = String(Math.max(1, qty));
          qtyInput.disabled = false;
          qtyInput.removeAttribute('aria-disabled');
        }
      }

      if (btnMinus) {
        const disabled = (stock <= 0) || (qty <= 1);
        btnMinus.disabled = disabled;
        if (disabled) btnMinus.setAttribute('aria-disabled', 'true'); else btnMinus.removeAttribute('aria-disabled');
        btnMinus.classList.toggle('disabled', disabled);
      }

      if (btnPlus) {
        const disabled = (stock <= 0) || (qty >= stock);
        btnPlus.disabled = disabled;
        if (disabled) btnPlus.setAttribute('aria-disabled', 'true'); else btnPlus.removeAttribute('aria-disabled');
        btnPlus.classList.toggle('disabled', disabled);

        if (stock > 0 && qty >= stock) {
          this._showLimitMsg(row, 'Вы достигли максимального количества этого товара');
        } else {
          this._hideLimitMsg(row);
        }
      } else {
        this._hideLimitMsg(row);
      }

      if (stock <= 0) {
        stockWarning.textContent = 'Товара нет в наличии';
        stockWarning.style.display = '';
        stockWarning.setAttribute('aria-hidden', 'false');
        row.classList.add('out-of-stock');
        if (btnPlus) { btnPlus.disabled = true; btnPlus.setAttribute('aria-disabled', 'true'); btnPlus.classList.add('disabled'); }
        if (btnMinus) { btnMinus.disabled = true; btnMinus.setAttribute('aria-disabled', 'true'); btnMinus.classList.add('disabled'); }
        if (qtyInput) { qtyInput.value = '0'; qtyInput.disabled = true; qtyInput.setAttribute('aria-disabled', 'true'); }
        this._hideLimitMsg(row);
      } else {
        stockWarning.style.display = 'none';
        stockWarning.setAttribute('aria-hidden', 'true');
        row.classList.remove('out-of-stock');
      }

      // optionally refresh single product stock
      try {
        const id = this._getIdFromRow(row);
        if (id && this.productService && typeof this.productService.findById === 'function') {
          const prod = this.productService.findById(id);
          if (prod && typeof prod.then === 'function') {
            prod.then(resolved => {
              if (!resolved) return;
              const existing = this._getCartItemById(id);
              if (existing) {
                existing.stock = Number(resolved.stock ?? existing.stock ?? 0);
                try {
                  const mainRow = this._findRowFromElement(row) || row;
                  this._syncRowControls(mainRow, existing || { name: id, qty: qty, stock: Number(resolved.stock ?? stock) });
                } catch (_) { /* ignore */ }
              }
            }).catch(err => this._logError('single product refresh failed', err));
          } else if (prod) {
            const existing = this._getCartItemById(id);
            if (existing) existing.stock = Number(prod.stock ?? existing.stock ?? 0);
            try {
              const mainRow = this._findRowFromElement(row) || row;
              this._syncRowControls(mainRow, existing || { name: id, qty: qty, stock: Number(prod.stock ?? stock) });
            } catch (_) { /* ignore */ }
          }
        }
      } catch (e) {
        this._logError('_syncRowControls product refresh failed', e);
      }
    } catch (e) {
      this._logError('_syncRowControls failed', e);
    }
  }

  /* ================= Delegated grid listeners ================= */

  _attachGridListeners() {
    if (!this.cartGrid) return;

    if (this._gridListenersAttachedTo && this._gridListenersAttachedTo !== this.cartGrid) {
      this._detachGridListeners();
    }
    if (this._gridHandler) return;

    this._gridHandler = (ev) => {
      const target = ev.target;
      const row = this._findRowFromElement(target);
      if (!row) return;
      const id = this._getIdFromRow(row);
      if (!id) return;

      // fav toggle
      const fav = target.closest && target.closest('.fav-btn, [data-role="fav"]');
      if (fav) {
        ev.preventDefault();
        if (!this.favorites) {
          if (this.notifications && typeof this.notifications.show === 'function') {
            this.notifications.show('Модуль избранного недоступен.', { type: 'error' });
          }
          return;
        }
        try {
          let res;
          if (typeof this.favorites.toggle === 'function') {
            res = this.favorites.toggle(id);
          } else if (typeof this.favorites.add === 'function' && typeof this.favorites.remove === 'function') {
            const now = (typeof this.favorites.isFavorite === 'function') ? !!this.favorites.isFavorite(id) : false;
            res = now ? this.favorites.remove(id) : this.favorites.add(id);
          }
          const favBtnEl = row.querySelector && row.querySelector('.fav-btn');
          const isFavNow = (typeof this.favorites.isFavorite === 'function') ? !!this.favorites.isFavorite(id) : false;
          if (favBtnEl) {
            favBtnEl.classList.toggle('is-fav', isFavNow);
            favBtnEl.setAttribute('aria-pressed', String(isFavNow));
          }
          const wishEl = document.getElementById && document.getElementById('wishNum');
          try {
            if (wishEl && typeof this.favorites.getCount === 'function') {
              wishEl.textContent = String(this.favorites.getCount());
            }
          } catch (e) { /* ignore */ }

          if (res && typeof res.then === 'function') {
            res.then(() => {
              const finalFav = (typeof this.favorites.isFavorite === 'function') ? !!this.favorites.isFavorite(id) : false;
              if (favBtnEl) favBtnEl.classList.toggle('is-fav', finalFav);
              if (wishEl && typeof this.favorites.getCount === 'function') wishEl.textContent = String(this.favorites.getCount());
            }).catch(err => this._logError('favorites operation failed', err));
          }
        } catch (e) {
          this._logError('fav handling failed', e);
        }
        return;
      }

      // plus
      const plus = target.closest && target.closest('.qty-btn.qty-incr, [data-action="qty-incr"], [data-role="qty-plus"]');
      if (plus) {
        ev.preventDefault();
        const item = this._getCartItemById(id);
        if (!item) return;
        const stock = Number(item.stock || 0);
        if (stock <= 0) {
          this.notifications && typeof this.notifications.show === 'function' && this.notifications.show('Товар отсутствует на складе.', { type: 'warning' });
          this._syncRowControls(row, item);
          return;
        }
        if (item.qty < stock) this.changeQty(id, item.qty + 1);
        else this.notifications && typeof this.notifications.show === 'function' && this.notifications.show('Достигнут максимальный лимит по остатку.', { type: 'warning' });
        return;
      }

      // minus
      const minus = target.closest && target.closest('.qty-btn.qty-decr, [data-action="qty-decr"], [data-role="qty-minus"]');
      if (minus) {
        ev.preventDefault();
        const item = this._getCartItemById(id);
        if (!item) return;
        if (item.qty > 1) this.changeQty(id, item.qty - 1);
        return;
      }

      // remove
      const rem = target.closest && target.closest('.remove-btn, [data-action="remove"], [data-role="remove"]');
      if (rem) {
        ev.preventDefault();
        this.remove(id);
        return;
      }
    };

    this._gridInputHandler = (ev) => {
      const input = ev.target;
      if (!input) return;
      if (!(input.matches && (input.matches('.qty-input') || input.matches('[data-role="qty-input"]') || input.matches('input[type="number"]')))) return;
      const row = this._findRowFromElement(input);
      if (!row) return;
      const id = this._getIdFromRow(row);
      if (!id) return;
      let v = parseInt(input.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      const max = parseInt(input.getAttribute('max') || '0', 10);
      if (Number.isFinite(max) && max > 0 && v > max) v = max;
      this.changeQty(id, v);
    };

    try {
      this.cartGrid.addEventListener('click', this._gridHandler);
      this.cartGrid.addEventListener('change', this._gridInputHandler);
      this._gridListenersAttachedTo = this.cartGrid;
    } catch (e) {
      this._logError('_attachGridListeners failed', e);
    }
  }

  _detachGridListeners() {
    if (!this._gridListenersAttachedTo) return;
    try {
      this._gridListenersAttachedTo.removeEventListener('click', this._gridHandler);
      this._gridListenersAttachedTo.removeEventListener('change', this._gridInputHandler);
    } catch (e) { this._logError('_detachGridListeners error', e); }
    this._gridHandler = null;
    this._gridInputHandler = null;
    this._gridListenersAttachedTo = null;
  }

  /* ================= DOM dedupe helpers ================= */

  _findAllRowsByIdInGrid(id) {
    if (!this.cartGrid || !id) return [];
    const esc = this._cssEscape(String(id));
    let nodes = [];
    try {
      const q = this.cartGrid.querySelectorAll(`[data-id="${esc}"]`);
      if (q && q.length) {
        for (const n of q) {
          const row = this._findRowFromElement(n) || n;
          if (row) nodes.push(row);
        }
      } else {
        const rows = this.cartGrid.querySelectorAll && this.cartGrid.querySelectorAll('.cart-item');
        if (rows) {
          for (const r of rows) {
            try {
              if (this._getIdFromRow(r) === this._normalizeIdKey(id)) nodes.push(r);
            } catch (e) { /* ignore */ }
          }
        }
      }
    } catch (e) {
      const rows = this.cartGrid.querySelectorAll && this.cartGrid.querySelectorAll('.cart-item');
      if (rows) {
        for (const r of rows) {
          try {
            if (this._getIdFromRow(r) === this._normalizeIdKey(id)) nodes.push(r);
          } catch (e) {}
        }
      }
    }
    const uniq = [];
    for (const n of nodes) if (n && uniq.indexOf(n) < 0) uniq.push(n);
    return uniq;
  }

  _applyProducedRowSafely(id, produced, existingRow) {
    if (!this.cartGrid) return;
    const existingRows = this._findAllRowsByIdInGrid(id);
    try {
      if (existingRows.length > 0) {
        const first = existingRows[0];
        if (first && first.parentNode) {
          try { first.parentNode.replaceChild(produced, first); }
          catch (e) { this.cartGrid.appendChild(produced); }
        } else {
          this.cartGrid.appendChild(produced);
        }
        for (let i = 1; i < existingRows.length; i++) {
          const node = existingRows[i];
          try { if (node && node.parentNode) node.parentNode.removeChild(node); } catch (e) {}
        }
      } else if (existingRow && existingRow.parentNode) {
        try { existingRow.parentNode.replaceChild(produced, existingRow); }
        catch (e) { this.cartGrid.appendChild(produced); }
      } else {
        this.cartGrid.appendChild(produced);
      }
    } catch (e) {
      try { this.cartGrid.appendChild(produced); } catch (er) { /* ignore */ }
    }
  }

  /* ================= Utilities & lifecycle ================= */

  clear() {
    for (const i of this.cart) this._noteChangedId(i.name);
    this.cart = [];
    this._rebuildIndex();
    return this.updateCartUI();
  }

  _setCartForTest(cartArray) {
    this.cart = Array.isArray(cartArray) ? cartArray.map(i => Object.assign({}, i)) : [];
    this._rebuildIndex();
    this.cart.forEach(i => this._noteChangedId(i.name));
    return this.updateCartUI();
  }

  destroy() {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = null;
      try { if (this.storage && typeof this.storage.saveCart === 'function') this.storage.saveCart(this.cart); } catch (e) { this._logError('final save failed on destroy', e); }
    }
    this._detachGridListeners();
    try { if (this.miniCart && typeof this.miniCart.destroy === 'function') this.miniCart.destroy(); } catch (e) { this._logError('miniCart.destroy failed', e); }
  }
}
