/**
 * Класс для работы с продуктами
 */
	import { ApiFetcher } from "../ApiFetcher.js";
 
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