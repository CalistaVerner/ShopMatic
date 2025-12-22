// StorageService/storageType/BaseStorage.js

export class BaseStorage {
  /**
   * @param {Storage|undefined} storage - обычно window.localStorage, но можно подменить (для тестов)
   */
  constructor(storage) {
    this._storage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  }

  isAvailable() {
    if (!this._storage) return false;
    try {
      const k = '__storage_test__';
      this._storage.setItem(k, '1');
      this._storage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Безопасно пишем JSON.
   * @returns {boolean}
   */
  setJSON(key, value) {
    if (!this.isAvailable()) return false;
    try {
      this._storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn(`BaseStorage.setJSON error for key="${key}"`, e);
      return false;
    }
  }

  /**
   * Безопасно читаем JSON.
   * @param {string} key
   * @param {Object} [opts]
   * @param {boolean} [opts.arrayOnly] - если true, вернёт только массив или null
   */
  getJSON(key, opts = {}) {
    if (!this.isAvailable()) return null;
    try {
      const raw = this._storage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (opts.arrayOnly && !Array.isArray(parsed)) return null;
      return parsed;
    } catch (e) {
      console.warn(`BaseStorage.getJSON error for key="${key}"`, e);
      return null;
    }
  }

  remove(key) {
    if (!this.isAvailable()) return;
    try {
      this._storage.removeItem(key);
    } catch (e) {
      console.warn(`BaseStorage.remove error for key="${key}"`, e);
    }
  }
}
