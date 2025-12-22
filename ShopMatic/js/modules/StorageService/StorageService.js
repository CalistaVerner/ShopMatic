// StorageService/index.js

import { AvailabilityLoader } from './AvailabilityLoader.js';
import { CartStorage } from './storageType/CartStorage.js';
import { FavoritesStorage } from './storageType/FavoritesStorage.js';
import { ViewedStorage } from './storageType/ViewedStorage.js';

export class StorageService {
  /**
   * @param {Object} shopMatic - Main application service, expected to contain `productService`.
   * @param {Object} [opts]
   * @param {string} [opts.storageKey] - Key used to store the cart.
   * @param {string} [opts.favStorageKey] - Key used to store favorite items.
   * @param {string} [opts.viewedStorageKey] - Key used to store viewed products.
   * @param {number} [opts.maxViewedItems] - Maximum number of viewed items to keep.
   * @param {number} [opts.defaultConcurrency] - Concurrency limit for availability loading.
   */
  constructor(shopMatic, opts = {}) {
    this.shopMatic = shopMatic;

    const storageKey = opts.storageKey ?? 'gribkov_cart_v1';
    const favStorageKey = opts.favStorageKey ?? 'gribkov_favs_v1';
    const viewedStorageKey = opts.viewedStorageKey ?? 'gribkov_viewed_v1';
    const maxViewedItems = Number(opts.maxViewedItems ?? 20);
    const defaultConcurrency = Math.max(1, Number(opts.defaultConcurrency ?? 6));

    this._availabilityLoader = new AvailabilityLoader({
      productService: shopMatic?.productService,
      defaultConcurrency
    });

    this._cartStorage = new CartStorage({
      availabilityLoader: this._availabilityLoader,
      storageKey
    });

    this._favoritesStorage = new FavoritesStorage({
      availabilityLoader: this._availabilityLoader,
      shopMatic,
      favStorageKey
    });

    this._viewedStorage = new ViewedStorage({
      viewedStorageKey,
      maxViewedItems,
      onViewedChanged: () => {
        try {
          shopMatic?.viewedModule?.sync?.();
        } catch (e) {
          console.warn('StorageService: viewedModule.sync failed', e);
        }
      }
    });
  }

  /** @returns {boolean} */
  saveCart(cartArr) {
    return this._cartStorage.saveCart(cartArr);
  }

  /** @returns {Array|null} */
  loadCart() {
    return this._cartStorage.loadCart();
  }

  /**
   * Loads the cart and resolves stock/availability using the product service.
   * @param {Object} [options]
   * @returns {Promise<Array>}
   */
  loadCartWithAvailability(options = {}) {
    return this._cartStorage.loadCartWithAvailability(options);
  }

  /** @returns {boolean} */
  saveFavs(setLike) {
    return this._favoritesStorage.saveFavs(setLike);
  }

  /** @returns {Array|null} */
  loadFavs() {
    return this._favoritesStorage.loadFavs();
  }

  /**
   * Loads favorites and resolves product availability.
   * @param {Object} [options]
   * @returns {Promise<Array>}
   */
  loadFavsWithAvailability(options = {}) {
    return this._favoritesStorage.loadFavsWithAvailability(options);
  }

  /** @returns {boolean|void} */
  addViewed(product) {
    return this._viewedStorage.addViewed(product);
  }

  /** @returns {Array|null} */
  loadViewed() {
    return this._viewedStorage.loadViewed();
  }

  clearViewed() {
    return this._viewedStorage.clearViewed();
  }
}
