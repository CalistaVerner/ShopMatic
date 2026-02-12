/**
 * Base class for backend API communication.
 *
 * Provides:
 * - unified timeout handling (legacy fallback)
 * - basic logging
 * - flexible request builder
 * - helper for extracting arrays from various backend response shapes
 * - optional ApiClient integration (preferred)
 */

import { ServiceRegistry } from './Api/ServiceRegistry.js';
import { ApiClient } from './Api/ApiClient.js';
import { FoxService } from './Api/FoxService.js';

export class ApiFetcher {
  /**
   * @param {Object} foxEngine - Transport/engine used to send requests.
   * @param {Object} [options]
   * @param {Object<string,string>} [options.endpoints] - Map of logical names to backend endpoint identifiers.
   * @param {number} [options.timeoutMs=7000] - Request timeout in milliseconds. If not positive, no timeout is applied.
   * @param {boolean} [options.debug=false] - Enables debug logging when true.
   * @param {(code: string) => string} [options.msgFn] - Optional function to translate message codes to human-readable text.
   * @param {(...args: any[]) => void} [options.logFn] - Optional logger implementation (defaults to console.debug in debug mode).
   * @param {{request:(req:any)=>Promise<any>}} [options.apiClient] - Optional external ApiClient-like implementation.
   */
  constructor(foxEngine, options = {}) {
    if (!foxEngine) {
      throw new TypeError('ApiFetcher requires foxEngine');
    }

    const {
      endpoints = {},
      timeoutMs = 7000,
      debug = false,
      msgFn,
      logFn,
      apiClient
    } = options;

    /** @protected */
    this.foxEngine = foxEngine;

    /**
     * Map of logical endpoint keys to backend endpoint identifiers (sysRequest).
     * @type {Record<string, string>}
     * @protected
     */
    this.endpoints = { ...endpoints };

    /**
     * Request timeout in milliseconds. If <= 0, timeout is disabled.
     * @type {number}
     * @protected
     */
    this.timeoutMs = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 0;

    /**
     * Enables debug logging.
     * @type {boolean}
     * @protected
     */
    this.debug = !!debug;

    /**
     * Message resolver for human-readable errors.
     * @type {(code: string) => string}
     * @protected
     */
    this._msgFn = typeof msgFn === 'function' ? msgFn : () => '';

    /**
     * Logger implementation.
     * @type {(...args: any[]) => void}
     * @protected
     */
    this._logFn =
      typeof logFn === 'function'
        ? logFn
        : (...args) => {
            if (this.debug) {
              // eslint-disable-next-line no-console
              console.debug(...args);
            }
          };

    /**
     * Internal unified client (preferred).
     * @protected
     */
    this._apiClient = null;

    /**
     * Registry used only when we need to build ApiClient from foxEngine.
     * @protected
     */
    this._registry = null;

    // Prefer explicitly provided apiClient, else build on top of foxEngine.
    try {
      if (apiClient && typeof apiClient.request === 'function') {
        this._apiClient = apiClient;
      } else if (typeof foxEngine.sendPostAndGetAnswer === 'function') {
        this._registry = new ServiceRegistry();
        this._registry.register('fox', new FoxService(foxEngine));

        this._apiClient = new ApiClient(this._registry, {
          defaultService: 'fox',
          defaultTimeoutMs: this.timeoutMs || 7000,
          maxRetries: 1,
          retryBaseDelayMs: 220,
          cacheTtlMs: 10_000,
          debug: this.debug,
          logFn: this._logFn
        });
      }
    } catch (e) {
      // non-fatal: fallback to legacy _safeCall
      this._apiClient = null;
      this._registry = null;
    }
  }

  /**
   * Write to log using the configured logger.
   * @protected
   * @param {...any} args
   */
  _log(...args) {
    this._logFn(...args);
  }

