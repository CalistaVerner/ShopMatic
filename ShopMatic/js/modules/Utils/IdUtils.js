/**
 * @author Calista Verner
 */

/**
 * @typedef {string|number|null|undefined|Object} IdLike
 */

export class IdUtils {
  /**
   * Normalize any identifier-like value to a stable string key.
   * @param {IdLike} id
   * @returns {string}
   */
  static key(id) {
    const raw =
      id?.id ??
      id?.name ??
      id?.productId ??
      id?.product_id ??
      id?.cartId ??
      id?.itemId ??
      id?._missingId ??
      id;

    if (raw === null || raw === undefined) return '';
    return String(raw).trim();
  }

  /**
   * Safe CSS.escape alternative.
   * @param {string} s
   * @returns {string}
   */
  static cssEscape(s) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
    return String(s).replace(/["\\]/g, '\\$&');
  }
}
