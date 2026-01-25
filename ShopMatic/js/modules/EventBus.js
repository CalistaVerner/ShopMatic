/**
 * Tiny event bus.
 * @author Calista Verner
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._map = new Map();
    /** @type {Set<Function>} */
    this._any = new Set();
  }

  on(event, handler) {
    if (typeof handler !== 'function') return () => {};
    const key = String(event || '').trim();
    if (!key) return () => {};
    let set = this._map.get(key);
    if (!set) {
      set = new Set();
      this._map.set(key, set);
    }
    set.add(handler);
    return () => this.off(key, handler);
  }

  onAny(handler) {
    if (typeof handler !== 'function') return () => {};
    this._any.add(handler);
    return () => this._any.delete(handler);
  }

  off(event, handler) {
    const key = String(event || '').trim();
    const set = this._map.get(key);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this._map.delete(key);
  }

  emit(event, payload) {
    const key = String(event || '').trim();
    if (!key) return;

    const set = this._map.get(key);
    if (set) {
      for (const fn of Array.from(set)) {
        try { fn(payload); } catch (e) { console.warn('[EventBus] handler error', e); }
      }
    }

    if (this._any.size) {
      for (const fn of Array.from(this._any)) {
        try { fn(key, payload); } catch (e) { console.warn('[EventBus] onAny error', e); }
      }
    }
  }

  clear() {
    this._map.clear();
    this._any.clear();
  }
}
