/**
 * @author Calista Verner
 *
 * CartPresenter — the single orchestrator.
 * Responsibilities:
 *  - Accept actions (commands) from UI layer
 *  - Mutate domain state (CartBase) WITHOUT triggering UI side-effects
 *  - Re-render UI (grid/minicart/totals/badges)
 *  - Emit events
 *
 * UI layers (listeners/helpers) MUST call dispatch() only.
 *
 * Contract (important):
 *  - UI code MUST NOT call CartBase mutations directly.
 *    It MUST call presenter.dispatch(action) only.
 *  - Presenter mutates domain via ctx._domain* methods (no UI side-effects).
 *  - Presenter triggers exactly one UI refresh pipeline: ctx._updateCartUI(targetId).
 *  - dispatch() is re-entrancy safe: concurrent calls collapse into the same pipeline.
 *
 * Supported actions (type is case-insensitive):
 *  - { type:'ADD', id, qty? }
 *  - { type:'REMOVE', id }
 *  - { type:'QTY_SET', id, qty, sourceRow? }
 *  - { type:'QTY_INC', id, sourceRow? }
 *  - { type:'QTY_DEC', id, sourceRow? }  // can reach 0 => domain removes
 *  - { type:'INCLUDE_SET', id, included }
 *  - { type:'INCLUDE_ALL', included }
 *  - { type:'FAV_TOGGLE', id }
 *
 * return value:
 *  - dispatch() resolves to CartStateSnapshot (from ctx._updateCartUI).
 */

export class CartPresenter {
  /**
   * @param {any} ctx CartUI (extends CartBase in your project)
   */
  constructor(ctx) {
    this.ctx = ctx;
    this._updating = false;
  }

  /**
   * Unified entry point.
   * @param {object} action
   * @returns {Promise<any>}
   */
  async dispatch(action = {}) {
    const c = this.ctx;
    const type = String(action?.type || '').trim().toUpperCase();
    if (!type) return null;

    let targetId = action.id != null ? c._normalizeIdKey(action.id) : null;

    // --- DOMAIN MUTATIONS ONLY (no UI calls here) ----------------------------
    switch (type) {
      case 'QTY_SET': {
        if (!targetId) return null;
        const qty = Number.isFinite(Number(action.qty)) ? Number(action.qty) : 0;
        c._domainChangeQty(targetId, qty, { sourceRow: action.sourceRow || null });
        break;
      }

      case 'QTY_INC': {
        if (!targetId) return null;
        const item = c._getCartItemById(targetId);
        const next = Number(item?.qty ?? 0) + 1;
        c._domainChangeQty(targetId, next, { sourceRow: action.sourceRow || null });
        break;
      }

      case 'QTY_DEC': {
        if (!targetId) return null;
        const item = c._getCartItemById(targetId);
        const next = Number(item?.qty ?? 0) - 1; // allow 0 => domain removes
        c._domainChangeQty(targetId, next, { sourceRow: action.sourceRow || null });
        break;
      }

      case 'REMOVE': {
        if (!targetId) return null;
        c._domainRemove(targetId);
        break;
      }

      case 'ADD': {
        if (!targetId) return null;
        const qty = Number.isFinite(Number(action.qty)) ? Math.max(1, Number(action.qty)) : 1;
        c._domainAdd(targetId, qty);
        break;
      }

      case 'INCLUDE_SET': {
        if (!targetId) return null;
        const included = !!action.included;
        c.included?.set?.(targetId, included, { immediateSave: true, reason: 'include_set' });
        // reflect on item if exists (still not "cart logic", just state projection)
        const it = c._getCartItemById?.(targetId);
        if (it) it.included = included;
        break;
      }

      case 'INCLUDE_ALL': {
        const val = !!action.included;
        c.included?.setAll?.(Array.isArray(c.cart) ? c.cart : [], val, { immediateSave: true });
        targetId = null; // global update
        break;
      }

      case 'FAV_TOGGLE': {
        if (!targetId) return null;
        // Favorites is external module; presenter triggers and then updates UI via Card event system.
        try {
          const res = c.favorites?.toggle?.(targetId);
          if (res && typeof res.then === 'function') await res.catch(() => {});
        } catch {}
        break;
      }

      default:
        return null;
    }

    // --- UI ORCHESTRATION (single place) ------------------------------------
    return this.updateUI(targetId);
  }

  /**
   * The only UI refresh pipeline.
   * @param {string|null} targetId
   */
  async updateUI(targetId = null) {
    const c = this.ctx;
    if (this._updating) {
      // Collapse into a normal update; avoid re-entrancy storms.
      return c._updateCartUI(targetId);
    }

    this._updating = true;
    try {
      return await c._updateCartUI(targetId);
    } finally {
      this._updating = false;
    }
  }
}
