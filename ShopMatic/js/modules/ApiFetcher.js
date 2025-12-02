/**
 * Базовый класс для работы с бекендом
 */
export class ApiFetcher {
  constructor(foxEngine, { endpoints, timeoutMs = 7000, debug = false, msgFn, logFn } = {}) {
    if (!foxEngine) throw new TypeError('ApiFetcher requires foxEngine');
    this.foxEngine = foxEngine;
    this.endpoints = { ...endpoints };
    this.timeoutMs = timeoutMs;
    this.debug = !!debug;
    this._msgFn = typeof msgFn === 'function' ? msgFn : () => '';
    this._logFn = typeof logFn === 'function' ? logFn : (...args) => { if (this.debug) console.debug(...args); };
  }

  _log(...args) {
    this._logFn(...args);
  }

  async _safeCall(payload = {}, expect = 'JSON') {
    const call = this.foxEngine.sendPostAndGetAnswer(payload, expect);
    const timeout = Number(this.timeoutMs) || 0;
    if (!timeout || timeout <= 0) return call;
    return Promise.race([
      call,
      new Promise((_, rej) =>
        setTimeout(
          () => rej(new Error(this._msgFn('ERROR_TIMEOUT') || 'Request timeout')),
          timeout
        )
      )
    ]);
  }

  _extractArray(res, prefer = ['items', 'products', 'data', 'categories', 'brands', 'list']) {
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (typeof res !== 'object') return [];
    for (const k of prefer) if (Array.isArray(res[k])) return res[k];
    for (const k of Object.keys(res)) if (Array.isArray(res[k])) return res[k];
    return [res];
  }

  _buildRequest(endpoint, request = null) {
    let payload = { sysRequest: endpoint };
    if (request) {
      if (typeof request === 'string') {
        payload.sysRequest = request;
      } else {
        const { endpoint: reqEndpoint, sysRequest: reqSys, payload: reqPayload, params: reqParams, ...extra } = request;
        payload = { ...reqParams, ...reqPayload, ...extra, sysRequest: reqEndpoint || reqSys || endpoint };
      }
    }
    return { endpoint, payload };
  }
}

/**
 * Класс для работы с продуктами
 */
export class ProductFetcher extends ApiFetcher {
  constructor(foxEngine, { endpoints = {}, timeoutMs, debug, msgFn, logFn } = {}) {
    super(foxEngine, { endpoints, timeoutMs, debug, msgFn, logFn });
    this.endpoints = { 
      products: 'getProducts', 
      productById: 'getProduct', 
      categories: 'getCategories', 
      brands: 'getBrands', 
      ...endpoints 
    };
  }

  async fetchProducts(request = null) {
    const { payload } = this._buildRequest(this.endpoints.products, request);
    const res = await this._safeCall(payload, 'JSON');
    return this._extractArray(res);
  }

  async fetchProductById(id) {
    if (!id) return null;
    const { payload } = this._buildRequest(this.endpoints.productById, { id });
    const res = await this._safeCall(payload, 'JSON');
    const items = this._extractArray(res, ['product', 'item', 'items', 'products', 'data']);
    return items.length ? items[0] : null;
  }

  async fetchList(entity) {
    const { payload } = this._buildRequest(this.endpoints[entity]);
    const res = await this._safeCall(payload, 'JSON');
    return this._extractArray(res, [entity, 'data', 'items', 'list']);
  }

  async fetchEntityById(entity, id) {
    const { payload } = this._buildRequest(this.endpoints[entity], { id });
    const res = await this._safeCall(payload, 'JSON');
    const arr = this._extractArray(res, [entity, 'data', 'items']);
    return arr.find(x => [x.id, x.name, x.key].includes(String(id).trim())) || null;
  }
}
