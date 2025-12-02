/**
 * IncludedStates — управление состояниями "included" (localStorage, master state)
 * ctx — CartUI
 *
 * Поведение:
 *  - item.included — главный источник истины (если задан)
 *  - при загрузке из localStorage устанавливаются item.included (default true)
 *  - toggleInclude меняет только один товар, обновляет internal map и сохраняет её (debounced)
 *  - saveIncludedStatesToLocalStorage собирает карту из текущих item.included значений
 *  - есть логирование для отладки
 */
export class IncludedStates {
  constructor(ctx) {
    this.ctx = ctx;

    // internal cache of the stored map (key -> boolean)
    this._map = null;

    // debounce timer id for saves
    this._saveTimer = null;
    this._saveDelay = 150; // ms

    // safety: do not spam console in prod, you can toggle this
    this._debug = true;
  }

  // ---------- Storage helpers ----------

  _readStorageMap() {
    const c = this.ctx;
    if (this._map !== null) return this._map;
    this._map = Object.create(null);
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        if (this._debug) console.debug('[IncludedStates] storage unavailable');
        return this._map;
      }
      const raw = window.localStorage.getItem(c.includeStorageKey);
      if (!raw) {
        if (this._debug) console.debug('[IncludedStates] no stored map');
        return this._map;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const k of Object.keys(parsed)) {
          this._map[k] = Boolean(parsed[k]);
        }
        if (this._debug) console.debug('[IncludedStates] loaded map from storage', this._map);
      }
    } catch (e) {
      c._logError('IncludedStates._readStorageMap failed', e);
      // leave _map = {}
    }
    return this._map;
  }
  
	/**
	 * Возвращает количество выбранных товаров (included = true)
	 */
	countSelected() {
	  const c = this.ctx;
	  if (!Array.isArray(c.cart) || c.cart.length === 0) return 0;

	  let count = 0;
	  for (const it of c.cart) {
		if (this.ensureItemIncluded(it)) count++;
	  }
	  return count;
	}


  _writeStorageImmediate() {
    const c = this.ctx;
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        if (this._debug) console.debug('[IncludedStates] storage unavailable, skip write');
        return;
      }
      // ensure _map is up-to-date (but saveIncludedStatesToLocalStorage usually builds it)
      const payload = JSON.stringify(this._map || {});
      window.localStorage.setItem(c.includeStorageKey, payload);
      if (this._debug) console.debug('[IncludedStates] wrote map to storage', this._map);
    } catch (e) {
      c._logError('IncludedStates._writeStorageImmediate failed', e);
    }
  }

  _scheduleWrite() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._writeStorageImmediate();
    }, this._saveDelay);
  }

  // ---------- Public API: load / save ----------

  /**
   * Build and save the map from current cart items.
   * If immediate === true, write synchronously; else debounced.
   */
  saveIncludedStatesToLocalStorage(immediate = false) {
    const c = this.ctx;
    try {
      // build fresh map from current cart to avoid stale/undefined problems
      const map = Object.create(null);
      for (const it of c.cart) {
        const key = c._normalizeIdKey(it && (it.name ?? it.id));
        if (!key) continue;
        // ensureItemIncluded will set item.included if undefined; we prefer explicit boolean
        const included = (it.included !== undefined) ? Boolean(it.included) : Boolean(this.ensureItemIncluded(it));
        map[key] = included;
      }

      this._map = map;

      if (this._debug) console.debug('[IncludedStates] save map prepared', this._map);

      if (immediate) {
        this._writeStorageImmediate();
      } else {
        this._scheduleWrite();
      }
    } catch (e) {
      c._logError('IncludedStates.saveIncludedStatesToLocalStorage failed', e);
    }
  }

  /**
   * Load persisted map and apply to cart items.
   * This sets item.included for all items (default true when not present in map).
   */
  loadIncludedStatesFromLocalStorage() {
    const c = this.ctx;
    try {
      const rawMap = this._readStorageMap(); // populates this._map
      let changed = false;

      // Apply to items: set item.included to saved value or default true
      for (const it of c.cart) {
        const key = c._normalizeIdKey(it && (it.name ?? it.id));
        if (!key) continue;
        const saved = Object.prototype.hasOwnProperty.call(this._map, key) ? Boolean(this._map[key]) : true;
        if (it.included !== saved) {
          if (this._debug) console.debug(`[IncludedStates] applying loaded included for ${key}:`, saved);
          it.included = saved;
          try { c._pendingChangedIds.add(String(key)); } catch (_) {}
          changed = true;
        }
      }

      if (changed) {
        try {
          // reindex so other systems see updated flags
          c._rebuildIndex?.();
        } catch (e) {
          c._logError('IncludedStates.loadIncludedStatesFromLocalStorage _rebuildIndex failed', e);
        }
      }

      // update master checkbox visual (don't force full UI rerender here)
      try {
        this.updateMasterSelectState();
      } catch (_) {}

      if (this._debug) console.debug('[IncludedStates] load complete, changed=', changed);

      return changed;
    } catch (e) {
      c._logError('_loadIncludedStatesFromLocalStorage failed', e);
      return false;
    }
  }

  // ---------- Single-item helpers ----------

  /**
   * Ensure item.included is set and return boolean.
   * - If item.included already defined -> use it
   * - Else consult loaded map (cached), if none -> default true.
   * Also sets item.included to avoid undefined states.
   */
  ensureItemIncluded(item) {
    const c = this.ctx;
    if (!item) return false;

    if (item.included !== undefined) return Boolean(item.included);

    // read or initialize storage map
    const map = this._readStorageMap();

    const key = c._normalizeIdKey(item && (item.name ?? item.id));
    if (!key) {
      // fallback default
      item.included = true;
      return true;
    }

    if (Object.prototype.hasOwnProperty.call(map, key)) {
      item.included = Boolean(map[key]);
    } else {
      // default include for unknown keys
      item.included = true;
    }

    if (this._debug) console.debug(`[IncludedStates] ensureItemIncluded(${key}) =>`, item.included);
    return Boolean(item.included);
  }

  /**
   * Toggle single item's included state.
   * Changes only that item, updates internal map and persists (debounced by default).
   */
  toggleInclude(id, included, { sourceRow = null, immediateSave = false } = {}) {
    const c = this.ctx;
    try {
      const normalized = String(c._normalizeIdKey(id));
      const item = c._getCartItemById(normalized);

      if (!item) {
        console.warn(`[IncludedStates] toggleInclude: item not found for id="${normalized}"`);
        return false;
      }

      const now = Boolean(included);
      if (this._debug) console.debug(`[IncludedStates] toggleInclude: ${normalized} ${item.included} -> ${now}`);

      // change model
      item.included = now;

      try { c._pendingChangedIds.add(normalized); } catch (_) {}

      // sync UI row if present
      if (sourceRow) {
        try { c.rowSync.syncRowControls(sourceRow, item); } catch (syncErr) {
          c._logError(`[IncludedStates] toggleInclude: syncRowControls failed for "${normalized}"`, syncErr);
        }
      }

      // update internal map for this key and schedule save
      this._readStorageMap(); // ensure _map exists
      this._map[normalized] = now;

      // persist (debounced by default)
      this.saveIncludedStatesToLocalStorage(immediateSave);

      // update master checkbox visual immediately
      try { this.updateMasterSelectState(); } catch (err) { c._logError('updateMasterSelectState failed', err); }

      if (this._debug) {
        console.debug('[IncludedStates] toggleInclude: map after toggle', this._map);
      }

      return true;
    } catch (e) {
      c._logError('toggleInclude failed', e);
      return false;
    }
  }

  /**
   * Toggle all items included state.
   * Persists map and triggers UI update via CartUI.
   */
  toggleAllIncluded(val) {
    const c = this.ctx;
    try {
      const v = Boolean(val);
      const map = Object.create(null);

      for (const it of c.cart) {
        it.included = v;
        const key = c._normalizeIdKey(it && (it.name ?? it.id));
        if (key) map[key] = v;
        try { c._pendingChangedIds.add(String(key)); } catch (_) {}
      }

      this._map = map;

      // persist quickly (do immediate write to avoid perceivable lag)
      this.saveIncludedStatesToLocalStorage(true);

      // let CartUI orchestrate a full update (re-render etc.)
      try { c.updateCartUI(); } catch (e) { c._logError('toggleAllIncluded: updateCartUI failed', e); }

      if (this._debug) console.debug('[IncludedStates] toggleAllIncluded ->', v);
      return true;
    } catch (e) {
      c._logError('_toggleAllIncluded failed', e);
      return false;
    }
  }

  // ---------- Master checkbox visual state ----------

  updateMasterSelectState() {
    const c = this.ctx;
    const ms = c.masterSelect;
    if (!ms) return;

    try {
      const total = c.cart.length;
      if (total === 0) {
        ms.checked = false;
        ms.indeterminate = false;
        ms.dataset.state = 'none';
        return;
      }

      // count included (ensure each item has a defined included)
      let included = 0;
      for (const it of c.cart) {
        if (this.ensureItemIncluded(it)) included++;
      }

      if (included === 0) {
        ms.checked = false;
        ms.indeterminate = false;
        ms.dataset.state = 'none';
      } else if (included === total) {
        ms.checked = true;
        ms.indeterminate = false;
        ms.dataset.state = 'full';
      } else {
        ms.checked = false;
        ms.indeterminate = true;
        ms.dataset.state = 'mixed';
      }

      if (this._debug) console.debug(`[IncludedStates] master state: ${ms.dataset.state} (${included}/${total})`);
    } catch (e) {
      c._logError('updateMasterSelectState failed', e);
    }
  }

  // optional utility: expose current map (useful for debugging/tests)
  getMapSnapshot() {
    this._readStorageMap();
    return Object.assign({}, this._map);
  }
}
