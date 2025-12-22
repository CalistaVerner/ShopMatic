// card-dom-helper.js
export class CardDomHelper {
  constructor(card) {
    this.card = card;
  }

  get limitMsgClass() {
    return this.card._limitMsgClass;
  }

  sel(root, selector) {
    return root?.querySelector?.(selector) ?? null;
  }

  toggleDisabled(el, disabled) {
    if (!el) return;
    el.disabled = !!disabled;
    if (el.toggleAttribute) el.toggleAttribute('aria-disabled', !!disabled);
  }

  createLimitMsg(text) {
    const d = document.createElement('div');
    d.className = this.limitMsgClass;
    d.textContent = text;
    d.style.cssText = 'transition:opacity .25s ease;opacity:0;';
    return d;
  }

  getCardSelectors(cardEl) {
    return {
      leftNum: this.sel(cardEl, '.leftNum'),
      stock: this.sel(cardEl, '.stock'),
      buyBtn: this.sel(cardEl, '[data-role="buy"], [data-action="buy"], .btn-buy'),
      buyNow: this.sel(cardEl, '[data-role="buy-now"], [data-action="buy-now"], .buyNow'),
      incrBtn: this.sel(cardEl, '[data-role="qty-plus"], .qty-incr, [data-action="qty-incr"]'),
      decrBtn: this.sel(cardEl, '[data-role="qty-minus"], .qty-decr, [data-action="qty-decr"]'),
      qtyInput: this.sel(cardEl, '[data-role="qty-input"], .qty-input, input[type="number"]'),
      controlsWrapper: this.sel(cardEl, '.card-controls') || cardEl,
      inputControls: this.sel(cardEl, '.qty-controls')
    };
  }
}
