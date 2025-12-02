// Cart/CartBase.js

/**
 * CartBase — «ядро» корзины без DOM:
 *  - состояние и индекс
 *  - нормализация id
 *  - работа с storage и productService
 *  - бизнес-логика add/remove/changeQty
 */
export class CartBase {
  static UI_MESSAGES = Object.freeze({});

  constructor({ storage, productService, notifications, favorites = null, opts = {} }) {
    this.storage = storage;
    this.productService = productService;
    this.notifications = notifications;
    this.favorites = favorites;
	this.noImage = '/templates/'+ storage.shopMatic.foxEngine.replaceData.template + '/img/no-image.png';

    this.opts = Object.assign(
      {
        saveDebounceMs: 200,
        debug: false,
        parallelProductFetch: true,
        productFetchBatchSize: 20,
        stockCacheTTL: 5000
      },
      opts || {}
    );

    this.cart = [];
    this._idIndex = new Map(); // id -> index
    this._pendingChangedIds = new Set();
    this._saveTimeout = null;

    // служебное
    this._rowsSyncing = new WeakSet();
    this._changeSourceMap = new Map();

    this._cssEscape =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape
        : (s) => String(s).replace(/["\\]/g, '\\$&');
  }

  // --- logging / i18n ------------------------------------------------------

  _logError(...args) {
    if (this.opts.debug) console.error('[CartModule]', ...args);
  }

  _msg(key, vars = {}) {
    const pool = (this.constructor && this.constructor.UI_MESSAGES) || {};
    const tpl = pool[key] ?? '';
    return String(tpl).replace(/\{([^}]+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
    );
  }

  // --- Id normalization & index management ---------------------------------

  _normalizeId(id) {
    if (id === undefined || id === null) return '';
    if (typeof id === 'object') {
      return String(
        id.id ??
          id.name ??
          id.productId ??
          id.cartId ??
          id.itemId ??
          ''
      ).trim();
    }
    return String(id).trim();
  }

  _normalizeIdKey(id) {
    return String(this._normalizeId(id));
  }

  _rebuildIndex() {
    this._idIndex.clear();
    for (let i = 0; i < this.cart.length; i++) {
      const key = this._normalizeIdKey(this.cart[i].name);
      if (key) this._idIndex.set(key, i);
    }
  }

  getCartItems() {
    return this.cart;
  }

  _updateIndexOnInsert(id, index) {
    try {
      const key = this._normalizeIdKey(id);
      if (!key) return;
      for (const [k, idx] of Array.from(this._idIndex.entries())) {
        if (idx >= index) this._idIndex.set(k, idx + 1);
      }
      this._idIndex.set(key, index);
    } catch (e) {
      this._rebuildIndex();
    }
  }

  _updateIndexOnRemove(index) {
    try {
      if (index === undefined || index === null) {
        this._rebuildIndex();
        return;
      }
      let removedKey = null;
      for (const [k, idx] of Array.from(this._idIndex.entries())) {
        if (idx === index) {
          removedKey = k;
          break;
        }
      }
      if (removedKey) this._idIndex.delete(removedKey);
      for (const [k, idx] of Array.from(this._idIndex.entries())) {
        if (idx > index) this._idIndex.set(k, idx - 1);
      }
    } catch (e) {
      this._rebuildIndex();
    }
  }

  _findCartIndexById(id) {
    const sid = this._normalizeIdKey(id);
    if (!sid) return -1;
    const idx = this._idIndex.get(sid);
    if (
      typeof idx === 'number' &&
      this.cart[idx] &&
      this._normalizeIdKey(this.cart[idx].name) === sid
    )
      return idx;
    // fallback
    for (let i = 0; i < this.cart.length; i++) {
      if (this._normalizeIdKey(this.cart[i].name) === sid) {
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
    const it = this._getCartItemById(id);
    return it ? Number(it.qty || 0) : 0;
  }

  _formatPrice(value) {
    try {
      return Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB'
      }).format(Number(value || 0));
    } catch (e) {
      return String(value || '0');
    }
  }

  _noteChangedId(id) {
    const k = this._normalizeIdKey(id);
    if (k) this._pendingChangedIds.add(k);
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
      const totalCount = this.cart.reduce(
        (s, it) => s + Number(it.qty || 0),
        0
      );
      const totalSum = this.cart.reduce(
        (s, it) =>
          s + Number(it.price || 0) * Number(it.qty || 0),
        0
      );
      const changedIds = Array.from(this._pendingChangedIds);
      this._pendingChangedIds.clear();
      const ev = new CustomEvent('cart:updated', {
        detail: {
          cart: this.cart.slice(),
          totalCount,
          totalSum,
          changedIds
        }
      });
      window.dispatchEvent(ev);
    } catch (e) {
      this._logError('emitUpdateEvent failed', e);
    }
  }

  // --- product resolution helpers -----------------------------------------

  _isThenable(v) {
    return v && typeof v.then === 'function';
  }

  /**
   * Try to get product via productService.findById.
   * Returns either the product (sync) or a Promise that resolves to product or null.
   */
  _resolveProduct(id) {
    try {
      const svc = this.productService;
      if (!svc || typeof svc.findById !== 'function') return null;
      const out = svc.findById(id);
      return out;
    } catch (e) {
      return null;
    }
  }

  _mergeProductToItem(item, prod, qtyAdjust = true) {
    if (!item || !prod) return item;
    item.price = Number(prod.price ?? item.price ?? 0);
    item.stock = Number(prod.stock ?? item.stock ?? 0);
    item.fullname =
      prod.fullname ??
      prod.title ??
      prod.name ??
      item.fullname;
    item.picture =
      prod.picture ?? prod.image ?? item.picture;
    item.specs = prod.specs ?? item.specs ?? {};
    if (
      qtyAdjust &&
      Number.isFinite(item.stock) &&
      item.stock >= 0 &&
      item.qty > item.stock
    ) {
      item.qty = Math.max(1, item.stock);
      this._noteChangedId(item.name);
    }
    return item;
  }

  _normalizeCartItemFromProduct(prod, qty = 1) {
    return {
      name: this._normalizeId(
        prod.name ??
          prod.id ??
          prod.title ??
          prod.fullname ??
          prod.productId ??
          ''
      ),
      fullname:
        prod.fullname ??
        prod.title ??
        prod.name ??
        prod.productName ??
        '',
      price: Number(prod.price || 0),
      qty: Number(qty || 1),
      picture: prod.picture || prod.image || '',
      stock: Number(prod.stock || 0),
      specs: prod.specs || {}
    };
  }

  // --- storage load --------------------------------------------------------

  async loadFromStorage() {
    let raw = [];
    try {
      raw = await (this.storage?.loadCartWithAvailability?.() ?? []);
    } catch (e) {
      this._logError('loadFromStorage: storage.loadCart failed', e);
      raw = [];
    }

    this.cart = (Array.isArray(raw) ? raw : [])
      .map((entry) => {
        if (!entry) return null;
        const name = this._normalizeId(
          entry.name ??
            entry.id ??
            entry.title ??
            entry.fullname ??
            entry.productId ??
            entry.cartId ??
            ''
        );
        let qty = Number(entry.qty ?? entry.quantity ?? 1);
        if (!Number.isFinite(qty) || qty < 1) qty = 1;

        let syncProd = null;
        try {
          syncProd =
            this.productService &&
            typeof this.productService.findById === 'function'
              ? this.productService.findById(name)
              : null;
        } catch (e) {
          syncProd = null;
        }
        if (this._isThenable(syncProd)) syncProd = null;

        if (syncProd) {
          const stock = Number(syncProd.stock || 0);
          if (stock > 0) qty = Math.min(qty, stock);
          return this._normalizeCartItemFromProduct(syncProd, qty);
        }

        return {
          name,
          fullname:
            entry.fullname ||
            entry.title ||
            entry.name ||
            entry.productName ||
            'Товар',
          price: Number(entry.price ?? 0),
          qty,
          picture:
            entry.picture ||
            entry.image ||
           this.noImage,
          stock: Number(entry.stock ?? 0),
          specs: entry.specs || {}
        };
      })
      .filter(Boolean);

    this._dedupeCart();
    this._rebuildIndex();
    for (const i of this.cart) this._noteChangedId(i.name);
    // сам UI-рендер делается в CartUI.updateCartUI
  }

  // --- public mutations: add / remove / changeQty --------------------------

  add(productId, qty = 1) {
    try {
      const id = this._normalizeId(productId);
      if (!id) {
        this._logError('add: empty productId', productId);
        return false;
      }

      const prod = this._resolveProduct(id);
      if (this._isThenable(prod)) {
        // optimistic add placeholder — будет синхронизирован в updateCartUI
        return this._addRawEntry(id, qty, null);
      }
      return this._addRawEntry(id, qty, prod ?? null);
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
        this.notifications?.show?.(this._msg('NOT_ENOUGH_STOCK'), {
          type: 'warning'
        });
        return false;
      }
      if (qty > stock) {
        this.notifications?.show?.(
          this._msg('ONLY_X_LEFT', { stock }),
          { type: 'warning' }
        );
        qty = stock;
      }
    }

    const idx = this._findCartIndexById(key);
    if (idx >= 0) {
      const existing = this.cart[idx];
      const proposed = existing.qty + qty;
      const maxAllowed = prod
        ? Number(prod.stock || existing.stock || 0)
        : Number(existing.stock || 0);
      if (maxAllowed > 0 && proposed > maxAllowed) {
        this.notifications?.show?.(
          this._msg('INSUFFICIENT_STOCK_ADD', {
            max: maxAllowed
          }),
          { type: 'warning' }
        );
        return false;
      }
      existing.qty = proposed;
      this._noteChangedId(key);
    } else {
      if (prod) {
        const item = this._normalizeCartItemFromProduct(prod, qty);
        this.cart.push(item);
        this._updateIndexOnInsert(item.name, this.cart.length - 1);
        this._noteChangedId(item.name);
      } else {
        const item = {
          name: key,
          fullname: key,
          price: 0,
          qty,
          picture: this.noImage,
          stock: 0,
          specs: {}
        };
        this.cart.push(item);
        this._updateIndexOnInsert(item.name, this.cart.length - 1);
        this._noteChangedId(item.name);
      }
    }

    return true; // UI обновит CartUI.updateCartUI
  }

  remove(productId) {
    const key = this._normalizeId(productId);
    const idx = this._findCartIndexById(key);
    if (idx >= 0) {
      this._noteChangedId(key);
      this.cart.splice(idx, 1);
      this._updateIndexOnRemove(idx);
      return true;
    }
    return false;
  }

  changeQty(productId, newQty, opts = {}) {
    try {
      const key = this._normalizeId(productId);
      const idx = this._findCartIndexById(key);
      if (idx < 0) return false;
      let qty = parseInt(newQty || 1, 10);
      if (isNaN(qty) || qty < 1) qty = 1;

      const item = this.cart[idx];
      const prod = this._resolveProduct(key);

      if (this._isThenable(prod)) {
        item.qty = qty; // optimistic
      } else if (prod) {
        const stock = Number(prod.stock || item.stock || 0);
        if (stock > 0 && qty > stock) {
          this.notifications?.show?.(
            this._msg('INSUFFICIENT_STOCK_CHANGEQTY', {
              stock
            }),
            { type: 'warning' }
          );
          qty = stock;
        }
        item.qty = qty;
      } else {
        item.qty = qty;
      }

      try {
        if (opts && opts.sourceRow instanceof Element) {
          this._changeSourceMap.set(
            this._normalizeIdKey(key),
            opts.sourceRow
          );
        }
      } catch (_) {}

      this._noteChangedId(key);
      return true;
    } catch (e) {
      this._logError('changeQty failed', e);
      return false;
    }
  }

  getCart() {
    return this.cart.map((i) => Object.assign({}, i));
  }

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
        existing.qty =
          Number(existing.qty || 0) + Number(item.qty || 0);
        if (item.price || item.price === 0)
          existing.price = Number(item.price);
        if (item.picture) existing.picture = item.picture;
        if (item.fullname) existing.fullname = item.fullname;
        if (Number.isFinite(Number(item.stock)))
          existing.stock = Number(item.stock);
        existing.specs = Object.assign(
          {},
          existing.specs || {},
          item.specs || {}
        );
      }
    }
    const merged = Array.from(map.values()).map((it) => {
      if (
        Number.isFinite(it.stock) &&
        it.stock >= 0 &&
        Number(it.qty) > it.stock
      ) {
        it.qty = Math.max(1, it.stock);
      } else {
        it.qty = Math.max(1, Number(it.qty || 1));
      }
      return it;
    });
    this.cart = merged;
    this._rebuildIndex();
  }

  /**
   * Проверяет доступность товара по его item.
   */
  isAvailable(item) {
    const stock = Number(item.stock);
    const qtyInCart = this._getCartQtyById(item.name);
    return stock > 0 && qtyInCart < stock;
  }

  // --- utilities for tests / reset / destroy -------------------------------

  clear() {
    for (const i of this.cart) this._noteChangedId(i.name);
    this.cart = [];
    this._rebuildIndex();
  }

  _setCartForTest(cartArray) {
    this.cart = Array.isArray(cartArray)
      ? cartArray.map((i) => Object.assign({}, i))
      : [];
    this._rebuildIndex();
    this.cart.forEach((i) => this._noteChangedId(i.name));
  }

  _destroyBase() {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = null;
      try {
        if (this.storage?.saveCart) this.storage.saveCart(this.cart);
      } catch (e) {
        this._logError('final save failed on destroy', e);
      }
    }
  }
}
