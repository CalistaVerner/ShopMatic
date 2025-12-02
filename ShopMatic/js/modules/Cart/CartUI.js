import { MiniCart } from './MiniCart.js';
import { CartBase } from './CartBase.js';
import { CartDOMRefs } from './ui/CartDOMRefs.js';
import { GridListeners } from './ui/GridListeners.js';
import { GridRenderer } from './ui/GridRenderer.js';
import { RowSync } from './ui/RowSync.js';
import { IncludedStates } from './ui/IncludedStates.js';
import { TotalsAndBadges } from './ui/TotalsAndBadges.js';

export class CartUI extends CartBase {
  constructor({ storage, productService, renderer, notifications, favorites = null, opts = {} }) {
    super({ storage, productService, notifications, favorites, opts });

	this.storage = storage;
	this.shopMatic = storage.shopMatic;
    this.renderer = renderer;
    this.opts = opts || {};

    this.dom = new CartDOMRefs(this);
    this.rendererUtils = new GridRenderer(this);
    this.listeners = new GridListeners(this);
    this.rowSync = new RowSync(this);
    this.included = new IncludedStates(this);
    this.totals = new TotalsAndBadges(this);

    this.miniCart = new MiniCart({ renderer: this.renderer, notifications: this.notifications, opts: opts.miniCart });

    this.headerCartNum = null;
	this.headerCartWord = null;
    this.mobileCartNum = null;
    this.cartGrid = null;
    this.cartCountInline = null;
    this.cartTotal = null;
    this.miniCartTotal = null;
	this._checkoutHandler = null;
	this._checkoutAttachedTo = null;

	// опционально: экспортируемые методы для тестов/вызовов извне
	this.bindCheckout = (container) => this._bindCheckout(container);
	this.unbindCheckout = (container) => this._unbindCheckout(container);

	// сразу привяжем к body (или укажите контейнер, в котором находится кнопка)
	this._bindCheckout(); 

    this.masterSelect = null;
    this._masterSelectHandler = null;

    this._gridHandler = null;
    this._gridInputHandler = null;
    this._gridListenersAttachedTo = null;

    this._rowsSyncing = new Set();
    this._changeSourceMap = new Map();

    this.includeStorageKey = (opts && opts.includeStorageKey) || 'cart:included_states';
    this._includedStatesLoaded = false;

    this.setDomRefs = (...a) => this.dom.setDomRefs(...a);
    this.updateCartUI = (...a) => this._updateCartUI(...a);
    this.destroy = () => this._destroy();
	
	
  }

  async _updateCartUI(targetId = null) {
    const overrideIdKey = targetId ? this._normalizeIdKey(targetId) : null;
    const changedIdsSnapshot = overrideIdKey ? [String(overrideIdKey)] : Array.from(this._pendingChangedIds || []);

    this._dedupeCart();
    this._rebuildIndex();

    await this._refreshProducts(overrideIdKey);

    if (!this._includedStatesLoaded) {
      try { this.included.loadIncludedStatesFromLocalStorage(); } catch (e) { this._logError('loadIncludedStates failed', e); }
      this._includedStatesLoaded = true;
    }

    const { totalCount, totalSum } = this.totals.calculateTotals();
    this.totals.updateBadges(totalCount);

    await this.miniCart.render(this.getCart());

    if (this.rendererUtils?.hasGridRenderer()) {
      try {
        if (overrideIdKey) await this.rendererUtils.updateGridSingle(overrideIdKey);
        else await this.rendererUtils.updateGridPartial(changedIdsSnapshot);
      } catch (e) {
        this._logError('grid update failed', e);
        try { await this.rendererUtils.renderFullGrid(); } catch (er) { this._logError('full render failed', er); }
      }
    }

    this.totals.updateTotalsUI(totalCount, totalSum);

    try { this.rendererUtils.finalSyncRows(changedIdsSnapshot); } catch (e) { this._logError('finalSyncRows failed', e); }

    this._scheduleSave();
    this._emitUpdateEvent();

    return { cart: this.getCart(), totalCount, totalSum };
  }

