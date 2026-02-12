/**
 * RouterPolicy: single navigation contract for ShopMatic.
 *
 *  - URL <-> Store synchronization
 *  - UI/modules must NOT write location.hash directly; call router.go()/navigate()
 */
import { ActionTypes } from './Store.js';

export class RouterPolicy {
  constructor(store, opts = {}) {
    this.store = store;
    this.opts = Object.assign(
      {
        hashPrefix: '#',
      },
      opts
    );

    this._isApplyingFromStore = false;
    this._isApplyingFromUrl = false;

    this._onHashChange = this._onHashChange.bind(this);
    this._unsubStore = null;
  }

  init() {
    // URL -> Store
    try {
      window.addEventListener('hashchange', this._onHashChange);
    } catch (e) {
      console.warn('[Router] cannot bind hashchange', e);
    }
    this._onHashChange();

    // Store -> URL
    this._unsubStore = this.store.subscribe((state, action) => {
      if (this._isApplyingFromUrl) return;
      if (!action || (action.type !== ActionTypes.ROUTE_SET && action.type !== ActionTypes.ROUTE_NAVIGATE)) return;

      const route = state && state.route ? state.route : null;
      if (!route) return;

      const hash = this.buildHash(route);
      if (!hash) return;

      if (hash === (window.location.hash || '')) return;

      this._isApplyingFromStore = true;
      try {
        window.location.hash = hash;
      } catch (e) {
        console.warn('[Router] failed to set hash', e);
      } finally {
        this._isApplyingFromStore = false;
      }
    });
  }

  destroy() {
    try {
      window.removeEventListener('hashchange', this._onHashChange);
    } catch {}
    try {
      if (typeof this._unsubStore === 'function') this._unsubStore();
    } catch {}
    this._unsubStore = null;
  }

  go(hash) {
    const h = String(hash || '').trim();
    if (!h) return;

    // Always go through store (single policy point)
    const route = this.parseHash(h);
    this.store.dispatch({ type: ActionTypes.ROUTE_NAVIGATE, payload: route });

    // If store->url sync is disabled/failed, fallback:
    if ((window.location.hash || '') !== h) {
      try {
        window.location.hash = h;
      } catch {}
    }
  }

  toPage(pageName, query = null) {
    const name = String(pageName || '').trim();
    if (!name) return;
    const hash = '#page/' + encodeURIComponent(name) + this._encodeQuery(query);
    this.go(hash);
  }

  toProduct(productId) {
    const id = String(productId || '').trim();
    if (!id) return;
    this.go('#product/' + encodeURIComponent(id));
  }

  // ---------------------------- parsing/building ----------------------------

  _onHashChange() {
    if (this._isApplyingFromStore) return;

    this._isApplyingFromUrl = true;
    try {
      const hash = String(window.location.hash || '');
      const route = this.parseHash(hash);
      this.store.dispatch({ type: ActionTypes.ROUTE_SET, payload: route });
    } finally {
      this._isApplyingFromUrl = false;
    }
  }

  parseHash(hash) {
    const raw = String(hash || '').trim();
    if (!raw || raw === '#') {
      return { kind: 'page', name: 'home', params: {}, query: {} , raw: raw };
    }

    // Split query
    const [path, queryStr] = raw.split('?');
    const query = this._parseQuery(queryStr);

    // #page/<name>
    if (path.startsWith('#page/')) {
      const name = decodeURIComponent(path.slice('#page/'.length) || 'home');
      return { kind: 'page', name, params: {}, query, raw: raw };
    }

    // #product/<id>
    if (path.startsWith('#product/')) {
      const id = decodeURIComponent(path.slice('#product/'.length) || '');
      return { kind: 'product', name: 'product', params: { id }, query, raw: raw };
    }

    // Unknown -> keep as raw; do not break legacy pages.
    return { kind: 'raw', name: 'raw', params: { hash: raw }, query, raw: raw };
  }

  buildHash(route) {
    if (!route) return '#';
    const kind = route.kind || 'page';

    if (kind === 'page') {
      const name = route.name || 'home';
      return '#page/' + encodeURIComponent(name) + this._encodeQuery(route.query);
    }
    if (kind === 'product') {
      const id = route.params && route.params.id ? route.params.id : '';
      return '#product/' + encodeURIComponent(String(id)) + this._encodeQuery(route.query);
    }
    if (kind === 'raw' && route.params && route.params.hash) {
      return String(route.params.hash);
    }
    if (route.raw) return String(route.raw);
    return '#';
  }

  _parseQuery(qs) {
    const out = {};
    if (!qs) return out;
    try {
      const p = new URLSearchParams(qs);
      for (const [k, v] of p.entries()) out[k] = v;
    } catch {}
    return out;
  }

  _encodeQuery(obj) {
    try {
      if (!obj || typeof obj !== 'object') return '';
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(obj)) {
        if (v == null) continue;
        const val = String(v).trim();
        if (!val) continue;
        p.set(k, val);
      }
      const s = p.toString();
      return s ? '?' + s : '';
    } catch {
      return '';
    }
  }
}
