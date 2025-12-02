// ProductService/ProductService.js
import { ProductFetcher } from './ProductFetcher.js';
import { ProductNormalizer } from './ProductNormalizer.js';
import { CategoriesAndBrandsCache } from './CategoriesAndBrandsCache.js';

/**
 * ProductService — фасад над вспомогательными классами:
 *  - держит состояние products / карты
 *  - предоставляет публичное API, совместимое со старым ProductService
 *  - делегирует:
 *      • сеть → ProductFetcher
 *      • нормализацию → ProductNormalizer
 *      • кэши категорий/брендов → CategoriesAndBrandsCache
 */
export class ProductService {
  /**
   * Статические текстовые сообщения для вывода пользователю
   * @type {Readonly<Record<string,string>>}
   */
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

  /**
   * @param {any} foxEngine Экземпляр движка отправки запросов
   * @param {Object} [opts]
   * @param {Object} [opts.endpoints] Переопределения имён эндпоинтов
   * @param {number} [opts.timeoutMs] Таймаут запросов в миллисекундах
   * @param {boolean} [opts.debug] Включить логирование
   */
  constructor(foxEngine, opts = {}) {
    if (!foxEngine) throw new TypeError('ProductService requires foxEngine');

    this.foxEngine = foxEngine;

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

    this.opts = { endpoints, timeoutMs, debug: Boolean(debug) };

    /** @type {Array<any>} */
    this.products = [];
    /** @type {Map<string,any>} */
    this._productMap = new Map();
    /** @type {Set<Function>} */
    this._subscribers = new Set();

    const normalizeId = (v) => (v == null ? '' : String(v).trim());

    this.cache = new CategoriesAndBrandsCache(normalizeId);
    this.fetcher = new ProductFetcher(foxEngine, {
      endpoints,
      timeoutMs,
      debug,
      msgFn: (key, vars) => this._msg(key, vars),
      logFn: (...args) => this._log(...args)
    });
    this.normalizer = new ProductNormalizer({
      cache: this.cache,
      fetcher: this.fetcher,
      normalizeId
    });
  }

  /* ---------------------- utils ---------------------- */

