// ProductService/ProductCache.js

export class ProductCache {
  constructor() {
    /** @type {Array<any>} */
    this.products = [];
    /** @type {Map<string,any>} */
    this.productMap = new Map();
    /** @type {Map<string,string>} */
    this.categoriesMap = new Map();
    /** @type {Map<string,string>} */
    this.brandsMap = new Map();
  }

  _normalizeId(v) {
    if (v === undefined || v === null) return '';
    return String(v).trim();
  }

  _setCache(map, key, value, overwrite = false) {
    if (!key) return;
    if (overwrite || !map.has(key)) map.set(key, value);
  }

  /** Полная перестройка карт по текущему products */
  rebuildMaps() {
    this.productMap.clear();
    // не чистим brandsMap/categoriesMap полностью — они могут быть наполнены отдельно
    for (const p of this.products) {
      if (!p || !p.name) continue;
      const key = this._normalizeId(p.name);
      this.productMap.set(key, p);
      if (p.brand) this._setCache(this.brandsMap, p.brand, p.brandName || p.brand);
      if (p.category) this._setCache(this.categoriesMap, p.category, p.categoryName || p.category);
    }
  }

  getProducts({ clone = true } = {}) {
    return clone ? this.products.map((p) => ({ ...p })) : this.products;
  }

  findById(id) {
    const sid = this._normalizeId(id);
    return sid ? this.productMap.get(sid) || null : null;
  }

  setProducts(normalizedArray) {
    this.products = Array.isArray(normalizedArray) ? normalizedArray : [];
    this.rebuildMaps();
  }

  upsertProduct(normalized) {
    if (!normalized || !normalized.name) return null;
    const key = this._normalizeId(normalized.name);
    const existing = this.productMap.get(key);
    if (existing) {
      Object.assign(existing, normalized);
      this.productMap.set(key, existing);
      this._setCache(this.categoriesMap, existing.category, existing.categoryName || existing.category);
      this._setCache(this.brandsMap, existing.brand, existing.brandName || existing.brand);
      return existing;
    }
    this.products.push(normalized);
    this.productMap.set(key, normalized);
    this._setCache(this.categoriesMap, normalized.category, normalized.categoryName || normalized.category);
    this._setCache(this.brandsMap, normalized.brand, normalized.brandName || normalized.brand);
    return normalized;
  }

  getBrandNameById(id) {
    const sid = this._normalizeId(id);
    if (!sid) return '';
    if (this.brandsMap.has(sid)) return this.brandsMap.get(sid);
    // попытка вытащить из products
    for (const p of this.products) {
      const bid = this._normalizeId(p.brand);
      if (bid === sid) {
        const nm = p.brandName || p.brand || bid;
        this.brandsMap.set(sid, nm);
        return nm;
      }
    }
    return '';
  }

  getCategoryNameById(id) {
    const sid = this._normalizeId(id);
    if (!sid) return '';
    if (this.categoriesMap.has(sid)) return this.categoriesMap.get(sid);
    for (const p of this.products) {
      const cid = this._normalizeId(p.category);
      if (cid === sid) {
        const nm = p.categoryName || cid;
        this.categoriesMap.set(sid, nm);
        return nm;
      }
    }
    return '';
  }

  clearCache({ products = false, categories = false, brands = false } = {}) {
    if (products) {
      this.products = [];
      this.productMap.clear();
    }
    if (categories) this.categoriesMap.clear();
    if (brands) this.brandsMap.clear();
  }
}
