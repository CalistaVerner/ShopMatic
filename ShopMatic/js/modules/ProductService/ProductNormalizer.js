export class ProductNormalizer {
  constructor({ cache, fetcher, normalizeId } = {}) {
    if (!cache) throw new TypeError('ProductNormalizer requires cache');
    this.cache = cache;
    this.fetcher = fetcher || null;
    this._normalizeId = typeof normalizeId === 'function'
      ? normalizeId
      : (v) => (v == null ? '' : String(v).trim());
  }

  _parseCategory(raw) {
    const rawCat = raw.category ?? raw.cat ?? raw.categoryId ?? '';
    const key = this._normalizeId(rawCat);
    return { key, name: String(raw.categoryName ?? raw.categoryFullname ?? '').trim() };
  }

  _parseBrand(raw) {
    let rawBrand = raw.brand ?? raw.brandId ?? '';
    if (typeof rawBrand === 'object') rawBrand = rawBrand.id ?? rawBrand.key ?? rawBrand.name ?? '';
    const key = this._normalizeId(rawBrand);
    return { key, name: String(raw.brandName ?? raw.brandFullname ?? '').trim() };
  }

  async _resolveBrandAndCategoryNames(categoryKey, brandKey, fallbackCategory = '', fallbackBrand = '') {
    const resolveName = async (key, type, fallback) => {
      if (!key) return fallback;
      const cached = type === 'brand' ? this.cache.getBrandNameFromCache(key) : this.cache.getCategoryNameFromCache(key);
      if (cached) return cached;
      if (!this.fetcher) return fallback;

      const item = await this.fetcher.fetchEntityById(type, key).catch(() => null);
      if (!item) return fallback;
      const id = this._normalizeId(item.name ?? item.id ?? item.key ?? '');
      const name = String(item.fullname ?? item.name ?? item.title ?? id).trim() || id;
      type === 'brand' ? this.cache.setBrand(id, name, true) : this.cache.setCategory(id, name, true);
      return name;
    };

    const [resolvedBrandName, resolvedCatName] = await Promise.all([
      resolveName(brandKey, 'brand', fallbackBrand),
      resolveName(categoryKey, 'category', fallbackCategory)
    ]);

    return [resolvedCatName || categoryKey, resolvedBrandName || brandKey];
  }

  async normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const name = this._normalizeId(raw.name ?? raw.id ?? raw.title ?? raw.fullname ?? raw.sku);
    if (!name) return null;

    const title = String(raw.fullname ?? raw.title ?? raw.name ?? '').trim();
    const price = Number(raw.price ?? raw.cost ?? 0);
    const oldPrice = Number(raw.oldPrice ?? raw.price_old ?? 0);
    const stock = Number(raw.stock ?? raw.count ?? raw.qty ?? 0);
    const picture = String(raw.picture ?? raw.image ?? raw.img ?? '/assets/no-image.png');

    const { key: categoryKey, name: categoryNameInput } = this._parseCategory(raw);
    const { key: brandKey, name: brandNameInput } = this._parseBrand(raw);

    const [resolvedCatName, resolvedBrandName] =
      await this._resolveBrandAndCategoryNames(categoryKey, brandKey, categoryNameInput, brandNameInput);

    if (categoryKey && resolvedCatName) this.cache.setCategory(categoryKey, resolvedCatName);
    if (brandKey && resolvedBrandName) this.cache.setBrand(brandKey, resolvedBrandName);

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
