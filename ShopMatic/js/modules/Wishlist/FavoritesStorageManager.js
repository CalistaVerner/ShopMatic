// wishlist/FavoritesStorageManager.js

/**
 * FavoritesStorageManager — отвечает за:
 *  - загрузку и сохранение в storage
 *  - debounce записи
 *  - cross-tab sync через window.storage
 */
export class FavoritesStorageManager {
  constructor(storage, {
    saveDebounceMs = 200,
    storageKey = null,
    sync = true,
    onExternalChange = null,
  } = {}) {
    if (!storage || typeof storage.loadFavs !== 'function' || typeof storage.saveFavs !== 'function') {
      throw new Error('FavoritesStorageManager requires storage with loadFavs() and saveFavs()');
    }

    this.storage = storage;
    this._saveDebounceMs = Math.max(
      0,
      Number.isFinite(saveDebounceMs) ? saveDebounceMs : 200
    );
    this._storageKey = storageKey || storage.favStorageKey || storage.storageKey || null;
    this._sync = sync !== undefined ? Boolean(sync) : true;
    this._onExternalChange = typeof onExternalChange === 'function' ? onExternalChange : null;
    this._saveTimer = null;
    this._destroyed = false;

    this._onStorageEvent = this._onStorageEvent.bind(this);

    if (this._sync && typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('storage', this._onStorageEvent);
    }
  }

  async loadRaw() {
    try {
      const result = this.storage.loadFavsWithAvailability
        ? this.storage.loadFavsWithAvailability()
        : this.storage.loadFavs();

      return await Promise.resolve(result);
    } catch (e) {
      console.warn('FavoritesStorageManager.loadRaw error', e);
      return [];
    }
  }

  _doSave(list) {
    if (this._destroyed) return;
    try {
      const res = this.storage.saveFavs(list);
      if (res && typeof res.then === 'function') {
        res.then(null, err =>
          console.warn('FavoritesStorageManager: async save failed', err)
        );
      }
    } catch (e) {
      console.warn('FavoritesStorageManager: save failed', e);
    }
  }

  scheduleSave(list) {
    if (this._destroyed) return;

    if (this._saveDebounceMs <= 0) {
      this._doSave(list);
      return;
    }

    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._doSave(list);
    }, this._saveDebounceMs);
  }

  saveNow(list) {
    if (this._destroyed) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this._doSave(list);
  }

  _onStorageEvent(e) {
    if (!e || !e.key) return;
    const favKey =
      this._storageKey ||
      (this.storage && (this.storage.favStorageKey || this.storage.storageKey)) ||
      null;

    if (!favKey || e.key !== favKey) return;
    if (this._onExternalChange) {
      this._onExternalChange(e);
    }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    if (this._sync && typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('storage', this._onStorageEvent);
    }
  }
}
