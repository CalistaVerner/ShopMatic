// ProductService/index.js
// import { escapeHtml as _escapeHtml } from '../utils.js'  // можно удалить, не используется

import { ProductBackend } from './ProductBackend.js';
import { ProductCache } from './ProductCache.js';
import { ProductNormalizer } from './ProductNormalizer.js';
import { SelectFiller } from './SelectFiller.js';

export class ProductService {
  static UI_MESSAGES = Object.freeze({
    ERROR_NO_ENGINE: 'Интеграция с бекендом недоступна',
    ERROR_TIMEOUT: 'Запрос продукта превысил время ожидания',
    LOAD_PRODUCTS_ERROR: 'Ошибка загрузки списка товаров',
    FETCH_BY_ID_ERROR: 'Ошибка получения данных товара',
    FETCH_CATEGORIES_ERROR: 'Ошибка получения категорий',
    FILL_CATEGORIES_WARN: 'ProductService.fillCategories: ошибка при заполнении select',
    ALL_CATEGORIES_OPTION: 'Все категории',
    ALL_BRANDS_OPTION: 'Все бренды',
    SUBSCRIBE_ARG_ERROR: 'subscribe ожидает функцию',
    UPSERT_ERROR: 'Ошибка добавления/обновления товара'
  });

  constructor(foxEngine, opts = {}) {
    if (!foxEngine) throw new TypeError('ProductService requires foxEngine');

    const {
      endpoints = {
        products: 'getProducts',
        productById: 'getProduct',
        categories: 'getCategories',
        brands: 'getBrands'
      },
      timeoutMs = 7000,
      debug = false
    } = opts;

    this.opts = { endpoints, timeoutMs, debug };

    this._subscribers = new Set();

    // логгер, который учитывает debug
    this._log = (...args) => {
      if (!this.opts.debug) return;
      const engineLogger =
        typeof foxEngine.log === 'function'
          ? foxEngine.log.bind(foxEngine)
          : console.debug;
      try {
        engineLogger(...args);
      } catch {
        console.debug(...args);
      }
    };

    this.backend = new ProductBackend(foxEngine, this.opts, this._log);
    this.cache = new ProductCache();
    this.normalizer = new ProductNormalizer(this.cache, this.backend);
    this.selectFiller = new SelectFiller(this.backend, this.cache, (k, vars) =>
      this._msg(k, vars)
    );

    // короткий алиас, чтобы совместимость с твоим кодом сохранить:
    Object.defineProperty(this, 'products', {
      get: () => this.cache.products,
      set: (v) => {
        this.cache.products = v;
        this.cache.rebuildMaps();
      }
    });
    this._productMap = this.cache.productMap;
    this._categoriesMap = this.cache.categoriesMap;
    this._brandsMap = this.cache.brandsMap;
  }

  /* ------------ helpers (msg, id, notify) ------------ */

