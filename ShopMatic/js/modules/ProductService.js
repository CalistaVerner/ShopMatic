// shopmatic/ProductService.js
import { escapeHtml } from './utils.js';

export class ProductService {
  /**
   * @param {object} foxEngine - интеграция с бекендом (объект с методом sendPostAndGetAnswer)
   * @param {object} opts
   *   - endpoints: { products: 'getProducts', categories: 'getCategories', productById: 'getProduct' }
   *   - timeoutMs: number
   */
  constructor(foxEngine, opts = {}) {
    this.foxEngine = foxEngine || null;
    this.opts = Object.assign({
      endpoints: {
        products: 'getProducts',
        categories: 'getCategories',
        productById: 'getProduct'
      },
      timeoutMs: 7000
    }, opts);

    // internal storage
    this.products = [];        // array of normalized product objects
    this._productMap = new Map(); // name/id -> product (normalized)
    this._subscribers = new Set();
  }

  /* ================== helpers ================== */

  _normalizeId(id) {
    if (id === undefined || id === null) return '';
    return String(id).trim();
  }

  _safeLog(...args) {
    if (this.foxEngine && typeof this.foxEngine.log === 'function') {
      try { this.foxEngine.log(...args); } catch (e) { /* ignore */ }
    } else {
      // keep console.warn but not noisy
      // console.warn(...args);
    }
  }

