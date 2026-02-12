/**
 * KnowledgeBase integration layer.
 *
 * This module does NOT assume concrete backend schema beyond "endpoint + payload".
 * Endpoints can be overridden by host via opts. Endpoints are intentionally
 * named (not hardcoded in logic) to keep integration extensible.
 */
export class KnowledgeBaseApi {
  /**
   * @param {import('../Api/ApiClient.js').ApiClient} api
   * @param {{
   *  service?: string,
   *  endpoints?: Partial<Record<string,string>>
   * }} [opts]
   */
  constructor(api, opts = {}) {
    this.api = api;
    this.service = opts.service || 'fox';

    // Default endpoints (can be remapped server-side).
    this.endpoints = Object.assign({
      list: 'knowledgeBase.list',
      get: 'knowledgeBase.get',
      save: 'knowledgeBase.save',
      remove: 'knowledgeBase.delete',
      dicts: 'knowledgeBase.dicts',
      upload: 'knowledgeBase.upload'
    }, opts.endpoints || {});
  }

  async list(params = {}) {
    return this.api.request({ service: this.service, endpoint: this.endpoints.list, payload: params, cacheKey: `kb:list:${JSON.stringify(params)}` });
  }

  async get(id) {
    return this.api.request({ service: this.service, endpoint: this.endpoints.get, payload: { id } });
  }

  async save(dto) {
    return this.api.request({ service: this.service, endpoint: this.endpoints.save, payload: dto, retry: false });
  }

  async remove(id) {
    return this.api.request({ service: this.service, endpoint: this.endpoints.remove, payload: { id }, retry: false });
  }

  async dicts() {
    return this.api.request({ service: this.service, endpoint: this.endpoints.dicts, cacheKey: 'kb:dicts', cacheTtlMs: 60_000 });
  }

  /**
   * Upload a guide file.
   *
   * Transport is generic: we send { filename, mime, data_base64 }.
   * Server may store raw file and/or convert to HTML/Markdown.
   */
  async uploadFile(file) {
    if (!file) throw new Error('uploadFile: file is required');

    const data_base64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('Failed to read file'));
      r.onload = () => {
        const res = String(r.result || '');
        // data:*/*;base64,xxxx
        const comma = res.indexOf(',');
        resolve(comma >= 0 ? res.slice(comma + 1) : res);
      };
      r.readAsDataURL(file);
    });

    return this.api.request({
      service: this.service,
      endpoint: this.endpoints.upload,
      payload: {
        filename: file.name,
        mime: file.type || 'application/octet-stream',
        data_base64
      },
      timeoutMs: 20_000,
      retry: false
    });
  }
}
