/**
 * @author Calista Verner
 *
 * IncludedStates — isolated "included" state service.
 * Responsibilities:
 *  - Persist/retrieve included map from localStorage
 *  - Apply included state to provided items (optional)
 *  - Emit "included:changed" via eventBus (if present)
 *
 * IMPORTANT:
 *  - No cart mutations besides setting item.included when asked to apply
 *  - No UI orchestration (does NOT call updateCartUI)
 */
export class IncludedStates {
  /**
   * @param {object} ctx
   * @param {object} [opts]
   * @param {string} [opts.storageKey]
   * @param {any}    [opts.eventBus]
   * @param {boolean}[opts.defaultIncluded]
   * @param {boolean}[opts.debug]
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx || null;

    this.storageKey =
      String(opts.storageKey || ctx?.includeStorageKey || 'cart:included_states');

    this.eventBus = opts.eventBus || ctx?.eventBus || null;

    this.defaultIncluded =
      typeof opts.defaultIncluded === 'boolean' ? opts.defaultIncluded : true;

    this._debug = !!opts.debug;

    this._map = null; // lazy
    this._saveTimer = null;
    this._saveDelay = 150;
  }

  // ---------------------------------------------------------------------------
  // Map basics
  // ---------------------------------------------------------------------------

  _normalizeIdKey(id) {
    const c = this.ctx;
    if (c && typeof c._normalizeIdKey === 'function') return String(c._normalizeIdKey(id));
    return String(id ?? '').trim();
  }

  _storageAvailable() {
    try {
      return typeof window !== 'undefined' && !!window.localStorage;
    } catch {
      return false;
    }
  }

  _readStorageMap() {
    if (this._map) return this._map;

    const out = Object.create(null);
    if (!this._storageAvailable()) {
      this._map = out;
      return out;
    }

    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) {
        this._map = out;
        return out;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const k of Object.keys(parsed)) out[String(k)] = !!parsed[k];
      }
    } catch (e) {
      this.ctx?._logError?.('[IncludedStates] read failed', e);
    }

    this._map = out;
    return out;
  }

  _writeStorageImmediate() {
    if (!this._storageAvailable()) return;
    try {
      const payload = JSON.stringify(this._map || {});
      window.localStorage.setItem(this.storageKey, payload);
    } catch (e) {
      this.ctx?._logError?.('[IncludedStates] write failed', e);
    }
  }

  _scheduleWrite() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._writeStorageImmediate();
    }, this._saveDelay);
  }

  _emitChanged(payload) {
    try {
      this.eventBus?.emit?.('included:changed', payload);
    } catch (e) {
      this.ctx?._logError?.('[IncludedStates] emit failed', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Get included flag for id. Falls back to defaultIncluded if absent.
   * @param {string} id
   * @returns {boolean}
   */
  get(id) {
    const key = this._normalizeIdKey(id);
    if (!key) return this.defaultIncluded;
    const map = this._readStorageMap();
    return Object.prototype.hasOwnProperty.call(map, key) ? !!map[key] : this.defaultIncluded;
  }

  /**
   * Alias for compatibility with old code.
   * @param {any} item
   * @returns {boolean}
   */
  ensureItemIncluded(item) {
    if (!item) return false;
    const key = this._normalizeIdKey(item?.name ?? item?.id);
    const val = this.get(key);
    // It’s allowed to set the flag on item when asked for it (no cart logic duplication)
    item.included = !!val;
    return !!val;
  }

  /**
   * Set included flag for id.
   * @param {string} id
   * @param {boolean} included
   * @param {object} [opts]
   * @param {boolean} [opts.immediateSave]
   * @param {string}  [opts.reason]
   * @returns {boolean} changed
   */
  set(id, included, opts = {}) {
    const key = this._normalizeIdKey(id);
    if (!key) return false;

    const map = this._readStorageMap();
    const next = !!included;
    const prev = Object.prototype.hasOwnProperty.call(map, key) ? !!map[key] : this.defaultIncluded;

    if (prev === next) return false;

    map[key] = next;
    this._map = map;

    if (opts.immediateSave) this._writeStorageImmediate();
    else this._scheduleWrite();

    this._emitChanged({ id: key, included: next, prev, reason: opts.reason || 'set' });

    return true;
  }

  /**
   * Apply included state to provided items (sets item.included).
   * @param {Array<any>} items
   * @returns {boolean} whether anything changed on items
   */
  applyToItems(items = []) {
    const arr = Array.isArray(items) ? items : [];
    let changed = false;

    for (const it of arr) {
      const key = this._normalizeIdKey(it?.name ?? it?.id);
      if (!key) continue;
      const v = this.get(key);
      if (it.included !== v) {
        it.included = v;
        changed = true;
      }
    }

    if (this._debug) {
      // eslint-disable-next-line no-console
      console.debug('[IncludedStates] applyToItems changed=', changed);
    }
    return changed;
  }

