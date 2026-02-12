/**
 * Unified API client.
 *
 * Sits above transport-specific implementations ("services") and provides:
 * - timeout
 * - retries (with exponential backoff)
 * - optional in-memory caching for idempotent requests
 * - normalized errors
 */
export class ApiClient {
  /**
   * @param {import('./ServiceRegistry.js').ServiceRegistry} registry
   * @param {{
   *   defaultService?: string,
   *   defaultTimeoutMs?: number,
   *   maxRetries?: number,
   *   retryBaseDelayMs?: number,
   *   cacheTtlMs?: number,
   *   debug?: boolean,
   *   logFn?: (...args:any[])=>void
   * }} [opts]
   */
  constructor(registry, opts = {}) {
    this.registry = registry;
    this.defaultService = opts.defaultService || 'fox';
    this.defaultTimeoutMs = Number.isFinite(opts.defaultTimeoutMs) ? Number(opts.defaultTimeoutMs) : 7000;
    this.maxRetries = Number.isFinite(opts.maxRetries) ? Math.max(0, Number(opts.maxRetries)) : 1;
    this.retryBaseDelayMs = Number.isFinite(opts.retryBaseDelayMs) ? Math.max(0, Number(opts.retryBaseDelayMs)) : 220;
    this.cacheTtlMs = Number.isFinite(opts.cacheTtlMs) ? Math.max(0, Number(opts.cacheTtlMs)) : 10_000;
    this.debug = !!opts.debug;
    this._logFn = typeof opts.logFn === 'function' ? opts.logFn : (...a) => { if (this.debug) console.debug(...a); };

    /** @type {Map<string, {ts:number, value:any}>} */
    this._cache = new Map();
  }

  _log(...args) {
    this._logFn(...args);
  }

  /**
   * @param {number} ms
   */
  async _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Normalize thrown errors to a predictable shape.
   * @param {any} err
   */
  _normalizeError(err) {
    if (err instanceof Error) return err;
    if (typeof err === 'string') return new Error(err);
    try {
      return new Error(JSON.stringify(err));
    } catch {
      return new Error('Unknown error');
    }
  }

  /**
   * Execute a request.
   *
   * @param {{
   *  service?: string,
   *  endpoint: string,
   *  payload?: any,
   *  expect?: 'JSON'|'TEXT'|string,
   *  timeoutMs?: number,
   *  retries?: number,
   *  retry?: boolean,
   *  cacheKey?: string,
   *  cacheTtlMs?: number
   * }} req
   */
  async request(req) {
    if (!req || typeof req !== 'object') throw new TypeError('ApiClient.request(req): req must be object');
    if (!req.endpoint || typeof req.endpoint !== 'string') throw new TypeError('ApiClient.request(req): endpoint is required');

    const serviceName = req.service || this.defaultService;
    const service = this.registry.get(serviceName);
    if (!service) throw new Error(`ApiClient: unknown service '${serviceName}'`);

    const timeoutMs = Number.isFinite(req.timeoutMs) ? Number(req.timeoutMs) : this.defaultTimeoutMs;
    const expect = req.expect || 'JSON';
    const shouldRetry = req.retry !== undefined ? !!req.retry : true;
    const retries = Number.isFinite(req.retries) ? Math.max(0, Number(req.retries)) : this.maxRetries;

    // Cache (idempotent only, opt-in via cacheKey)
    const cacheKey = typeof req.cacheKey === 'string' && req.cacheKey ? req.cacheKey : null;
    if (cacheKey) {
      const cached = this._cache.get(cacheKey);
      const ttl = Number.isFinite(req.cacheTtlMs) ? Math.max(0, Number(req.cacheTtlMs)) : this.cacheTtlMs;
      if (cached && (Date.now() - cached.ts) <= ttl) {
        return cached.value;
      }
    }

    let attempt = 0;
    const maxAttempt = shouldRetry ? (retries + 1) : 1;
    let lastErr = null;

    while (attempt < maxAttempt) {
      attempt++;
      try {
        const res = await service.request({
          endpoint: req.endpoint,
          payload: req.payload,
          expect,
          timeoutMs
        });

        if (cacheKey) this._cache.set(cacheKey, { ts: Date.now(), value: res });
        return res;
      } catch (e) {
        lastErr = this._normalizeError(e);
        if (attempt >= maxAttempt) break;
        const backoff = this.retryBaseDelayMs * Math.pow(2, attempt - 1);
        this._log('ApiClient retry', { endpoint: req.endpoint, attempt, backoff, err: String(lastErr) });
        await this._sleep(backoff);
      }
    }

    throw lastErr || new Error('Api request failed');
  }

  /**
   * Clear cache entries.
   * @param {string} [key]
   */
  clearCache(key) {
    if (!key) {
      this._cache.clear();
      return;
    }
    this._cache.delete(key);
  }
}