  _msg(key, vars = {}) {
    const pool = this.constructor?.UI_MESSAGES || {};
    const tpl = pool[key] ?? '';
    return String(tpl).replace(/\{([^}]+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
    );
  }

  _normalizeId(v) {
    if (v === undefined || v === null) return '';
    return String(v).trim();
  }

  _log(...args) {
    if (!this.opts.debug) return;
    const logger =
      typeof this.foxEngine.log === 'function'
        ? this.foxEngine.log.bind(this.foxEngine)
        : console.debug;
    try {
      logger(...args);
    } catch {
      console.debug(...args);
    }
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

  _rebuildMaps() {
    this._productMap.clear();
    this.cache.clear({ categories: true, brands: true });

    for (const p of this.products) {
      if (!p || !p.name) continue;
      const key = this._normalizeId(p.name);
      this._productMap.set(key, p);
    }

    this.cache.complementFromProducts(this.products);
  }

  /* ---------------------- products API ---------------------- */

  /**
   * Возвращает список продуктов. По умолчанию возвращает копию.
   * @param {Object} [param0]
   * @param {boolean} [param0.clone=true]
   * @returns {Array<any>}
   */
  getProducts({ clone = true } = {}) {
    return clone ? this.products.map((p) => ({ ...p })) : this.products;
  }

  /**
   * Находит продукт по нормализованному id
   * @param {any} id
   * @returns {any|null}
   */
  findById(id) {
    const sid = this._normalizeId(id);
    return sid ? this._productMap.get(sid) || null : null;
  }

  /**
   * Загружает список товаров. Можно указать force=true для принудительного обновления.
   * @param {Object} [options]
   * @param {boolean} [options.force=false]
   * @param {any} [options.request=null] Переопределение запроса
   * @returns {Promise<Array<any>>}
   */
  async loadProductsSimple({ force = false, request = null } = {}) {
    if (this.products.length && !force && !request) {
      return this.getProducts();
    }

    try {
      const rawList = await this.fetcher.fetchProducts(request);
      const normalized = [];

      for (const raw of rawList) {
        const p = await this.normalizer.normalize(raw);
        if (p && p.name) normalized.push(p);
      }

      this.products = normalized;
      this._rebuildMaps();
      this._notifySubscribers({
        type: 'set',
        changedIds: normalized.map((p) => p.name)
      });

      return this.getProducts();
    } catch (err) {
      this._log(this._msg('LOAD_PRODUCTS_ERROR'), err);
      return this.getProducts();
    }
  }

  /**
   * Загружает продукт по ID (если нет в кеше).
   * @param {any} id
   * @returns {Promise<any|null>}
   */
  async fetchById(id) {
    const sid = this._normalizeId(id);
    if (!sid) return null;

    const existing = this.findById(sid);
    if (existing) return existing;

    try {
      const raw = await this.fetcher.fetchProductById(sid);
      if (!raw) return null;

      const normalized = await this.normalizer.normalize(raw);
      if (!normalized) return null;

      this.products.push(normalized);
      this._productMap.set(normalized.name, normalized);
      this.cache.complementFromProducts([normalized]);

      this._notifySubscribers({ type: 'add', changedIds: [normalized.name] });

      return normalized;
    } catch (err) {
      this._log(this._msg('FETCH_BY_ID_ERROR'), err);
      return null;
    }
  }

  /**
   * Добавляет или обновляет продукт. Возвращает нормализованный объект.
   * @param {any} raw
   * @returns {Promise<any|null>}
   */
  async upsertProduct(raw) {
    try {
      const normalized = await this.normalizer.normalize(raw);
      if (!normalized || !normalized.name) return null;

      const existing = this.findById(normalized.name);
      if (existing) {
        Object.assign(existing, normalized);
      } else {
        this.products.push(normalized);
      }

      this._rebuildMaps();
      this._notifySubscribers({
        type: existing ? 'update' : 'add',
        changedIds: [normalized.name]
      });

      return normalized;
    } catch (err) {
      this._log(this._msg('UPSERT_ERROR'), err);
      return null;
    }
  }

  /* ---------------------- categories / brands API ---------------------- */

  /**
   * Запрашивает и обновляет список категорий.
   * @returns {Promise<Array<{name:string, fullname:string}>>}
   */
  async fetchCategories() {
    const fromCache = () =>
      Array.from(this.cache.categoriesMap.entries()).map(([name, fullname]) => ({
        name,
        fullname
      }));

    try {
      const arr = await this.fetcher.fetchList('categories');
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
        const fullname = String(c.fullname).trim() || name;
        this.cache.setCategory(name, fullname, true);
      }

      return out.length ? out : fromCache();
    } catch (err) {
      this._log(this._msg('FETCH_CATEGORIES_ERROR'), err);
      return fromCache();
    }
  }

  /**
   * Запрашивает и обновляет список брендов.
   * @returns {Promise<Array<{id:string, name:string, fullname:string}>>}
   */
  async fetchBrands() {
    const fromCache = () =>
      Array.from(this.cache.brandsMap.entries()).map(([id, name]) => ({
        id,
        name,
        fullname: name
      }));

    try {
      const arr = await this.fetcher.fetchList('brands');
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
        this.cache.setBrand(b.id, b.fullname || b.name, true);
      }

      this.cache.complementFromProducts(this.products);

      return out.length ? out : fromCache();
    } catch (err) {
      this._log('ProductService.fetchBrands failed', err);

      const map = new Map();

      for (const p of this.products) {
        const bid = this._normalizeId(p.brand);
        if (!bid) continue;

        const name = p.brandName || p.brand || bid;
        if (!map.has(bid)) map.set(bid, name);
        if (!this.cache.brandsMap.has(bid)) this.cache.setBrand(bid, name);
      }

      return Array.from(map.entries()).map(([id, name]) => ({
        id,
        name,
        fullname: name
      }));
    }
  }

  getBrandNameById(id) {
    return this.cache.getBrandNameFromCache(id, this.products);
  }

  async fetchBrandNameById(id) {
    const sid = this._normalizeId(id);
    if (!sid) return '';

    try {
      const item = await this.fetcher.fetchEntityById('brands', sid);
      if (!item) return '';

      const bid = this._normalizeId(item.name) || sid;
      const fullname =
        String(item.fullname).trim() ||
        String(item.name).trim() ||
        bid;

      this.cache.setBrand(bid, fullname, true);
      return fullname;
    } catch (err) {
      this._log('ProductService.fetchBrandNameById failed', err);
      return this.getBrandNameById(sid);
    }
  }

  getCatNameById(id) {
    return this.cache.getCategoryNameFromCache(id, this.products);
  }

  async fetchCatById(id) {
    const sid = this._normalizeId(id);
    if (!sid) return '';

    try {
      const item = await this.fetcher.fetchEntityById('categories', sid);
      if (!item) return '';

      const cid = this._normalizeId(item.name) || sid;
      const fullname = String(item.fullname).trim() || cid;

      this.cache.setCategory(cid, fullname, true);
      return fullname;
    } catch (err) {
      this._log('ProductService.fetchCatById failed', err);
      return this.getCatNameById(sid);
    }
  }

  /* ---------------------- fill select generic ---------------------- */

