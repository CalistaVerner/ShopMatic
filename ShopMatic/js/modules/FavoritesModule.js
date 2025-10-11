// shopmatic/FavoritesModule.js
export class FavoritesModule {
  /**
   * @param {object} params.storage - объект-хранилище с методами loadFavs() и saveFavs(iterable)
   * @param {object} [params.opts]
   * @param {number} [params.opts.max] - максимальное число избранного (0 = без лимита)
   * @param {boolean} [params.opts.sync=true] - слушать window.storage для синхронизации вкладок
   * @param {number} [params.opts.saveDebounceMs=200] - дебаунс для сохранения
   * @param {Array|string[]} [params.opts.initial] - начальные id (опционально)
   */
  constructor({ storage, opts = {} } = {}) {
    if (!storage || typeof storage.loadFavs !== 'function' || typeof storage.saveFavs !== 'function') {
      throw new Error('FavoritesModule requires storage with loadFavs() and saveFavs() methods');
    }

    this.storage = storage;
    this._max = Number.isFinite(opts.max) && opts.max > 0 ? Math.floor(opts.max) : 0;
    this._sync = opts.sync !== undefined ? Boolean(opts.sync) : true;
    this._saveDebounceMs = Number.isFinite(opts.saveDebounceMs) ? Math.max(0, opts.saveDebounceMs) : 200;

    // internal structures: array preserves insertion order, set — O(1) lookup
    this._list = [];      // ['id1','id2', ...]
    this._set = new Set(); // mirrors _list

    // subscribers: functions(event)
    this._subs = new Set();

    // debounce timer
    this._saveTimer = null;
    this._destroyed = false;

    // bind handler
    this._onStorageEvent = this._onStorageEvent.bind(this);

    // optionally load initial list and storage
    if (Array.isArray(opts.initial) && opts.initial.length) {
      this.importFromArray(opts.initial, { replace: true, persist: false });
    }

    // load from storage (try/catch)
    this.loadFromStorage();

    // auto-sync across tabs
    if (this._sync && typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('storage', this._onStorageEvent);
    }
  }

  /* ===================== internal helpers ===================== */

  _emit(event) {
    // event: { type, id = null }
    const payload = {
      type: event.type,
      id: event.id === undefined ? null : event.id,
      list: this.exportToArray(),
      count: this.getCount()
    };
    for (const cb of Array.from(this._subs)) {
      try {
        cb(payload);
      } catch (e) {
        // подписчики не должны ломать модуль
        // eslint-disable-next-line no-console
        console.warn('FavoritesModule subscriber error', e);
      }
    }
  }