  remove(productId) {
    try {
      const res = super.remove(productId);
      if (res) {
        try { this.included.saveIncludedStatesToLocalStorage(); } catch (e) { this._logError('saveIncludedStates failed', e); }
      }
      return res;
    } catch (e) {
      this._logError('remove override failed', e);
      return false;
    }
  }
  
_bindCheckout(container = document.body) {
  if (!container) return;
  if (this._checkoutHandler && this._checkoutAttachedTo === container) return;
  if (this._checkoutHandler) this._unbindCheckout(this._checkoutAttachedTo);

	window.addEventListener('hashchange', this._handleHashChange.bind(this));

  this._checkoutHandler = (ev) => {
    const btn = ev.target.closest?.('.btn-checkout');
    if (!btn || !container.contains(btn)) return;

    ev.preventDefault();
    ev.stopPropagation();

    try { if (btn.getAttribute && btn.getAttribute('onclick')) btn.removeAttribute('onclick'); } catch {}

    const target = btn.dataset.target || btn.dataset.action || 'checkout';

    const cart = Array.isArray(this.getCart?.()) ? this.getCart() : (Array.isArray(this.cart) ? this.cart : []);
    const isCartEmpty = cart.length === 0;
    const hasSelected = this.included?.countSelected ? this.included.countSelected() > 0 : cart.some(item => Number(item?.qty ?? item?.quantity ?? 0) > 0 || item?.included);

    const warn = (msg) => {
      try {
        if (this.notifications?.show) { this.notifications.show(msg, { type: 'warn' }); return; }
        const summary = document.querySelector('.cart-summary') || document.body;
        if (window.$?.(summary).notify) { window.$(summary).notify(msg, 'warn'); return; }
      } catch {}
      try { alert(msg); } catch {}
    };

    if (isCartEmpty) { warn('Ваша корзина пуста!'); return; }
    if (!hasSelected) { warn('Не выбран ни один товар для оформления!'); return; }

    if (window.foxEngine?.page?.loadPage) {
      try { window.foxEngine.page.loadPage(target); } catch { window.location.href = '/checkout'; }
    } else {
      try { window.location.href = '/checkout'; } catch {}
    }
  };
    if(this.shopMatic.deviceUtil.isMobile) {
		if(window.location.hash.includes('cart')) {
	  const footerMobile = container.querySelector('.menu__content');
	  console.log(footerMobile);
	  const newContent = document.createElement('div');
	  newContent.innerHTML = `
	  <section class="mobileCheckout" id="mobileCheckoutBlock">
	  <a href="#page/checkout" class="btn-checkout">
		  <ul>
			  <li class="mobileProducts">
				<span id="mobileProductCount"></span>
				<span id="mobileProductWord"></span>
			  </li>
			  
			  <li>
				<b>К оформлению</b>
			  </li>
			  
			  <li class="mobilePrice">
				<span id="mobileTotalPrice">0</span>
			  </li>
		  </ul>
	  </a>
	  </section>`;
	  footerMobile.insertBefore(newContent, footerMobile.firstChild);
		}
  }

  container.addEventListener('click', this._checkoutHandler, { passive: false });
  this._checkoutAttachedTo = container;
}

_handleHashChange() {
  const mobileCheckoutBlock = document.getElementById('mobileCheckoutBlock');
  
  // Проверяем, существует ли элемент
  if (mobileCheckoutBlock) {
    if (!window.location.hash.includes('cart')) {
      mobileCheckoutBlock.style.display = 'none';
      this._unbindCheckout(this._checkoutAttachedTo);
    } else {
      mobileCheckoutBlock.style.display = 'block';
    }
  }
}


	_unbindCheckout(container) {
	  if (!this._checkoutHandler) return;
	  try {
		container.removeEventListener('click', this._checkoutHandler);
		container.getElementById('mobileCheckoutBlock').style.display = 'none';
	  } catch (e) { /* ignore */ }
	  this._checkoutHandler = null;
	  this._checkoutAttachedTo = null;
	}


  _destroy() {
    try { this.listeners.detachGridListeners(); } catch (e) { this._logError('detachGridListeners failed', e); }
    try { if (this.masterSelect && this._masterSelectHandler) this.masterSelect.removeEventListener('change', this._masterSelectHandler); } catch (e) { this._logError('masterSelect remove failed', e); }
    try { if (this.miniCart?.destroy) this.miniCart.destroy(); } catch (e) { this._logError('miniCart.destroy failed', e); }
    this._destroyBase();
  }

  async _refreshProducts(overrideIdKey) {
    if (!this.productService || typeof this.productService.findById !== 'function') return;

    const mergeIfResolved = (id, res) => {
      if (!res) return;
      const idx = this._findCartIndexById(id);
      if (idx >= 0) this._mergeProductToItem(this.cart[idx], res, true);
    };

    if (overrideIdKey) {
      const item = this._getCartItemById(overrideIdKey);
      if (!item) return;
      try {
        const prod = this._resolveProduct(overrideIdKey);
        if (this._isThenable(prod)) {
          const resolved = await prod.catch(() => null);
          if (resolved) this._mergeProductToItem(item, resolved, true);
        } else if (prod) this._mergeProductToItem(item, prod, true);
      } catch (e) { this._logError('single product fetch failed', e); }
      return;
    }

    const tasks = this.cart.map((item) => {
      const id = this._normalizeId(item.name);
      try {
        const prod = this._resolveProduct(id);
        if (this._isThenable(prod)) return prod.then(res => ({ id, res })).catch(err => ({ id, res: null, err }));
        return Promise.resolve({ id, res: prod || null });
      } catch (e) {
        return Promise.resolve({ id, res: null, err: e });
      }
    });

    try {
      if (this.opts.parallelProductFetch) {
        const settled = await Promise.allSettled(tasks);
        for (const r of settled) {
          if (r.status === 'fulfilled' && r.value?.res) mergeIfResolved(r.value.id, r.value.res);
          else if (r.status === 'rejected') this._logError('product fetch failed', r.reason);
        }
      } else {
        for (const t of tasks) {
          try {
            const r = await t;
            if (r?.res) mergeIfResolved(r.id, r.res);
          } catch (e) { this._logError('sequential product refresh failed', e); }
        }
      }
    } catch (e) { this._logError('refreshProducts failed', e); }
  }
}