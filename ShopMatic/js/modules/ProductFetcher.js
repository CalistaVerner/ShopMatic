/**
 * Fetcher for product-related API operations.
 *
 * Extends ApiFetcher and provides convenience methods
 * to load product lists, single product, and related entities
 * such as categories and brands.
 */
	import { ApiFetcher } from "./ApiFetcher.js";

export class ProductFetcher extends ApiFetcher {
  /**
   * @param {Object} foxEngine - Transport/engine used to send requests.
   * @param {Object} [options]
   * @param {Object<string,string>} [options.endpoints]
   *   - Optional endpoint overrides. Defaults:
   *     - products: 'getProducts'
   *     - productById: 'getProduct'
   *     - categories: 'getCategories'
   *     - brands: 'getBrands'
   * @param {number} [options.timeoutMs] - Request timeout in milliseconds.
   * @param {boolean} [options.debug] - Enables debug logging when true.
   * @param {(code: string) => string} [options.msgFn] - Optional message resolver.
   * @param {(...args: any[]) => void} [options.logFn] - Optional logger implementation.
   */
  constructor(
    foxEngine,
    {
      endpoints = {},
      timeoutMs,
      debug,
      msgFn,
      logFn
    } = {}
  ) {
    const defaultEndpoints = {
      products: 'getProducts',
      productById: 'getProduct',
      categories: 'getCategories',
      brands: 'getBrands'
    };

    super(foxEngine, {
      endpoints: {
        ...defaultEndpoints,
        ...endpoints
      },
      timeoutMs,
      debug,
      msgFn,
      logFn
    });

    // Ensure we keep a local copy that can be read directly if needed.
    this.endpoints = {
      ...defaultEndpoints,
      ...endpoints
    };
  }

  /**
   * Fetches a list of products.
   *
   * @param {null|string|Object} [request=null]
   *   - Either:
   *     - `null` → use default endpoint only
   *     - `string` → overrides sysRequest
   *     - `Object` → passed to `_buildRequest` to build the payload
   * @returns {Promise<Array<any>>}
   */
  async fetchProducts(request = null) {
    const { payload } = this._buildRequest(this.endpoints.products, request);
    const res = await this._safeCall(payload, 'JSON');
    return this._extractArray(res);
  }

  /**
   * Fetches a single product by its identifier.
   *
   * @param {string|number} id - Product identifier.
   * @returns {Promise<Object|null>} - First matched product or null if not found or invalid id.
   */
  async fetchProductById(id) {
    if (!id && id !== 0) return null;

    const { payload } = this._buildRequest(this.endpoints.productById, { id });
    const res = await this._safeCall(payload, 'JSON');

    const items = this._extractArray(res, [
      'product',
      'item',
      'items',
      'products',
      'data'
    ]);

    return items.length ? items[0] : null;
  }

  /**
   * Fetches a list for a given logical entity, such as:
   * - "categories"
   * - "brands"
   * or any other entity key present in `this.endpoints`.
   *
   * @param {string} entity - Logical endpoint key, e.g. "categories".
   * @returns {Promise<Array<any>>}
   */
  async fetchList(entity) {
    const endpointName = this.endpoints?.[entity];

    if (!endpointName) {
      this._log(`ProductFetcher.fetchList: unknown endpoint for entity "${entity}"`);
      return [];
    }

    const { payload } = this._buildRequest(endpointName);
    const res = await this._safeCall(payload, 'JSON');
    return this._extractArray(res, [entity, 'data', 'items', 'list']);
  }

  /**
   * Fetches a specific entity item by its id from a given entity list endpoint.
   *
   * Example:
   *   fetchEntityById('categories', '123');
   *
   * @param {string} entity - Logical endpoint key, e.g. "categories" or "brands".
   * @param {string|number} id - Identifier to search for.
   * @returns {Promise<Object|null>} - Matching entity or null if not found.
   */
  async fetchEntityById(entity, id) {
    const endpointName = this.endpoints?.[entity];

    if (!endpointName) {
      this._log(`ProductFetcher.fetchEntityById: unknown endpoint for entity "${entity}"`);
      return null;
    }

    const { payload } = this._buildRequest(endpointName, { id });
    const res = await this._safeCall(payload, 'JSON');
    const arr = this._extractArray(res, [entity, 'data', 'items']);

    const target = String(id).trim();

    return (
      arr.find((item) => {
        if (!item || typeof item !== 'object') return false;

        const candidates = [
          item.id,
          item.name,
          item.key
        ].filter((v) => v !== undefined && v !== null);

        return candidates
          .map((v) => String(v).trim())
          .includes(target);
      }) || null
    );
  }
}
