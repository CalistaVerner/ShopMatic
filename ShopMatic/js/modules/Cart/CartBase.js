/**
 * @author Calista Verner
 *
 * CartBase — domain layer for cart state.
 * Responsibilities:
 *  - cart array mutations (add/remove/changeQty)
 *  - normalization + indexing + persistence scheduling
 *  - product resolving for stock clamp (optional)
 *
 * IMPORTANT:
 *  - qty <= 0 => remove from DATA only (no DOM deletes)
 */

export class CartBase {
  constructor({ storage, productService, notifications, favorites = null, opts = {} }) {
    this.storage = storage;
    this.shopMatic = storage?.shopMatic || null;

    this.productService = productService || null;
    this.notifications = notifications || null;
    this.favorites = favorites || null;
    this.opts = opts || {};

    this.cart = [];
    this._indexById = new Map();
    this._pendingChangedIds = new Set();
    this._saveTimer = null;

    this._changeSourceMap = new Map();
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  _msg(key, vars = null) {
    try {
      return this.shopMatic?.msg?.(key, vars) ?? key;
    } catch {
      return key;
    }
  }

  _logError(msg, err) {
    try {
      // eslint-disable-next-line no-console
      console.error(msg, err);
    } catch {}
  }

  _isThenable(v) {
    return v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
  }

  _normalizeId(id) {
    return String(id ?? '').trim();
  }

  _normalizeIdKey(id) {
    return String(id ?? '').trim();
  }

  _noteChangedId(id) {
    const key = this._normalizeIdKey(id);
    if (!key) return;
    this._pendingChangedIds.add(key);
  }

  _findCartIndexById(id) {
    const key = this._normalizeIdKey(id);
    if (!key) return -1;
    const idx = this._indexById.get(key);
    return Number.isInteger(idx) ? idx : -1;
  }

  _rebuildIndex() {
    this._indexById.clear();
    for (let i = 0; i < this.cart.length; i++) {
      const key = this._normalizeIdKey(this.cart[i]?.name ?? this.cart[i]?.id);
      if (key) this._indexById.set(key, i);
    }
  }

  _updateIndexOnRemove(removedIdx) {
    // cheap reindex for simplicity/stability
    this._rebuildIndex();
  }

  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try { this.storage?.saveCart?.(this.cart); } catch (e) { this._logError('saveCart failed', e); }
    }, 250);
  }

  _resolveProduct(id) {
    try {
      return this.productService?.findById?.(id) ?? this.productService?.getById?.(id) ?? null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Public mutations
  // ---------------------------------------------------------------------------

  add(productId, qty = 1) {
    const key = this._normalizeId(productId);
    if (!key) return false;

    const idx = this._findCartIndexById(key);
    if (idx >= 0) {
      const item = this.cart[idx];
      item.qty = Number(item.qty ?? 0) + Number(qty ?? 1);
      this._noteChangedId(key);
      return true;
    }

    this.cart.push({ name: key, qty: Math.max(1, Number(qty ?? 1)) });
    this._rebuildIndex();
    this._noteChangedId(key);
    return true;
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

  /**
   * changeQty:
   *  - qty <= 0 => remove from DATA only (requirement)
   *  - never blocks minus
   *  - optional stock clamp (only if stock>0 AND qty>0)
   */
  changeQty(productId, newQty, opts = {}) {
    try {
      const key = this._normalizeId(productId);
      const idx = this._findCartIndexById(key);
      if (idx < 0) return false;

      let qty = parseInt(newQty, 10);
      if (Number.isNaN(qty)) qty = 0;

      // qty <= 0 => remove from DATA
      if (qty <= 0) {
        this.remove(key);
        try {
          if (opts && opts.sourceRow instanceof Element) {
            this._changeSourceMap.set(this._normalizeIdKey(key), opts.sourceRow);
          }
        } catch {}
        return true;
      }

      const item = this.cart[idx];
      const prod = this._resolveProduct(key);

      if (this._isThenable(prod)) {
        item.qty = qty; // optimistic
      } else if (prod) {
        const stock = Number(prod.stock || item.stock || 0);
        if (stock > 0 && qty > stock) {
          this.notifications?.show?.(
            this._msg('INSUFFICIENT_STOCK_CHANGEQTY', { stock }),
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
          this._changeSourceMap.set(this._normalizeIdKey(key), opts.sourceRow);
        }
      } catch {}

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

  // ---------------------------------------------------------------------------
  // Internal helpers used by CartUI in your project
  // ---------------------------------------------------------------------------

  _getCartItemById(id) {
    const key = this._normalizeIdKey(id);
    const idx = this._findCartIndexById(key);
    return idx >= 0 ? this.cart[idx] : null;
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
        existing.qty = Number(existing.qty || 0) + Number(item.qty || 0);
        if (item.price || item.price === 0) existing.price = Number(item.price);
        if (item.picture) existing.picture = item.picture;
        if (item.fullname) existing.fullname = item.fullname;
        if (Number.isFinite(Number(item.stock))) existing.stock = Number(item.stock);
        existing.specs = Object.assign({}, existing.specs || {}, item.specs || {});
        existing.included = item.included !== undefined ? !!item.included : existing.included;
      }
    }

    // Keep qty >= 1 here (dedupe only applies to items that exist; removals already handled in changeQty)
    this.cart = Array.from(map.values()).map((it) => {
      if (!Number.isFinite(Number(it.qty)) || Number(it.qty) < 1) it.qty = 1;
      return it;
    });

    this._rebuildIndex();
  }
}
