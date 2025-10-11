// shopmatic/StorageService.js
export class StorageService {
  constructor(opts = {}) {
    this.storageKey = opts.storageKey || 'gribkov_cart_v1';
    this.favStorageKey = opts.favStorageKey || 'gribkov_favs_v1';
  }

  saveCart(cartArr) {
    try {
      const out = (Array.isArray(cartArr) ? cartArr : []).map(i => ({
        name: String(i.name || ''),
        fullname: i.fullname || '',
        price: Number(i.price || 0),
        qty: Number(i.qty || 0),
        picture: i.picture || '',
        stock: Number(i.stock || 0),
        specs: i.specs || {}
      }));
      localStorage.setItem(this.storageKey, JSON.stringify(out));
    } catch (e) {
      console.warn('StorageService.saveCart error', e);
    }
  }

  loadCart() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return parsed;
    } catch (e) {
      console.warn('StorageService.loadCart error', e);
      return null;
    }
  }

  saveFavs(setLike) {
    try {
      localStorage.setItem(this.favStorageKey, JSON.stringify(Array.from(setLike || [])));
    } catch (e) {
      console.warn('StorageService.saveFavs error', e);
    }
  }

  loadFavs() {
    try {
      const raw = localStorage.getItem(this.favStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return parsed;
    } catch (e) {
      console.warn('StorageService.loadFavs error', e);
      return null;
    }
  }
}