  /**
   * Safely performs a backend call with optional timeout protection (legacy path).
   *
   * @protected
   * @template TResult
   * @param {Object} [payload={}] - Request payload to be sent to backend.
   * @param {'JSON'|'TEXT'|string} [expect='JSON'] - Expected response type for foxEngine.
   * @returns {Promise<TResult>}
   */
  async _safeCall(payload = {}, expect = 'JSON') {
    const timeout = Number(this.timeoutMs) || 0;
    const callPromise = this.foxEngine.sendPostAndGetAnswer(payload, expect);

    if (!timeout || timeout <= 0) {
      // No timeout configured: return original promise directly.
      return callPromise;
    }

    const timeoutPromise = new Promise((_, reject) => {
      const message = this._msgFn('ERROR_TIMEOUT') || 'Request timeout';
      setTimeout(() => reject(new Error(message)), timeout);
    });

    // Race backend call with timeout to avoid hanging requests.
    return Promise.race([callPromise, timeoutPromise]);
  }

  /**
   * Unified call wrapper:
   * - uses ApiClient when available (retries/cache/timeout normalization)
   * - falls back to legacy _safeCall otherwise
   *
   * @protected
   * @template TResult
   * @param {Object} payload
   * @param {'JSON'|'TEXT'|string} [expect='JSON']
   * @param {{cacheKey?:string, cacheTtlMs?:number, retries?:number, retry?:boolean}} [opts]
   * @returns {Promise<TResult>}
   */
  async _call(payload, expect = 'JSON', opts = {}) {
    const p = payload || {};
    const endpoint = String(p.sysRequest || p.endpoint || '').trim();

    // If endpoint is not present, fallback to legacy call
    if (!endpoint) return this._safeCall(p, expect);

    // Preferred path via ApiClient
    if (this._apiClient && typeof this._apiClient.request === 'function') {
      // Remove sysRequest from payload for transport layer (it will be set as endpoint).
      const { sysRequest, endpoint: _ep, ...rest } = p;

      return this._apiClient.request({
        endpoint,
        payload: rest,
        expect,
        timeoutMs: this.timeoutMs || undefined,
        cacheKey: opts.cacheKey,
        cacheTtlMs: opts.cacheTtlMs,
        retries: opts.retries,
        retry: opts.retry
      });
    }

    // Legacy path
    return this._safeCall(p, expect);
  }

  /**
   * Tries to extract an array of items from various possible response shapes.
   *
   * @protected
   * @param {any} res - Response object returned from backend.
   * @param {string[]} [prefer=['items','products','data','categories','brands','list']]
   * @returns {Array<any>}
   */
  _extractArray(res, prefer = ['items', 'products', 'data', 'categories', 'brands', 'list']) {
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (typeof res !== 'object') return [];

    for (const key of prefer) {
      if (Array.isArray(res[key])) return res[key];
    }

    for (const key of Object.keys(res)) {
      if (Array.isArray(res[key])) return res[key];
    }

    return [res];
  }

  /**
   * Resolves the final endpoint name (sysRequest) from either:
   * - a key present in this.endpoints, or
   * - a direct endpoint string.
   *
   * @protected
   * @param {string} endpointOrKey
   * @returns {string}
   */
  _resolveEndpoint(endpointOrKey) {
    if (this.endpoints && this.endpoints[endpointOrKey]) {
      return this.endpoints[endpointOrKey];
    }
    return endpointOrKey;
  }

  /**
   * Builds a request payload in a flexible but predictable way.
   *
   * @protected
   * @param {string} endpointOrKey
   * @param {null|string|Object} [request=null]
   * @returns {{ endpoint: string, payload: Object }}
   */
  _buildRequest(endpointOrKey, request = null) {
    const resolvedEndpoint = this._resolveEndpoint(endpointOrKey);

    /** @type {Object} */
    let payload = { sysRequest: resolvedEndpoint };

    if (request) {
      if (typeof request === 'string') {
        payload.sysRequest = request;
      } else if (typeof request === 'object') {
        const {
          endpoint: reqEndpoint,
          sysRequest: reqSys,
          payload: reqPayload,
          params: reqParams,
          ...extra
        } = request;

        const finalSysRequest = reqEndpoint || reqSys || resolvedEndpoint;

        payload = {
          ...(reqParams || {}),
          ...(reqPayload || {}),
          ...extra,
          sysRequest: finalSysRequest
        };
      }
    }

    return { endpoint: resolvedEndpoint, payload };
  }
}