  /**
   * Универсальный наполнитель <select> на основе списка сущностей и данных из products.
   * Логика почти 1:1 со старой реализацией.
   *
   * @param {HTMLElement|string|null} selectEl
   * @param {Object} param1
   * @param {string} param1.entity (например, 'categories' или 'brands')
   * @param {string} param1.productProp (например, 'category' или 'brand')
   * @param {boolean} [param1.includeAllOption=true]
   * @param {boolean} [param1.onlyFromProducts=false]
   * @param {boolean} [param1.sort=true]
   * @param {string} [param1.allMsgKey='ALL_CATEGORIES_OPTION']
   * @param {string} [param1.selected='']
   * @returns {Promise<boolean>}
   */
  async fillSelect(
    selectEl,
    {
      entity,
      productProp,
      includeAllOption = true,
      onlyFromProducts = false,
      sort = true,
      allMsgKey = 'ALL_CATEGORIES_OPTION',
      selected = ''
    } = {}
  ) {
    if (typeof selectEl === 'string') {
      selectEl = document.querySelector(selectEl);
    }
    if (!selectEl) return false;

    const slug = (str) => String(str).toLowerCase().replace(/\s+/g, '');
    const collected = new Map();

    const add = (id, name, fullname) => {
      const safeName =
        name && name.toLowerCase() !== 'undefined' ? name : '';
      const safeFullname =
        fullname && fullname.toLowerCase() !== 'undefined'
          ? fullname
          : '';
      const human = safeFullname || safeName || id;
      if (!human) return;

      const key = slug(human);
      const entry = collected.get(key) || {
        id: '',
        name: '',
        fullname: ''
      };

      if (!entry.id && id) entry.id = id;
      if (!entry.name && safeName) entry.name = safeName;
      if (!entry.fullname && safeFullname) entry.fullname = safeFullname;

      collected.set(key, entry);
    };

    if (!onlyFromProducts) {
      const list = await this.fetcher.fetchList(entity).catch((e) => {
        this._log(this._msg('FILL_CATEGORIES_WARN'), e);
        return [];
      });

      for (const item of list) {
        if (!item) continue;

        if (typeof item === 'string') {
          const id = this._normalizeId(item);
          add(id, item, item);
        } else {
          const id = this._normalizeId(
            item.id ?? item.name ?? item.key ?? ''
          );
          const name = String(item.name ?? '').trim();
          const fullname = String(
            item.fullname ?? item.title ?? name
          ).trim();
          add(id, name, fullname);
        }
      }
    }

    for (const p of this.products) {
      const id = this._normalizeId(p[productProp]);
      const name =
        p[`${productProp}Name`] != null
          ? String(p[`${productProp}Name`]).trim()
          : '';
      const fullname =
        p[`${productProp}Fullname`] != null
          ? String(p[`${productProp}Fullname`]).trim()
          : '';

      add(id, name, fullname);

      if (entity === 'brands') {
        const nm =
          fullname && fullname.toLowerCase() !== 'undefined'
            ? fullname
            : name;
        if (id && nm) this.cache.setBrand(id, nm, true);
      }

      if (entity === 'categories') {
        const nm =
          fullname && fullname.toLowerCase() !== 'undefined'
            ? fullname
            : name;
        if (id && nm) this.cache.setCategory(id, nm, true);
      }
    }

    let rows = Array.from(collected.values());

    if (sort) {
      rows.sort((a, b) =>
        String(a.fullname || a.name).localeCompare(
          String(b.fullname || b.name)
        )
      );
    }

    selectEl.innerHTML = '';

    if (includeAllOption) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = this._msg(allMsgKey);
      selectEl.appendChild(opt);
    }

    for (const row of rows) {
      const opt = document.createElement('option');
      opt.value = row.id || row.name;
      opt.textContent = row.fullname || row.name || row.id;

      if (selected && String(selected) === opt.value) {
        opt.selected = true;
      }

      if (row.id) opt.dataset.id = row.id;
      if (row.fullname) opt.dataset.fullname = row.fullname;
      if (row.name) opt.dataset.name = row.name;

      selectEl.appendChild(opt);
    }

    return true;
  }

  /**
   * Упрощённые обёртки под старое API.
   */
  async fillCategories(selectEl, opts = {}) {
    return this.fillSelect(
      selectEl,
      Object.assign(
        {
          entity: 'categories',
          productProp: 'category',
          allMsgKey: 'ALL_CATEGORIES_OPTION'
        },
        opts
      )
    );
  }

  async fillBrands(selectEl, opts = {}) {
    return this.fillSelect(
      selectEl,
      Object.assign(
        {
          entity: 'brands',
          productProp: 'brand',
          allMsgKey: 'ALL_BRANDS_OPTION'
        },
        opts
      )
    );
  }

  /* ---------------------- misc ---------------------- */

  /**
   * Подписывается на изменения. Возвращает функцию для отписки.
   * @param {Function} fn
   * @returns {Function}
   */
  subscribe(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError(this._msg('SUBSCRIBE_ARG_ERROR'));
    }
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  /**
   * Очищает кеши продуктов, категорий или брендов.
   * @param {Object} param0
   * @param {boolean} [param0.products=false]
   * @param {boolean} [param0.categories=false]
   * @param {boolean} [param0.brands=false]
   */
  clearCache({ products = false, categories = false, brands = false } = {}) {
    if (products) {
      this.products = [];
      this._productMap.clear();
    }
    this.cache.clear({ categories, brands });
  }
}