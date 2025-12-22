// StorageService/storageType/CartStorage.js

import { LocalStorageAdapter } from './LocalStorageAdapter.js';
import { AvailabilityLoader } from '../AvailabilityLoader.js';

/**
 * Хранилище корзины.
 * Наследует LocalStorageAdapter → BaseStorage.
 */
export class CartStorage extends LocalStorageAdapter {
  /**
   * @param {Object} deps
   * @param {AvailabilityLoader} deps.availabilityLoader
   * @param {string} [deps.storageKey]
   */
  constructor({ availabilityLoader, storageKey = 'gribkov_cart_v1' } = {}) {
    super();
    this.availabilityLoader = availabilityLoader;
    this.storageKey = storageKey;
  }

  _normalizeCartItem(input = {}) {
    return {
      name: String(input.name ?? ''),
      fullname: input.fullname ?? '',
      price: Number(input.price ?? 0),
      qty: Number(input.qty ?? 0),
      picture: input.picture ?? '',
      stock: Number(input.stock ?? 0),
      specs: input.specs ?? {}
    };
  }

  saveCart(cartArr) {
    try {
      const normalized = (Array.isArray(cartArr) ? cartArr : []).map((i) =>
        this._normalizeCartItem(i)
      );
      // используем методы базового класса
      return this.setJSON(this.storageKey, normalized);
    } catch (e) {
      console.warn('CartStorage.saveCart error', e);
      return false;
    }
  }

  loadCart() {
    return this.getJSON(this.storageKey, { arrayOnly: true });
  }

  async loadCartWithAvailability(options = {}) {
    const rawCart = this.loadCart();
    if (!Array.isArray(rawCart) || rawCart.length === 0) return rawCart || [];
    return this.availabilityLoader.loadWithAvailability(rawCart, options);
  }
}
