// shopmatic/MiniCart.js
export class MiniCart {
  /**
   * @param {Object} deps
   * @param {Renderer} deps.renderer - instance with method _createMiniCartItemHTML(item, foxEngine)
   * @param {Notifications} deps.notifications - optional notifications module
   * @param {Object} deps.opts - options
   */
  constructor({ renderer, notifications = null, opts = {} } = {}) {
    this.renderer = renderer;
    this.notifications = notifications;
    this.opts = Object.assign({
      emptyText: 'Корзина пуста',
      emptyIconClass: 'fa-solid fa-cart-shopping'
    }, opts);

    // DOM refs
    this.listEl = null;               // ul/ol container for mini cart items
    this.headerTitleEl = null;        // optional header title element to show count

    // internals
    this._lastRenderHash = '';        // simple heuristic to avoid re-render when nothing changed
  }

  setDomRefs({ listEl, headerTitleEl } = {}) {
    this.listEl = listEl || this.listEl;
    this.headerTitleEl = headerTitleEl || this.headerTitleEl;
  }

  _computeHash(cart) {
    // lightweight hash: ids + qty joined - good enough to skip identical renders
    if (!Array.isArray(cart) || cart.length === 0) return '';
    return cart.map(i => `${i.name}:${i.qty}`).join('|');
  }

  async render(cart = []) {
    if (!this.listEl) return;
    const currentHash = this._computeHash(cart);
    if (currentHash && currentHash === this._lastRenderHash) {
      // nothing changed — skip re-render
      return;
    }
    this._lastRenderHash = currentHash;

    // Clear existing
    while (this.listEl.firstChild) this.listEl.removeChild(this.listEl.firstChild);

    // Render fallback for empty
    if (!Array.isArray(cart) || cart.length === 0) {
      const li = document.createElement('li');
      li.className = 'cart-item empty';
      li.innerHTML = `<div class="ps-product--mini-cart"><div class="ps-product__content"><div class="ps-product__name">${this.opts.emptyText} <i class="${this.opts.emptyIconClass}"></i></div></div></div>`;
      this.listEl.appendChild(li);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const it of cart) {
      try {
        const liHTML = (typeof this.renderer?._createMiniCartItemHTML === 'function')
          ? await this.renderer._createMiniCartItemHTML(it, this.renderer.foxEngine)
          : `<li class="cart-item"><div>${escapeHtml(it.fullname || it.name)} × ${escapeHtml(String(it.qty || 0))}</div></li>`;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = liHTML.trim();
        const el = wrapper.firstElementChild;
        if (el) frag.appendChild(el);
      } catch (e) {
        // on error fallback to a simple li
        const li = document.createElement('li');
        li.className = 'cart-item';
        li.textContent = `${it.fullname || it.name} × ${it.qty || 0}`;
        frag.appendChild(li);
      }
    }
    this.listEl.appendChild(frag);
  }

  updateHeader(totalCount) {
    if (!this.headerTitleEl) return;
    try {
      const base = (this.headerTitleEl.textContent || '').replace(/\(.+\)/, '').trim() || 'Корзина';
      this.headerTitleEl.textContent = `${base} (${totalCount})`;
    } catch (e) { /* ignore */ }
  }

  destroy() {
    this.listEl = null;
    this.headerTitleEl = null;
    this.renderer = null;
    this.notifications = null;
    this._lastRenderHash = '';
  }
}

/* helper: small escape if renderer fallback used (kept internal) */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
