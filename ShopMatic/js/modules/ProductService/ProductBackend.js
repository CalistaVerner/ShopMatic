import { ProductFetcher } from '../ProductFetcher.js';

/**
 * Adapter around ProductFetcher that preserves the ProductBackend interface
 * expected by ProductService.
 *
 * Now extends ProductFetcher for better OOP composition and stability.
 */
export class ProductBackend extends ProductFetcher {
  /**
   * @param {any} foxEngine - Transport engine used to perform backend requests.
   * @param {{
   *   endpoints?: Object,
   *   timeoutMs?: number,
   *   debug?: boolean
   * }} [opts] - Backend configuration.
   * @param {(key:string, vars?:Record<string,string|number>) => string} [msgFn]
   *   - Optional message resolver (e.g. for timeout texts).
   * @param {(...args:any[]) => void} [logFn]
   *   - Optional logging function used in debug mode.
   */
  constructor(foxEngine, opts = {}, msgFn, logFn) {
    const {
      endpoints = {
        products: 'getProducts',
        productById: 'getProduct',
        categories: 'getCategories',
        brands: 'getBrands'
      },
      timeoutMs = 7000,
      debug = false
    } = opts || {};

    // Call parent constructor
    super(foxEngine, {
      endpoints,
      timeoutMs,
      debug,
      msgFn,
      logFn
    });

    /**
     * Expose endpoints so ProductService can read them (legacy API compatibility).
     * @type {Record<string,string>}
     */
    this.endpoints = { ...this.endpoints };
  }

  /**
   * Thin wrapper over ProductFetcher._safeCall.
   * Used by ProductService as the low-level request executor.
   *
   * @param {Object} [payload={}] - Payload sent to the backend.
   * @param {string} [expect='JSON'] - Expected response type.
   * @returns {Promise<any>}
   */
  safeCall(payload = {}, expect = 'JSON') {
    return this._safeCall(payload, expect);
  }

  /**
   * Wrapper over ProductFetcher._extractArray.
   * Normalizes backend responses that may contain nested lists.
   *
   * @param {any} res - Backend response.
   * @param {string[]} [prefer] - Preferred keys containing array data.
   * @returns {Array<any>}
   */
  extractArray(res, prefer) {
    return this._extractArray(res, prefer);
  }

  /**
   * Fetches an entity list from the backend (e.g., "categories", "brands").
   * Delegates to ProductFetcher.fetchList.
   *
   * @param {string} entity - Entity name mapped in endpoints.
   * @returns {Promise<Array<any>>}
   */
  fetchList(entity) {
    return super.fetchList(entity);
  }

  /**
   * Fetches a single entity by ID (category/brand/etc.).
   * Delegates to ProductFetcher.fetchEntityById.
   *
   * @param {string} entity - Entity type (e.g. "categories", "brands").
   * @param {string|number} id - Entity identifier.
   * @returns {Promise<any|null>}
   */
  fetchEntityById(entity, id) {
    return super.fetchEntityById(entity, id);
  }
}