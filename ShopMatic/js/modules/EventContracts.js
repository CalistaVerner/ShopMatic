/**
 * YandexCore Event Contracts (v1)
 *
 * Single standardized envelope for all DOMAIN_*/UI_* events.
 *
 * Envelope shape:
 *   {
 *     v: 1,
 *     type: string,
 *     at: number, // epoch ms
 *     meta: { source?: string, reason?: string, [k:string]: any },
 *     data: any
 *   }
 */

export function makeEventEnvelope(type, data, meta = undefined) {
  return Object.freeze({
    v: 1,
    type: String(type || '').trim(),
    at: Date.now(),
    meta: meta && typeof meta === 'object' ? { ...meta } : {},
    data
  });
}

/**
 * Accepts either envelope or raw payload.
 * Returns { type, data, meta, v }.
 */
export function unwrapEvent(payload, fallbackType = '') {
  if (payload && typeof payload === 'object' && payload.v === 1 && 'data' in payload) {
    return {
      v: 1,
      type: String(payload.type || fallbackType || '').trim(),
      data: payload.data,
      meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : {}
    };
  }
  return {
    v: 0,
    type: String(fallbackType || '').trim(),
    data: payload,
    meta: {}
  };
}

/**
 * Extract ids from common payload shapes.
 * Supports:
 *  - { id }
 *  - { ids: [] }
 *  - { changedIds: [] }
 *  - { items: [{id}] }
 *  - { data: ... } envelope
 */
export function extractIds(payload) {
  const { data } = unwrapEvent(payload);
  if (!data) return null;

  if (typeof data === 'string' || typeof data === 'number') {
    const one = String(data).trim();
    return one ? [one] : null;
  }

  if (data && typeof data === 'object') {
    if (data.id != null) {
      const one = String(data.id).trim();
      return one ? [one] : null;
    }

    const ids = data.ids || data.items || data.changedIds;
    if (Array.isArray(ids)) {
      return ids.map((x) => String(x?.id ?? x).trim()).filter(Boolean);
    }
  }

  return null;
}

export function normalizeId(id) {
  const s = String(id ?? '').trim();
  return s || null;
}
