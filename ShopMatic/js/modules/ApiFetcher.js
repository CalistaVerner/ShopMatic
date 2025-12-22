/**
 * Base class for backend API communication.
 *
 * Provides:
 * - unified timeout handling
 * - basic logging
 * - flexible request builder
 * - helper for extracting arrays from various backend response shapes
 */
export class ApiFetcher {
  /**
   * @param {Object} foxEngine - Transport/engine used to send requests.
   * @param {Object} [options]
   * @param {Object<string,string>} [options.endpoints] - Map of logical names to backend endpoint identifiers.
   * @param {number} [options.timeoutMs=7000] - Request timeout in milliseconds. If not positive, no timeout is applied.
   * @param {boolean} [options.debug=false] - Enables debug logging when true.
   * @param {(code: string) => string} [options.msgFn] - Optional function to translate message codes to human-readable text.
   * @param {(...args: any[]) => void} [options.logFn] - Optional logger implementation (defaults to console.debug in debug mode).
   */
  constructor(
    foxEngine,
    {
      endpoints = {},
      timeoutMs = 7000,
      debug = false,
      msgFn,
      logFn
    } = {}
  ) {
    if (!foxEngine) {
      throw new TypeError('ApiFetcher requires foxEngine');
    }

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
    this._msgFn =
      typeof msgFn === 'function'
        ? msgFn
        : () => '';

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
   * Safely performs a backend call with optional timeout protection.
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
      const message =
        this._msgFn('ERROR_TIMEOUT') || 'Request timeout';

      setTimeout(() => {
        reject(new Error(message));
      }, timeout);
    });

    // Race backend call with timeout to avoid hanging requests.
    return Promise.race([callPromise, timeoutPromise]);
  }

  /**
   * Tries to extract an array of items from various possible response shapes.
   *
   * Examples of supported shapes:
   * - Array: `res = [...]`
   * - Object with known array properties: `{ items: [...] }`, `{ data: [...] }`, etc.
   * - Object with any first array property
   * - Fallback: wrap the whole object into an array `[res]`
   *
   * @protected
   * @param {any} res - Response object returned from backend.
   * @param {string[]} [prefer=['items','products','data','categories','brands','list']]
   *   - Preferred property names to check first.
   * @returns {Array<any>} - Normalized array (never `null` or `undefined`).
   */
  _extractArray(
    res,
    prefer = ['items', 'products', 'data', 'categories', 'brands', 'list']
  ) {
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (typeof res !== 'object') return [];

    for (const key of prefer) {
      if (Array.isArray(res[key])) return res[key];
    }

    for (const key of Object.keys(res)) {
      if (Array.isArray(res[key])) return res[key];
    }

    // As a last resort, wrap the whole response into an array.
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
   * Behaviour:
   * - If `request` is a string → overrides `sysRequest`.
   * - If `request` is an object:
   *   - `endpoint` / `sysRequest` may override the base endpoint
   *   - `params` and `payload` are merged together
   *   - all extra top-level fields are also merged in
   *   - `sysRequest` in final payload is determined from:
   *     `request.endpoint || request.sysRequest || resolvedEndpoint`
   *
   * This logic is kept compatible with the original implementation.
   *
   * @protected
   * @param {string} endpointOrKey - Endpoint key or direct backend endpoint name.
   * @param {null|string|Object} [request=null] - Optional request override.
   * @returns {{ endpoint: string, payload: Object }}
   */
  _buildRequest(endpointOrKey, request = null) {
    const resolvedEndpoint = this._resolveEndpoint(endpointOrKey);

    /** @type {Object} */
    let payload = { sysRequest: resolvedEndpoint };

    if (request) {
      if (typeof request === 'string') {
        // Simple string override for sysRequest.
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

        // Preserve original merge order: params -> payload -> extra -> sysRequest.
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