  _msg(key, vars = {}) {
    const tpl =
      (this.constructor &&
        this.constructor.UI_MESSAGES &&
        this.constructor.UI_MESSAGES[key]) ||
      '';
    return String(tpl).replace(/\{([^}]+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
    );
  }

  _normalizeId(v) {
    if (v === undefined || v === null) return '';
    return String(v).trim();
  }

  _notifySubscribers(change = { type: 'set', changedIds: [] }) {
    for (const fn of this._subscribers) {
      try {
        fn(change);
      } catch (e) {
        this._log('subscriber error', e);
      }
    }
  }

  /* ------------ public products API ------------ */

  getProducts({ clone = true } = {}) {
    return this.cache.getProducts({ clone });
  }

  findById(id) {
    return this.cache.findById(id);
  }

  async loadProductsSimple({ force = false, request = null } = {}) {
    // if (this.products.length && !force && !request) return this.getProducts();

    const defaultEndpoint = this.opts.endpoints.products;
    let endpoint = defaultEndpoint;
    let payload = { sysRequest: endpoint };

    if (request) {
      if (typeof request === 'string') {
        endpoint = request;
        payload.sysRequest = endpoint;
      } else {
        const {
          endpoint: reqEndpoint,
          sysRequest: reqSys,
          payload: reqPayload,
          params: reqParams,
          ...extra
        } = request;
        endpoint = reqEndpoint ?? reqSys ?? defaultEndpoint;
        payload = Object.assign(
          {},
          reqParams ?? {},
          reqPayload ?? {},
          extra ?? {},
          { sysRequest: endpoint }
        );
      }
    }

    try {
      const res = await this.backend.safeCall(payload, 'JSON');
      const items = this.backend.extractArray(res, ['items', 'products', 'data']);
      const normalized = await Promise.all(
        items
          .map((i) => this.normalizer.normalizeProduct(i))
          .filter(Boolean)
      );
      this.cache.setProducts(normalized);

      // ensure simple maps заполнены
      for (const p of this.cache.products) {
        if (p.category) {
          this.cache._setCache(
            this.cache.categoriesMap,
            p.category,
            p.categoryName || p.category
          );
        }
        if (p.brand) {
          this.cache._setCache(
            this.cache.brandsMap,
            p.brand,
            p.brandName || p.brand
          );
        }
      }

      this._notifySubscribers({
        type: 'reload',
        changedIds: this.cache.products.map((p) => p.name)
      });

      return this.getProducts();
    } catch (err) {
      this._log(this._msg('LOAD_PRODUCTS_ERROR'), err);
      // оставляем старый кэш
      this.cache.rebuildMaps();
      return this.getProducts();
    }
  }

  async fetchById(id) {
    const sid = this._normalizeId(id);
    if (!sid) return null;

    const existing = this.findById(sid);
    if (existing) return existing;

    const endpoint = this.opts.endpoints.productById;
    try {
      const res = await this.backend.safeCall(
        { sysRequest: endpoint, id: sid },
        'JSON'
      );
      const items = this.backend.extractArray(res, [
        'product',
        'items',
        'products',
        'data'
      ]);
      const raw = items.length ? items[0] : res.product ?? res;
      if (!raw) return null;

      const normalized = await this.normalizer.normalizeProduct(raw);
      if (!normalized) return null;

      const upserted = this.cache.upsertProduct(normalized);

      this._notifySubscribers({ type: 'add', changedIds: [upserted.name] });
      return upserted;
    } catch (err) {
      this._log(this._msg('FETCH_BY_ID_ERROR'), err);
      return null;
    }
  }

  
  /**
   * Ensure base product list is loaded (best-effort).
   * @returns {Promise<boolean>}
   */
  async ensureWarm() {
    try {
      const existing = this.getProducts({ clone: false }) || [];
      if (Array.isArray(existing) && existing.length) return true;
      await this.loadProductsSimple({ force: false });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensures that products for given ids exist in cache.
   * Best-effort: does not throw.
   *
   * @param {string[]} ids
   * @param {{concurrency?: number}} [opts]
   * @returns {Promise<void>}
   */
  async ensureProductsByIds(ids = [], opts = {}) {
    const list = Array.isArray(ids) ? ids : [];
    const uniq = [];
    const seen = new Set();

    for (const v of list) {
      const sid = this._normalizeId(v);
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);
      // already in cache
      if (this.findById(sid)) continue;
      uniq.push(sid);
    }

    if (!uniq.length) return;

    const concurrency = Math.max(1, Math.min(8, Number(opts?.concurrency) || 4));
    let idx = 0;

    const worker = async () => {
      while (idx < uniq.length) {
        const cur = uniq[idx++];
        try {
          await this.fetchById(cur);
        } catch {
          // ignore
        }
      }
    };

    const workers = [];
    for (let i = 0; i < concurrency; i++) workers.push(worker());
    await Promise.allSettled(workers);
  }


  async setProducts(rawProducts = []) {
    const arr = Array.isArray(rawProducts) ? rawProducts : [];
    try {
      const normalized = await Promise.all(
        arr.map((r) => this.normalizer.normalizeProduct(r)).filter(Boolean)
      );
      this.cache.setProducts(normalized);

      for (const p of this.cache.products) {
        if (p.category) {
          this.cache._setCache(
            this.cache.categoriesMap,
            p.category,
            p.categoryName || p.category
          );
        }
        if (p.brand) {
          this.cache._setCache(
            this.cache.brandsMap,
            p.brand,
            p.brandName || p.brand
          );
        }
      }

      this._notifySubscribers({
        type: 'set',
        changedIds: this.cache.products.map((p) => p.name)
      });
      return true;
    } catch (err) {
      this._log(this._msg('LOAD_PRODUCTS_ERROR'), err);
      return false;
    }
  }

  /* ------------ categories / brands ------------ */

  async fetchCategories() {
    try {
      const arr = await this.backend.fetchList('categories');
      const out = arr
        .map((c) => {
          if (!c) return null;
          if (typeof c === 'string') return { name: c, fullname: c };
          return {
            name: c.name ?? c.id ?? '',
            fullname: c.fullname ?? c.name ?? c.title ?? ''
          };
        })
        .filter(Boolean);

      for (const c of out) {
        const name = String(c.name).trim();
        const fullname = String(c.fullname || name).trim();
        this.cache._setCache(this.cache.categoriesMap, name, fullname, false);
      }

      if (out.length) return out;
      return Array.from(this.cache.categoriesMap.entries()).map(
        ([name, fullname]) => ({ name, fullname })
      );
    } catch (err) {
      this._log(this._msg('FETCH_CATEGORIES_ERROR'), err);
      return Array.from(this.cache.categoriesMap.entries()).map(
        ([name, fullname]) => ({ name, fullname })
      );
    }
  }

  async fetchBrands() {
    try {
      const arr = await this.backend.fetchList('brands');
      const out = arr
        .map((b) => {
          if (!b) return null;
          if (typeof b === 'string') {
            const id = this._normalizeId(b);
            return { id, name: b, fullname: b };
          }
          const id = this._normalizeId(b.id ?? b.key ?? b.name ?? '');
          if (!id) return null;
          const name = String(
            b.name ?? b.fullname ?? b.title ?? b.label ?? id
          ).trim();
          const fullname = String(b.fullname ?? name).trim() || name || id;
          return { id, name, fullname };
        })
        .filter(Boolean);

      for (const b of out) {
        this.cache._setCache(
          this.cache.brandsMap,
          b.id,
          b.fullname || b.name,
          false
        );
      }

      // дополним брендами из products
      for (const p of this.cache.products) {
        const bid = this._normalizeId(p.brand);
        if (!bid) continue;
        const name = p.brandName || p.brand || bid;
        if (!this.cache.brandsMap.has(bid)) {
          this.cache.brandsMap.set(bid, name);
        }
      }

      if (out.length) return out;
      return Array.from(this.cache.brandsMap.entries()).map(
        ([id, fullname]) => ({ id, name: fullname, fullname })
      );
    } catch (err) {
      this._log('ProductService.fetchBrands failed', err);

      const map = new Map();
      for (const p of this.cache.products) {
        const bid = this._normalizeId(p.brand);
        if (!bid) continue;
        const name = p.brandName || p.brand || bid;
        if (!map.has(bid)) map.set(bid, name);
        if (!this.cache.brandsMap.has(bid)) {
          this.cache.brandsMap.set(bid, name);
        }
      }

      return Array.from(map.entries()).map(([id, name]) => ({
        id,
        name,
        fullname: name
      }));
    }
  }

  getBrandNameById(id) {
    return this.cache.getBrandNameById(id);
  }

  async fetchBrandNameById(id) {
    return this.normalizer._fetchBrandNameById(id);
  }

  getCatNameById(id) {
    return this.cache.getCategoryNameById(id);
  }

  async fetchCatById(id) {
    return this.normalizer._fetchCategoryNameById(id);
  }

  /* ------------ select helpers ------------ */

  async _fillSelectGeneric(el, opts) {
    return this.selectFiller.fillSelectGeneric(el, opts);
  }

  async fillCategories(selectEl, opts = {}) {
    return this.selectFiller.fillCategories(selectEl, opts);
  }

  async fillBrands(selectEl, opts = {}) {
    return this.selectFiller.fillBrands(selectEl, opts);
  }

  /* ------------ misc ------------ */

  subscribe(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError(this._msg('SUBSCRIBE_ARG_ERROR'));
    }
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  async upsertProduct(raw) {
    try {
      const normalized = await this.normalizer.normalizeProduct(raw);
      const upserted = this.cache.upsertProduct(normalized);
      if (!upserted) return null;

      const type = this.cache.products.includes(upserted) ? 'update' : 'add';
      this._notifySubscribers({ type, changedIds: [upserted.name] });
      return upserted;
    } catch (err) {
      this._log(this._msg('UPSERT_ERROR'), err);
      return null;
    }
  }

  _dispatchLocalStorageEvent(key, oldValue, newValue) {
    const ev = new StorageEvent('storage', {
      key,
      oldValue,
      newValue,
      url: location.href,
      storageArea: localStorage
    });
    window.dispatchEvent(ev);
  }

  clearCache(opts = {}) {
    this.cache.clearCache(opts);
  }
}
