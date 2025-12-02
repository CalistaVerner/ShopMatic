/**
 * CartDOMRefs — управление DOM-refs и master-select
 * ctx — ссылка на CartUI
 */
export class CartDOMRefs {
  constructor(ctx) {
    this.ctx = ctx;
  }

  /**
   * Устанавливает DOM-ссылки (позволяет partial init)
   */
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

    // ensure master select exists (create lazily if needed)
    if (!c.masterSelect) this._createMasterSelect();

    // if we created a pending label earlier, insert it near the grid
    if (c._pendingMasterSelectLabel && c.cartGrid && c.cartGrid.parentNode) {
      c.cartGrid.parentNode.insertBefore(c._pendingMasterSelectLabel, c.cartGrid);
      c._pendingMasterSelectLabel = null;
    }

   
      try {
        c.miniCart.setDomRefs({
          listEl: miniCartList,
          headerTitleEl: miniCartHeaderTitle
        });
      } catch (e) {
        c._logError('miniCart.setDomRefs failed', e);
      }

    // attach grid listeners if grid present
    if (c.cartGrid) {
      try {
        c.listeners.attachGridListeners();
      } catch (e) {
        c._logError('attachGridListeners failed', e);
      }
    }
  }

  _createMasterSelect() {
    const c = this.ctx;
    if (c.masterSelect) return;

    const header = document.querySelector('.cart-header');
    if (!header) {
      // header not in DOM yet — postpone
      return;
    }

    // build DOM nodes
    const label = document.createElement('label');
    label.className = 'y-checkbox cart-master-select';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'cart-master-checkbox';
    input.dataset.role = 'toggle-all';
	//input.checked = false;

    const box = document.createElement('span');
    box.className = 'y-box';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('y-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M10.003 19 2.503 11.5l1.498-1.501 6.001 6.061 9.5-9.564 1.5 1.5z');
    svg.appendChild(path);
    box.appendChild(svg);

    const text = document.createElement('span');
    text.className = 'y-label-text';
    text.textContent = 'Выбрать все';

    label.appendChild(input);
    label.appendChild(box);
    label.appendChild(text);

    c.masterSelect = input;

    // handler delegates to IncludedStates.toggleAllIncluded
    c._masterSelectHandler = (e) => {
      try {
        c.included.toggleAllIncluded(!!e.target.checked);
      } catch (err) {
        c._logError('masterSelect handler failed', err);
      }
    };
    input.addEventListener('change', c._masterSelectHandler);

    // insert into header (after subtitle if present)
    const subtitle = header.querySelector('.cart-subtitle');
    if (subtitle) subtitle.after(label);
    else header.appendChild(label);
  }
}
