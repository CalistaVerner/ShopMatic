import { FavoritesCore } from './FavoritesCore.js';
import { FavoritesStorageManager } from './FavoritesStorageManager.js';
import { FavoritesUI } from './ui/FavoritesUI.js';
import { Events } from '../Events.js';
import { makeEventEnvelope } from '../EventContracts.js';

/**
 * FavoritesModule
 * @author Calista Verner
 */
export class FavoritesModule {
  constructor({ storage, opts = {} } = {}) {
    if (!storage || typeof storage.loadFavs !== 'function' || typeof storage.saveFavs !== 'function') {
      throw new Error('FavoritesModule requires storage with loadFavs() and saveFavs() methods');
    }

    this.storage = storage;
    this.shopMatic = storage.shopMatic || null;

    this._destroyed = false;
    this._subs = new Set();

    const max = Math.max(0, Number.isFinite(opts.max) ? Math.floor(opts.max) : 0);
    const overflow = opts.overflow === 'drop_oldest' ? 'drop_oldest' : 'reject';

    this._core = new FavoritesCore({ max, overflow });

    this._storageManager = new FavoritesStorageManager(storage, {
      saveDebounceMs: opts.saveDebounceMs,
      storageKey: opts.storageKey,
      sync: opts.sync,
      onExternalChange: () => this._handleExternalStorageChange(),
    });

    this.wishlistModule = new FavoritesUI({ foxEngine: storage.shopMatic.foxEngine });

    if (Array.isArray(opts.initial) && opts.initial.length) {
      this.importFromArray(opts.initial, { replace: true, persist: false });
    }

    this.loadFromStorage();
  }

  _bus() {
    return this.shopMatic?.eventBus || null;
  }

  _emitFavChanged(payload) {
    const bus = this._bus();
    if (!bus?.emit) return;
    // Yandex-standard: canonical envelope only.
    try { bus.emit(Events.DOMAIN_FAVORITES_CHANGED, makeEventEnvelope(Events.DOMAIN_FAVORITES_CHANGED, payload, { source: 'FavoritesModule' })); } catch {}
  }

  _emit(event) {
    const payload = {
      type: event.type,
      id: event.id || null,
      reason: event.reason || null,
      list: this.exportToArray(),
      count: this.getCount(),
    };

    for (const cb of this._subs) {
      try { cb(payload); } catch (e) { console.warn('FavoritesModule subscriber error', e); }
    }
  }

  _scheduleSave() {
    this._storageManager.scheduleSave(this.exportToArray());
  }

  async _handleExternalStorageChange() {
    const prev = this.exportToArray();
    await this.loadFromStorage();
    const curr = this.exportToArray();

    if (prev.length !== curr.length || prev.some((v, i) => v !== curr[i])) {
      this._emit({ type: 'sync', id: null });
      this._emitFavChanged({ ids: curr, action: 'sync' });
    }
  }

  async loadFromStorage() {
    if (this._destroyed) return this.exportToArray();

    const raw = await this._storageManager.loadRaw();
    const { truncated } = this._core.replaceList(raw);

    if (truncated) this._scheduleSave();

    const list = this.exportToArray();
    this._emit({ type: 'load', id: null });
    this._emitFavChanged({ ids: list, action: 'load' });

    return list;
  }

  saveToStorage() {
    if (this._destroyed) return;
    this._storageManager.saveNow(this.exportToArray());
  }

  has(id) { return this.isFavorite(id); }
  isFavorite(id) { return this._core.isFavorite(id); }
  getAll() { return this._core.exportToArray(); }
  getCount() { return this._core.getCount(); }

  add(id) {
    if (this._destroyed) return false;

    const res = this._core.add(id);
    if (!res.ok) {
      if (res.reason === 'limit_reached') {
        this._emit({ type: 'limit', id: res.id, reason: 'limit_reached' });
      }
      return false;
    }

    this._scheduleSave();
    this._emit({ type: 'add', id: res.id });
    this._emitFavChanged({ id: res.id, action: 'add' });
    return true;
  }

  remove(id) {
    if (this._destroyed) return false;

    const res = this._core.remove(id);
    if (!res.ok) return false;

    this._scheduleSave();
    this._emit({ type: 'remove', id: res.id });
    this._emitFavChanged({ id: res.id, action: 'remove' });
    return true;
  }

  toggle(id) {
    if (this._destroyed) return false;

    const res = this._core.toggle(id);

    if (res.action === 'limit' && res.reason === 'limit_reached') {
      this._emit({ type: 'limit', id: res.id, reason: 'limit_reached' });
      return false;
    }

    if (!res.ok) return false;

    this._scheduleSave();

    if (res.action === 'add') {
      this._emit({ type: 'add', id: res.id });
      this._emitFavChanged({ id: res.id, action: 'add' });
    } else if (res.action === 'remove') {
      this._emit({ type: 'remove', id: res.id });
      this._emitFavChanged({ id: res.id, action: 'remove' });
    }

    return true;
  }

  clear() {
    if (this._destroyed) return;

    // snapshot ids before clear for point-refresh
    const before = this.exportToArray();

    const res = this._core.clear();
    if (!res.ok) return;

    this._scheduleSave();
    this._emit({ type: 'clear', id: null });
    if (before.length) this._emitFavChanged({ ids: before, action: 'clear' });
    else this._emitFavChanged({ action: 'clear' });
  }

  importFromArray(arr = [], { replace = false, persist = true } = {}) {
    if (this._destroyed) return this.exportToArray();

    const res = this._core.importFromArray(arr, { replace });
    if (persist) this._scheduleSave();

    const list = this.exportToArray();
    this._emit({ type: 'import', id: null });
    this._emitFavChanged({ ids: list, action: 'import' });

    return list;
  }

  exportToArray() {
    return this._core.exportToArray();
  }

  subscribe(cb, { immediate = true } = {}) {
    if (typeof cb !== 'function') throw new Error('subscribe requires a function');

    this._subs.add(cb);

    if (immediate) {
      cb({
        type: 'load',
        id: null,
        list: this.exportToArray(),
        count: this.getCount(),
      });
    }

    return () => this._subs.delete(cb);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    this._storageManager.destroy();
    this._subs.clear();
  }

  [Symbol.iterator]() {
    return this._core[Symbol.iterator]();
  }

  toSet() {
    return this._core.toSet();
  }
}
