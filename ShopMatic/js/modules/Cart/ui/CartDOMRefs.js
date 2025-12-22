/**
 * @author Calista Verner
 *
 * CartDOMRefs — DOM refs + master select wiring (intent only).
 */
export class CartDOMRefs {
  constructor(ctx) {
    this.ctx = ctx;
  }

  setDomRefs({
    headerCartNum,
    mobileCartNum,
    miniCartList,
    miniCartHeaderTitle,
    cartGrid,
    cartCountInline,
    cartTotal,
    miniCartTotal,
    cartHeader
  } = {}) {
    const c = this.ctx;
    c.headerCartNum = headerCartNum || c.headerCartNum;
    c.mobileCartNum = mobileCartNum || c.mobileCartNum;
    c.cartGrid = cartGrid || c.cartGrid;
    c.cartCountInline = cartCountInline || c.cartCountInline;
    c.cartTotal = cartTotal || c.cartTotal;
    c.miniCartTotal = miniCartTotal || c.miniCartTotal;
    c.cartHeader = cartHeader || c.cartHeader;

    if (!c.masterSelect) this._ensureMasterSelect();

    try {
      c.miniCart.setDomRefs({ listEl: miniCartList, headerTitleEl: miniCartHeaderTitle });
    } catch (e) {
      c._logError('miniCart.setDomRefs failed', e);
    }

    if (c.cartGrid) {
      try { c.listeners.attachGridListeners(); } catch (e) { c._logError('attachGridListeners failed', e); }
    }
  }

  _ensureMasterSelect() {
    const c = this.ctx;
    const header = c.cartHeader || document.querySelector('.cart-header');
    if (!header) return;

    const existing = header.querySelector('input.cart-master-checkbox[data-role="toggle-all"]');
    if (existing) {
      c.masterSelect = existing;

      c._masterSelectHandler = (e) => {
        c.presenter.dispatch({ type: 'INCLUDE_ALL', included: !!e.target.checked });
      };

      existing.addEventListener('change', c._masterSelectHandler);
      try { c.included.updateMasterSelectState(); } catch {}
      return;
    }

    const label = document.createElement('label');
    label.className = 'y-checkbox cart-master-select';
    label.innerHTML = `
      <input type="checkbox" class="cart-master-checkbox" data-role="toggle-all" data-state="full">
      <span class="y-box">
        <svg class="y-icon" viewBox="0 0 24 24" width="24" height="24">
          <path d="M10.003 19 2.503 11.5l1.498-1.501 6.001 6.061 9.5-9.564 1.5 1.5z"></path>
        </svg>
      </span>
      <span class="y-label-text">Выбрать все</span>
    `;

    const input = label.querySelector('input.cart-master-checkbox');
    c.masterSelect = input;

    c._masterSelectHandler = (e) => {
      c.presenter.dispatch({ type: 'INCLUDE_ALL', included: !!e.target.checked });
    };

    input.addEventListener('change', c._masterSelectHandler);

    const subtitle = header.querySelector('.cart-subtitle');
    if (subtitle) subtitle.after(label);
    else header.appendChild(label);

    try { c.included.updateMasterSelectState(); } catch {}
  }
}