  async _safeCall(actionPayload = {}, expect = 'JSON') {
    // Wrap foxEngine.sendPostAndGetAnswer with safe checks and timeout
    if (!this.foxEngine || typeof this.foxEngine.sendPostAndGetAnswer !== 'function') {
      throw new Error('foxEngine.sendPostAndGetAnswer is not available');
    }
    const callPromise = this.foxEngine.sendPostAndGetAnswer(actionPayload, expect);
    if (!this.opts.timeoutMs || this.opts.timeoutMs <= 0) return callPromise;
    const timeoutMs = Number(this.opts.timeoutMs) || 7000;
    return Promise.race([
      callPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('ProductService: request timeout')), timeoutMs))
    ]);
  }

  _normalizeProduct(raw) {
    if (!raw || typeof raw !== 'object') return null;
    // try common fields
    const name = this._normalizeId(raw.name ?? raw.id ?? raw.title ?? raw.fullname ?? '');
    const title = String(raw.fullname ?? raw.title ?? raw.name ?? '').trim();
    const price = Number(raw.price ?? raw.cost ?? 0) || 0;
    const oldPrice = Number(raw.oldPrice ?? raw.price_old ?? 0) || 0;
    const stock = Number(raw.stock ?? raw.count ?? raw.qty ?? 0) || 0;
    const picture = String(raw.picture ?? raw.image ?? raw.img ?? '/assets/no-image.png') || '/assets/no-image.png';
    const category = raw.category ?? raw.cat ?? '';
    const short = raw.short ?? raw.description ?? '';
    const specs = raw.specs ?? raw.properties ?? raw.attributes ?? {};

    const normalized = {
      // keep original data under _raw for debugging if needed
      _raw: raw,
      // canonical fields
      name,
      fullname: title,
      title,
      price,
      oldPrice,
      stock,
      picture,
      category,
      short,
      specs
    };
    return normalized;
  }

  _rebuildMap() {
    this._productMap.clear();
    for (const p of this.products) {
      const id = this._normalizeId(p.name || p.id || p.title || p.fullname);
      if (!id) continue;
      this._productMap.set(id, p);
    }
  }

  _notifySubscribers(change = { type: 'set', changedIds: [] }) {
    try {
      for (const fn of Array.from(this._subscribers)) {
        try { fn(change); } catch (e) { /* ignore subscriber error */ }
      }
    } catch (e) {
      /* ignore */
    }
  }

  /* ================== public API ================== */

  /**
   * Load products from backend using foxEngine.
   * Returns normalized products array.
   * @param {object} opts { force: boolean }
   */
  async loadProductsSimple({ force = false } = {}) {
    if (this.products.length && !force) {
      return this.getProducts();
    }
    if (!this.foxEngine || typeof this.foxEngine.sendPostAndGetAnswer !== 'function') {
      // no foxEngine — keep products empty but return safely
      this.products = [];
      this._rebuildMap();
      return this.getProducts();
    }

    try {
      const endpoint = this.opts.endpoints && this.opts.endpoints.products ? this.opts.endpoints.products : 'getProducts';
      const payload = { sysRequest: endpoint };
      const res = await this._safeCall(payload, 'JSON');

      let items = [];
      if (!res) {
        items = [];
      } else if (Array.isArray(res)) {
        items = res;
      } else if (res && typeof res === 'object') {
        // prefer properties with array values (common backends)
        if (Array.isArray(res.items)) items = res.items;
        else if (Array.isArray(res.products)) items = res.products;
        else if (Array.isArray(res.data)) items = res.data;
        else {
          // search for first array property
          for (const k of Object.keys(res)) {
            if (Array.isArray(res[k])) {
              items = res[k];
              break;
            }
          }
        }
      }

      // normalize
      this.products = (Array.isArray(items) ? items.map(r => this._normalizeProduct(r)).filter(Boolean) : []);
      this._rebuildMap();
      this._notifySubscribers({ type: 'reload', changedIds: this.products.map(p => p.name).filter(Boolean) });
      return this.getProducts();
    } catch (e) {
      this._safeLog('ProductService.loadProductsSimple error', e);
      // keep previous products if available, otherwise empty
      if (!Array.isArray(this.products)) this.products = [];
      this._rebuildMap();
      return this.getProducts();
    }
  }

  /**
   * Returns a copy of products array (optionally shallow clones).
   * @param {object} opts { clone: boolean }
   */
  getProducts({ clone = true } = {}) {
    if (!Array.isArray(this.products)) return [];
    return clone ? this.products.map(p => Object.assign({}, p)) : this.products;
  }

  /**
   * Synchronous find by id/name (fast using local map).
   * Returns normalized product or null.
   */
  findById(id) {
    if (!id) return null;
    const sid = this._normalizeId(id);
    if (!sid) return null;
    return this._productMap.get(sid) || null;
  }

  /**
   * Asynchronously fetch product by id from backend if not present locally.
   * If product exists locally -> resolves to that product.
   * If not and foxEngine available, will call configured endpoint.
   * On success it will insert/merge product into local store and notify subscribers.
   *
   * @param {string} id
   * @returns {Promise<null|object>} normalized product or null
   */
  async fetchById(id) {
    const sid = this._normalizeId(id);
    if (!sid) return null;

    const existing = this.findById(sid);
    if (existing) return existing;

    if (!this.foxEngine || typeof this.foxEngine.sendPostAndGetAnswer !== 'function') {
      return null;
    }
    try {
      const endpoint = this.opts.endpoints && this.opts.endpoints.productById ? this.opts.endpoints.productById : 'getProduct';
      const payload = { sysRequest: endpoint, id: sid };
      const res = await this._safeCall(payload, 'JSON');

      let item = null;
      if (!res) item = null;
      else if (Array.isArray(res) && res.length) item = res[0];
      else if (res && typeof res === 'object') {
        // if server returns wrapper { product: {...} }
        item = res.product ?? res;
      }
      if (!item) return null;

      const normalized = this._normalizeProduct(item);
      if (!normalized) return null;

      // merge into products & map (avoid mutating original array reference if already present)
      this.products.push(normalized);
      this._productMap.set(normalized.name, normalized);
      this._notifySubscribers({ type: 'add', changedIds: [normalized.name] });
      return normalized;
    } catch (e) {
      this._safeLog('ProductService.fetchById error', e);
      return null;
    }
  }

  /**
   * Replace product list with provided raw array (safe normalization).
   * Notifies subscribers.
   * @param {Array} rawProducts
   */
  setProducts(rawProducts = []) {
    try {
      if (!Array.isArray(rawProducts)) rawProducts = [];
      const normalized = rawProducts.map(r => this._normalizeProduct(r)).filter(Boolean);
      this.products = normalized;
      this._rebuildMap();
      this._notifySubscribers({ type: 'set', changedIds: this.products.map(p => p.name).filter(Boolean) });
      return true;
    } catch (e) {
      this._safeLog('ProductService.setProducts error', e);
      return false;
    }
  }

  /**
   * Get categories derived from current products (unique, sorted).
   * If you need server categories, use fetchCategories()
   */
  getCategories() {
    try {
      const set = new Set();
      for (const p of this.products) {
        if (p && p.category) set.add(String(p.category));
      }
      return Array.from(set).filter(Boolean).sort();
    } catch (e) {
      return [];
    }
  }

  /**
   * Try to fetch categories from server and return them (array of {name, fullname}).
   * Falls back to local derived categories.
   */
  async fetchCategories() {
    if (!this.foxEngine || typeof this.foxEngine.sendPostAndGetAnswer !== 'function') {
      return this.getCategories().map(c => ({ name: c, fullname: c }));
    }
    try {
      const endpoint = this.opts.endpoints && this.opts.endpoints.categories ? this.opts.endpoints.categories : 'getCategories';
      const res = await this._safeCall({ sysRequest: endpoint }, 'JSON');

      let arr = [];
      if (Array.isArray(res)) arr = res;
      else if (res && typeof res === 'object') {
        if (Array.isArray(res.categories)) arr = res.categories;
        else if (Array.isArray(res.data)) arr = res.data;
        else {
          for (const k of Object.keys(res)) {
            if (Array.isArray(res[k])) { arr = res[k]; break; }
          }
        }
      }

      // normalize to {name, fullname}
      const out = Array.isArray(arr) ? arr.map(c => {
        if (!c) return null;
        if (typeof c === 'string') return { name: c, fullname: c };
        return { name: c.name ?? c.id ?? '', fullname: c.fullname ?? c.name ?? c.title ?? '' };
      }).filter(Boolean) : [];

      if (!out.length) {
        // fallback to local categories
        return this.getCategories().map(c => ({ name: c, fullname: c }));
      }
      return out;
    } catch (e) {
      this._safeLog('ProductService.fetchCategories error', e);
      return this.getCategories().map(c => ({ name: c, fullname: c }));
    }
  }

  /**
   * Subscribe to product changes.
   * callback(change) — change: {type: 'set'|'reload'|'add'|'update', changedIds: []}
   * Returns unsubscribe function.
   */
  subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('subscribe expects a function');
    this._subscribers.add(fn);
    return () => { try { this._subscribers.delete(fn); } catch (e) { /* ignore */ } };
  }
  
    /**
   * Попытаться заполнить <select> элемент категориями.
   * selectEl — HTMLElement (select)
   */
  async fillCategories(selectEl) {
    if (!selectEl) return;
    try {
      const catArr = await this.foxEngine.sendPostAndGetAnswer({ sysRequest: "getCategories" }, "JSON") || [];
      const nameToFull = {};
      if (Array.isArray(catArr)) {
        for (const c of catArr) {
          if (c && c.name) nameToFull[c.name] = c.fullname || c.name;
        }
      }
      const cats = Array.from(new Set((this.products || []).map(p => p.category || '').filter(Boolean))).sort();
      selectEl.innerHTML = '<option value="">Все категории</option>';
      for (const c of cats) {
        const o = document.createElement('option');
        o.value = c;
        o.textContent = nameToFull[c] || c;
        selectEl.appendChild(o);
      }
    } catch (e) {
      console.warn('ProductService.fillCategories', e);
    }
  }

  /**
   * Merge/Update a single product (raw object) into the local store.
   * If product exists — it is merged; otherwise pushed.
   * Notifies subscribers with changedIds.
   */
  upsertProduct(raw) {
    try {
      const normalized = this._normalizeProduct(raw);
      if (!normalized || !normalized.name) return null;
      const existing = this.findById(normalized.name);
      if (existing) {
        // shallow merge: keep existing props unless new provides them
        Object.assign(existing, normalized);
        this._productMap.set(existing.name, existing);
        this._notifySubscribers({ type: 'update', changedIds: [existing.name] });
        return existing;
      } else {
        this.products.push(normalized);
        this._productMap.set(normalized.name, normalized);
        this._notifySubscribers({ type: 'add', changedIds: [normalized.name] });
        return normalized;
      }
    } catch (e) {
      this._safeLog('ProductService.upsertProduct error', e);
      return null;
    }
  }
}