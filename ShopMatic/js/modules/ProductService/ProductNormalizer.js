// ProductService/ProductNormalizer.js

export class ProductNormalizer {
  /**
   * @param {ProductCache} cache
   * @param {ProductBackend} backend
   */
  constructor(cache, backend) {
    this.cache = cache;
    this.backend = backend;
  }

  _normalizeId(v) {
    if (v === undefined || v === null) return '';
    return String(v).trim();
  }

  _parseCategory(raw) {
    const rawCat = raw.category ?? raw.cat ?? raw.categoryId ?? '';
    const key = this._normalizeId(rawCat);
    const name = String(raw.categoryName ?? raw.categoryFullname ?? '').trim();
    return { key, name };
  }

  _parseBrand(raw) {
    let rawBrand = raw.brand ?? raw.brandId ?? '';
    if (typeof rawBrand === 'object') {
      rawBrand = rawBrand.id ?? rawBrand.key ?? rawBrand.name ?? '';
    }
    const key = this._normalizeId(rawBrand);
    const name = String(raw.brandName ?? raw.brandFullname ?? '').trim();
    return { key, name };
  }

  async _fetchBrandNameById(id) {
    const sid = this._normalizeId(id);
    if (!sid) return '';
    try {
      const item = await this.backend.fetchEntityById('brands', sid);
      if (!item) return '';
      const bid = this._normalizeId(item.name) || sid;
      const fullname = String(item.fullname || '').trim() || bid;
      this.cache.brandsMap.set(bid, fullname);
      return fullname;
    } catch {
      return this.cache.getBrandNameById(sid);
    }
  }

  async _fetchCategoryNameById(id) {
    const sid = this._normalizeId(id);
    if (!sid) return '';
    try {
      const item = await this.backend.fetchEntityById('categories', sid);
      if (!item) return '';
      const cid = this._normalizeId(item.name) || sid;
      const fullname = String(item.fullname || '').trim() || cid;
      this.cache.categoriesMap.set(cid, fullname);
      return fullname;
    } catch {
      return this.cache.getCategoryNameById(sid);
    }
  }

  async _resolveBrandAndCategoryNames(categoryKey, brandKey, fallbackCategory = '', fallbackBrand = '') {
    const ensureBrandName = async () => {
      if (!brandKey) return '';
      // сначала пытаемся из кеша
      const fromCache = this.cache.getBrandNameById(brandKey);
      if (fromCache) return fromCache;
      return this._fetchBrandNameById(brandKey);
    };

    const ensureCatName = async () => {
      if (!categoryKey) return '';
      const fromCache = this.cache.getCategoryNameById(categoryKey);
      if (fromCache) return fromCache;
      return this._fetchCategoryNameById(categoryKey);
    };

    const [brandNameResolved, catNameResolved] = await Promise.all([
      ensureBrandName(),
      ensureCatName()
    ]);

    const finalBrandName = fallbackBrand || brandNameResolved || brandKey;
    const finalCatName = fallbackCategory || catNameResolved || categoryKey;
    return [finalCatName, finalBrandName];
  }

  /**
   * Нормализует одну запись продукта.
   * @param {any} raw
   * @returns {Promise<Object|null>}
   */
  async normalizeProduct(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const name = this._normalizeId(
      raw.name ?? raw.id ?? raw.title ?? raw.fullname ?? raw.sku
    );
    if (!name) return null;

    const title = String(raw.fullname ?? raw.title ?? raw.name ?? '').trim();
    const price = Number(raw.price ?? raw.cost ?? 0);
    const oldPrice = Number(raw.oldPrice ?? raw.price_old ?? 0);
    const stock = Number(raw.stock ?? raw.count ?? raw.qty ?? 0);
    const picture = String(
      raw.picture ?? raw.image ?? raw.img ?? '/assets/no-image.png'
    );

    const { key: categoryKey, name: categoryNameInput } = this._parseCategory(raw);
    const { key: brandKey, name: brandNameInput } = this._parseBrand(raw);

    const [resolvedCatName, resolvedBrandName] = await this._resolveBrandAndCategoryNames(
      categoryKey,
      brandKey,
      categoryNameInput,
      brandNameInput
    );

    if (categoryKey && resolvedCatName) {
      this.cache._setCache(this.cache.categoriesMap, categoryKey, resolvedCatName);
    }
    if (brandKey && resolvedBrandName) {
      this.cache._setCache(this.cache.brandsMap, brandKey, resolvedBrandName);
    }

    return {
      _raw: raw,
      name,
      fullname: title,
      title,
      price,
      oldPrice,
      stock,
      picture,
      category: categoryKey,
      categoryName: resolvedCatName,
      brand: brandKey,
      brandName: resolvedBrandName,
      short: raw.short ?? raw.description ?? '',
      specs: raw.specs ?? raw.properties ?? raw.attributes ?? {}
    };
  }
}