  /**
   * Save current included state from items into the map.
   * @param {Array<any>} items
   * @param {boolean} [immediate]
   */
  syncFromItems(items = [], immediate = false) {
    const arr = Array.isArray(items) ? items : [];
    const map = Object.create(null);

    for (const it of arr) {
      const key = this._normalizeIdKey(it?.name ?? it?.id);
      if (!key) continue;
      map[key] = it?.included !== undefined ? !!it.included : this.defaultIncluded;
    }

    this._map = map;

    if (immediate) this._writeStorageImmediate();
    else this._scheduleWrite();
  }

  /**
   * Toggle included flag for id.
   */
  toggle(id, opts = {}) {
    const key = this._normalizeIdKey(id);
    const next = !this.get(key);
    return this.set(key, next, { ...opts, reason: opts.reason || 'toggle' });
  }

  /**
   * Toggle all items included state (updates items + map).
   * Does NOT call any UI updates — caller orchestrates UI.
   * @param {Array<any>} items
   * @param {boolean} val
   * @param {object} [opts]
   * @param {boolean} [opts.immediateSave]
   * @returns {boolean} changed
   */
  setAll(items = [], val, opts = {}) {
    const arr = Array.isArray(items) ? items : [];
    const next = !!val;

    const map = this._readStorageMap();
    let changed = false;

    for (const it of arr) {
      const key = this._normalizeIdKey(it?.name ?? it?.id);
      if (!key) continue;

      const prevItem = it.included !== undefined ? !!it.included : this.get(key);
      if (prevItem !== next) changed = true;

      it.included = next;
      map[key] = next;
    }

    this._map = map;

    if (opts.immediateSave) this._writeStorageImmediate();
    else this._scheduleWrite();

    if (changed) this._emitChanged({ all: true, included: next, reason: 'setAll' });

    return changed;
  }

  /**
   * Count selected (included=true) items.
   * @param {Array<any>} items
   * @returns {number}
   */
  countSelected(items = []) {
    const arr = Array.isArray(items) ? items : [];
    let count = 0;
    for (const it of arr) {
      const key = this._normalizeIdKey(it?.name ?? it?.id);
      if (!key) continue;
      const v = it?.included !== undefined ? !!it.included : this.get(key);
      if (v) count++;
    }
    return count;
  }

  /**
   * Update master checkbox visual state (purely UI).
   * Reads ctx.masterSelect + ctx.cart.
   */
  updateMasterSelectState() {
    const c = this.ctx;
    const ms = c?.masterSelect;
    if (!ms) return;

    const cart = Array.isArray(c?.cart) ? c.cart : [];
    if (cart.length === 0) {
      ms.checked = false;
      ms.indeterminate = false;
      ms.dataset.state = 'none';
      return;
    }

    let included = 0;
    for (const it of cart) {
      const v = it?.included !== undefined ? !!it.included : this.ensureItemIncluded(it);
      if (v) included++;
    }

    if (included === 0) {
      ms.checked = false;
      ms.indeterminate = false;
      ms.dataset.state = 'none';
    } else if (included === cart.length) {
      ms.checked = true;
      ms.indeterminate = false;
      ms.dataset.state = 'full';
    } else {
      ms.checked = false;
      ms.indeterminate = true;
      ms.dataset.state = 'mixed';
    }
  }

  /**
   * Backward-compatible wrapper for old CartDOMRefs/CartUI code.
   * @param {boolean} val
   * @returns {boolean}
   */
  toggleAllIncluded(val) {
    const c = this.ctx;
    const cart = Array.isArray(c?.cart) ? c.cart : [];
    return this.setAll(cart, !!val, { immediateSave: true });
  }

  /**
   * Backward-compatible wrapper for old GridListeners code.
   * @param {string} id
   * @param {boolean} included
   * @param {object} [opts]
   * @returns {boolean}
   */
  toggleInclude(id, included, opts = {}) {
    const c = this.ctx;
    const key = this._normalizeIdKey(id);
    const item = typeof c?._getCartItemById === 'function' ? c._getCartItemById(key) : null;

    const changed = this.set(key, !!included, { immediateSave: !!opts.immediateSave, reason: 'toggleInclude' });
    if (item) item.included = !!included;

    return changed;
  }

  saveIncludedStatesToLocalStorage(immediate = false) {
    const c = this.ctx;
    const cart = Array.isArray(c?.cart) ? c.cart : [];
    this.syncFromItems(cart, !!immediate);
  }

  loadIncludedStatesFromLocalStorage() {
    const c = this.ctx;
    const cart = Array.isArray(c?.cart) ? c.cart : [];
    return this.applyToItems(cart);
  }

  getMapSnapshot() {
    const map = this._readStorageMap();
    return { ...map };
  }
}
