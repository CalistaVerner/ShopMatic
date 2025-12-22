/**
 * CartStateSnapshot
 * Immutable snapshot of cart state used for events, debugging and UI adapters.
 *
 * @author Calista Verner
 */

export class CartStateSnapshot {
  constructor({
    cart = [],
    totalCount = 0,
    totalSum = 0,
    includedMap = {},
    changedIds = [],
    targetId = null,
    reason = 'update',
    ts = Date.now()
  } = {}) {
    this.cart = Array.isArray(cart) ? cart.map((x) => ({ ...x })) : [];
    this.totalCount = Number(totalCount) || 0;
    this.totalSum = Number(totalSum) || 0;
    this.includedMap = includedMap && typeof includedMap === 'object' ? { ...includedMap } : {};
    this.changedIds = Array.isArray(changedIds) ? Array.from(new Set(changedIds.map((x) => String(x)))) : [];
    this.targetId = targetId != null ? String(targetId) : null;
    this.reason = String(reason || 'update');
    this.ts = Number(ts) || Date.now();

    Object.freeze(this.cart);
    Object.freeze(this.includedMap);
    Object.freeze(this.changedIds);
    Object.freeze(this);
  }
}
