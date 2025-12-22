/**
 * @author Calista Verner
 *
 * CheckoutController — isolated checkout / hash logic.
 * Responsibilities:
 *  - Bind/unbind checkout click
 *  - Mobile checkout block lifecycle
 *  - No cart mutations; reads state only via ctx
 */
export class CheckoutController {
  constructor(ctx) {
    this.ctx = ctx;
    this._handler = null;
    this._attachedTo = null;
    this._hashHandler = null;
  }

  bind(container = document.body) {
    const c = this.ctx;
    if (!container) return;
    if (this._handler && this._attachedTo === container) return;
    if (this._handler) this.unbind(this._attachedTo);

    this._ensureMobileCheckoutBlock(container);

    this._hashHandler = () => this._handleHashChange(container);
    try { window.addEventListener('hashchange', this._hashHandler); } catch {}

    this._handler = (ev) => {
      const btn = ev.target?.closest?.('.btn-checkout');
      if (!btn || !container.contains(btn)) return;

      ev.preventDefault();
      ev.stopPropagation();

      try { if (btn.getAttribute && btn.getAttribute('onclick')) btn.removeAttribute('onclick'); } catch {}

      const target = btn.dataset.target || btn.dataset.action || 'checkout';
      const cart = Array.isArray(c.getCart?.()) ? c.getCart() : (Array.isArray(c.cart) ? c.cart : []);
      const isEmpty = cart.length === 0;

      // included selection check
      const hasSelected = c.included?.countSelected
        ? c.included.countSelected(cart) > 0
        : cart.some((it) => !!it?.included);

      const warn = (msg) => {
        try { c.notifications?.show?.(msg, { type: 'warn' }); return; } catch {}
        try { alert(msg); } catch {}
      };

      if (isEmpty) { warn('Ваша корзина пуста!'); return; }
      if (!hasSelected) { warn('Не выбран ни один товар для оформления!'); return; }

      try { c.foxEngine?.page?.loadPage?.(target); }
      catch { window.location.href = '/checkout'; }
    };

    container.addEventListener('click', this._handler, { passive: false });
    this._attachedTo = container;
  }

  unbind(container) {
    if (!this._handler) return;

    try { container?.removeEventListener?.('click', this._handler); } catch {}
    this._handler = null;
    this._attachedTo = null;

    try { if (this._hashHandler) window.removeEventListener('hashchange', this._hashHandler); } catch {}
    this._hashHandler = null;

    try {
      const block = document.getElementById('mobileCheckoutBlock');
      if (block) block.style.display = 'none';
    } catch {}
  }

  destroy() {
    this.unbind(this._attachedTo);
  }

  _handleHashChange(container) {
    try {
      const block = document.getElementById('mobileCheckoutBlock');
      if (!block) return;

      if (!window.location.hash.includes('cart')) {
        block.style.display = 'none';
        this.unbind(container);
      } else {
        block.style.display = 'block';
      }
    } catch {}
  }

  _ensureMobileCheckoutBlock(container = document.body) {
    const c = this.ctx;
    if (!c.shopMatic?.deviceUtil?.isMobile) return;
    if (!window.location.hash.includes('cart')) return;

    const footerMobile = container.querySelector?.('.menu__content');
    if (!footerMobile) return;

    if (document.getElementById('mobileCheckoutBlock')) return;

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <section class="mobileCheckout" id="mobileCheckoutBlock">
        <a href="#page/checkout" class="btn-checkout">
          <ul>
            <li class="mobileProducts">
              <span id="mobileProductCount"></span>
              <span id="mobileProductWord"></span>
            </li>
            <li><b>К оформлению</b></li>
            <li class="mobilePrice">
              <span id="mobileTotalPrice">0</span>
            </li>
          </ul>
        </a>
      </section>
    `;
    footerMobile.insertBefore(wrap, footerMobile.firstChild);
  }
}
