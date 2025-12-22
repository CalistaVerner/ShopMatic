// StorageService/storageType/ViewedStorage.js

import { LocalStorageAdapter } from './LocalStorageAdapter.js';

/**
 * Хранилище просмотренных товаров.
 * Наследует LocalStorageAdapter → BaseStorage.
 */
export class ViewedStorage extends LocalStorageAdapter {
  /**
   * @param {Object} deps
   * @param {string} [deps.viewedStorageKey] - Storage key for viewed items.
   * @param {number} [deps.maxViewedItems] - Maximum number of viewed items to keep.
   * @param {Function} [deps.onViewedChanged] - Callback triggered after the viewed list changes.
   */
  constructor({
    viewedStorageKey = 'gribkov_viewed_v1',
    maxViewedItems = 20,
    onViewedChanged = null
  } = {}) {
    super();
    this.viewedStorageKey = viewedStorageKey;
    this.maxViewedItems = Number(maxViewedItems || 20);
    this.onViewedChanged =
      typeof onViewedChanged === 'function' ? onViewedChanged : null;
  }

  _notifyChanged() {
    try {
      if (this.onViewedChanged) this.onViewedChanged();
    } catch (e) {
      console.warn('ViewedStorage.onViewedChanged failed', e);
    }
  }

  /**
   * Loads the list of viewed products.
   * @returns {Array|null}
   */
  loadViewed() {
    return this.getJSON(this.viewedStorageKey, { arrayOnly: true });
  }

  /**
   * Adds a product to the viewed list.
   * Automatically removes duplicates and limits list length.
   *
   * @param {Object} product
   */
  addViewed(product) {
    try {
      if (!product || !product.name) return;

      const item = {
        name: String(product.name ?? ''),
        fullname: product.fullname ?? '',
        price: Number(product.price ?? 0),
        picture: product.picture ?? '',
        stock: Number(product.stock ?? 0),
        viewedAt: Date.now()
      };

      const viewed = this.loadViewed() ?? [];
      const filtered = viewed.filter(p => p.name !== item.name);
      filtered.unshift(item);

      const limited = filtered.slice(0, this.maxViewedItems);

      this.setJSON(this.viewedStorageKey, limited);
      this._notifyChanged();
    } catch (e) {
      console.warn('ViewedStorage.addViewed error', e);
    }
  }

  /**
   * Clears the entire viewed list.
   */
  clearViewed() {
    this.remove(this.viewedStorageKey);
    this._notifyChanged();
  }
}
