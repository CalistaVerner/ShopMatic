export class CategoriesAndBrandsCache {
  constructor(normalizeId) {
    this._normalizeId = typeof normalizeId === 'function'
      ? normalizeId
      : (v) => (v == null ? '' : String(v).trim());

    this._categoriesMap = new Map();
    this._brandsMap = new Map();
  }

  get categoriesMap() {
    return this._categoriesMap;
  }

  get brandsMap() {
    return this._brandsMap;
  }

  clear({ categories = false, brands = false } = {}) {
    if (categories) this._categoriesMap.clear();
    if (brands) this._brandsMap.clear();
  }

  _set(map, id, name, overwrite = false) {
    const key = this._normalizeId(id);
    const value = String(name || '').trim();
    if (key && value && (overwrite || !map.has(key))) {
      map.set(key, value);
    }
  }

  setCategory(id, name, overwrite = false) {
    this._set(this._categoriesMap, id, name, overwrite);
  }

  setBrand(id, name, overwrite = false) {
    this._set(this._brandsMap, id, name, overwrite);
  }

  complementFromProducts(products = []) {
    for (const p of products) {
      if (p?.category) {
        this.setCategory(p.category, p.categoryName || p.category);
      }
      if (p?.brand) {
        this.setBrand(p.brand, p.brandName || p.brand);
      }
    }
  }

  getBrandNameFromCache(id, products = []) {
    const sid = this._normalizeId(id);
    if (!sid) return '';
    if (this._brandsMap.has(sid)) return this._brandsMap.get(sid);

    for (const p of products) {
      if (p?.brand && this._normalizeId(p.brand) === sid) {
        const nm = p.brandName || p.brand;
        this.setBrand(sid, nm);
        return nm;
      }
    }
    return '';
  }

  getCategoryNameFromCache(id, products = []) {
    const sid = this._normalizeId(id);
    if (!sid) return '';
    if (this._categoriesMap.has(sid)) return this._categoriesMap.get(sid);

    for (const p of products) {
      if (p?.category && this._normalizeId(p.category) === sid) {
        const nm = p.categoryName || p.category;
        this.setCategory(sid, nm);
        return nm;
      }
    }
    return '';
  }
}
