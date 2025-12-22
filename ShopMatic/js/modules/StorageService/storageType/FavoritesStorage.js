// StorageService/storageType/FavoritesStorage.js

import { LocalStorageAdapter } from './LocalStorageAdapter.js';
import { AvailabilityLoader } from '../AvailabilityLoader.js';

/**
 * Хранилище избранного.
 * Наследует LocalStorageAdapter → BaseStorage.
 */
export class FavoritesStorage extends LocalStorageAdapter {
  /**
   * @param {Object} deps
   * @param {AvailabilityLoader} deps.availabilityLoader
   * @param {Object} [deps.shopMatic] - для onMissingCallback (опционально)
   * @param {string} [deps.favStorageKey]
   */
  constructor({
    availabilityLoader,
    shopMatic = null,
    favStorageKey = 'gribkov_favs_v1'
  } = {}) {
    super();
    this.availabilityLoader = availabilityLoader;
    this.shopMatic = shopMatic;
    this.favStorageKey = favStorageKey;
  }

  _normalizeFavItem(input) {
    if (typeof input === 'string') {
      return { name: input, fullname: '', price: 0, stock: 0 };
    }
    return {
      name: String(input.name ?? ''),
      fullname: input.fullname ?? '',
      price: Number(input.price ?? 0),
      stock: Number(input.stock ?? 0)
    };
  }

  saveFavs(setLike) {
    try {
      const arr = Array.from(setLike ?? []);
      return this.setJSON(this.favStorageKey, arr);
    } catch (e) {
      console.warn('FavoritesStorage.saveFavs error', e);
      return false;
    }
  }

  loadFavs() {
    return this.getJSON(this.favStorageKey, { arrayOnly: true });
  }

  async loadFavsWithAvailability(options = {}) {
    const rawFavs = this.loadFavs();
    if (!Array.isArray(rawFavs) || rawFavs.length === 0) return rawFavs || [];

    const normalized = rawFavs.map((item) =>
      typeof item === 'string' ? item : this._normalizeFavItem(item)
    );

    const onMissing = (key) => {
      try {
        const ps = this.shopMatic?.productService;
        if (ps && typeof ps.removeFavoriteById === 'function') {
          ps.removeFavoriteById(key);
        }
      } catch (e) {
        console.warn('FavoritesStorage: onMissing callback failed for', key, e);
      }
    };

    return this.availabilityLoader.loadWithAvailability(
      normalized,
      options,
      onMissing
    );
  }
}
