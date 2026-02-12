/**
 * foxEngine transport adapter.
 *
 * Uses foxEngine.sendPostAndGetAnswer({sysRequest,...}) contract.
 */
export class FoxService {
  /**
   * @param {any} foxEngine
   */
  constructor(foxEngine) {
    if (!foxEngine || typeof foxEngine.sendPostAndGetAnswer !== 'function') {
      throw new TypeError('FoxService requires foxEngine.sendPostAndGetAnswer');
    }
    this.foxEngine = foxEngine;
  }

  /**
   * @param {{endpoint:string, payload?:any, expect?:string, timeoutMs?:number}} req
   */
  async request(req) {
    const payload = { ...(req.payload || {}), sysRequest: req.endpoint };
    // foxEngine already does fetch internally; timeout handled one layer above.
    return this.foxEngine.sendPostAndGetAnswer(payload, req.expect || 'JSON');
  }
}
