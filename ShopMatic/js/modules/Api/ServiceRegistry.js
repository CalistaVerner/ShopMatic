/**
 * Minimal registry for external services.
 *
 * A "service" is any object implementing:
 *   request(req: ApiRequest): Promise<any>
 *
 * This allows ShopMatic and other modules (e.g. KnowledgeBase) to integrate
 * with multiple backends (foxEngine sysRequest, REST, 3rd party, etc.) without
 * hardcoding transports.
 */
export class ServiceRegistry {
  constructor() {
    /** @type {Map<string, any>} */
    this._services = new Map();
  }

  /**
   * Register or replace a service.
   * @param {string} name
   * @param {{ request: (req: any) => Promise<any> }} service
   */
  register(name, service) {
    if (!name || typeof name !== 'string') throw new TypeError('service name must be a string');
    if (!service || typeof service.request !== 'function') throw new TypeError('service must implement request(req)');
    this._services.set(name, service);
  }

  /**
   * Get a service by name.
   * @param {string} name
   */
  get(name) {
    return this._services.get(name);
  }

  /**
   * @param {string} name
   */
  has(name) {
    return this._services.has(name);
  }
}