  _scheduleSave() {
    if (this._saveDebounceMs <= 0) {
      // immediate
      this._doSave();
      return;
    }
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._doSave();
    }, this._saveDebounceMs);
  }

  _doSave() {
    try {
      // save array — preserves order in storage
      this.storage.saveFavs(this._list);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('FavoritesModule: save to storage failed', e);
    }
  }

  _normalizeId(id) {
    if (id === null || id === undefined) return null;
    return String(id);
  }

  /* ===================== persistence ===================== */

  /**
   * Загружает фавориты из storage и обновляет внутреннее состояние.
   * Возвращает текущий массив (копия).
   */
  loadFromStorage() {
    try {
      const raw = this.storage.loadFavs();
      if (!Array.isArray(raw)) {
        // nothing or invalid — keep current list if present, else empty
        if (!this._list.length) {
          this._list = [];
          this._set = new Set();
        }
        this._emit({ type: 'load', id: null });
        return this.exportToArray();
      }
      // нормализуем: фильтрация пустых, toString, uniq-preserve-order
      const normalized = [];
      const seen = new Set();
      for (const el of raw) {
        try {
          const sid = this._normalizeId(el);
          if (!sid) continue;
          if (seen.has(sid)) continue;
          seen.add(sid);
          normalized.push(sid);
        } catch { /* skip invalid */ }
      }

      this._list = normalized;
      this._set = new Set(normalized);

      // если есть лимит — обрезаем старые элементы (с начала) чтобы сохранить последние добавленные
      if (this._max > 0 && this._list.length > this._max) {
        // keep last _max elements
        this._list = this._list.slice(-this._max);
        this._set = new Set(this._list);
        // persist truncated version
        this._scheduleSave();
      }

      this._emit({ type: 'load', id: null });
      return this.exportToArray();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('FavoritesModule.loadFromStorage error', e);
      return this.exportToArray();
    }
  }

  /**
   * Принудительная синхронная запись в storage (без дебаунса)
   */
  saveToStorage() {
    if (this._destroyed) return;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._doSave();
  }

  /* ===================== public API ===================== */

  isFavorite(id) {
    const sid = this._normalizeId(id);
    if (!sid) return false;
    return this._set.has(sid);
  }

  getAll() {
    // возвращаем копию
    return Array.from(this._list);
  }

  getCount() {
    return this._list.length;
  }

  /**
   * Добавить элемент. Возвращает true если добавлен, false если уже был или отказано (лимит/ошибка).
   */
  add(id) {
    if (this._destroyed) return false;
    const sid = this._normalizeId(id);
    if (!sid) return false;

    if (this._set.has(sid)) return false;

    if (this._max > 0 && this._list.length >= this._max) {
      // отказ при достижении лимита
      return false;
    }

    this._list.push(sid);
    this._set.add(sid);
    this._scheduleSave();
    this._emit({ type: 'add', id: sid });
    return true;
  }

  /**
   * Удалить элемент. Возвращает true если удалён, false если не найден.
   */
  remove(id) {
    if (this._destroyed) return false;
    const sid = this._normalizeId(id);
    if (!sid) return false;
    if (!this._set.has(sid)) return false;

    // удалить из массива и сет
    this._list = this._list.filter(x => x !== sid);
    this._set.delete(sid);
    this._scheduleSave();
    this._emit({ type: 'remove', id: sid });
    return true;
  }

  /**
   * Переключает состояние. Возвращает true если после вызова элемент находится в favs, false если не в favs.
   */
  toggle(id) {
    if (this._destroyed) return false;
    const sid = this._normalizeId(id);
    if (!sid) return false;
    if (this._set.has(sid)) {
      this.remove(sid);
      return false;
    } else {
      const ok = this.add(sid);
      return Boolean(ok);
    }
  }

  /**
   * Очищает избранное
   */
  clear() {
    if (this._destroyed) return;
    if (this._list.length === 0) return;
    this._list = [];
    this._set.clear();
    this._scheduleSave();
    this._emit({ type: 'clear', id: null });
  }

  /**
   * Импорт массива id.
   * opts.replace = true  -> заменить текущую коллекцию новым массивом
   * opts.persist = true|false -> вызвать сохранение в storage (по умолчанию true)
   * Возвращает итоговый массив.
   */
  importFromArray(arr = [], { replace = false, persist = true } = {}) {
    if (!Array.isArray(arr)) return this.exportToArray();
    const normalized = [];
    const seen = new Set();
    for (const el of arr) {
      const sid = this._normalizeId(el);
      if (!sid) continue;
      if (seen.has(sid)) continue;
      seen.add(sid);
      normalized.push(sid);
    }
    if (replace) {
      // respect max: keep last _max if needed
      let final = normalized;
      if (this._max > 0 && final.length > this._max) final = final.slice(-this._max);
      this._list = final;
      this._set = new Set(final);
    } else {
      // add missing preserving existing order
      for (const sid of normalized) {
        if (this._set.has(sid)) continue;
        if (this._max > 0 && this._list.length >= this._max) break;
        this._list.push(sid);
        this._set.add(sid);
      }
    }
    if (persist) this._scheduleSave();
    this._emit({ type: 'import', id: null });
    return this.exportToArray();
  }

  exportToArray() {
    return Array.from(this._list);
  }

  /**
   * Подписка на события изменений.
   * cb(event) — получает { type, id, list, count }
   * Возвращает функцию отписки.
   */
  subscribe(cb) {
    if (typeof cb !== 'function') throw new Error('subscribe requires a function');
    this._subs.add(cb);
    // немедленно отправить текущее состояние
    try { cb({ type: 'load', id: null, list: this.exportToArray(), count: this.getCount() }); } catch (e) {}
    return () => { this._subs.delete(cb); };
  }

  /* ===================== cross-tab sync ===================== */

  _onStorageEvent(e) {
    try {
      if (!e || !e.key) return;
      const key = e.key;
      const favKey = (this.storage && this.storage.favStorageKey) ? String(this.storage.favStorageKey) : null;
      if (!favKey) return;
      if (key !== favKey) return;

      // reload from storage — storage event comes with newValue in other browsers but use loadFavs() for normalization
      const prev = this.exportToArray();
      this.loadFromStorage();
      const curr = this.exportToArray();
      // emit sync event only if different
      const changed = prev.length !== curr.length || prev.some((v, i) => v !== curr[i]);
      if (changed) this._emit({ type: 'sync', id: null });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('FavoritesModule._onStorageEvent error', e);
    }
  }

  /* ===================== lifecycle ===================== */

  /**
   * Перестаёт слушать storage и отменяет отложенные операции.
   */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (this._sync && typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('storage', this._onStorageEvent);
    }
    this._subs.clear();
  }
}
