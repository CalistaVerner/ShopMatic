import { MiniCart } from './MiniCart.js';
import { CartBase } from './CartBase.js';
import { CartDOMRefs } from './ui/CartDOMRefs.js';
import { GridListeners } from './ui/GridListeners.js';
import { GridRenderer } from './ui/GridRenderer.js';
import { RowSync } from './ui/RowSync.js';
import { IncludedStates } from './ui/IncludedStates.js';
import { TotalsAndBadges } from './ui/TotalsAndBadges.js';
import { CartPresenter } from './ui/CartPresenter.js';
import { CheckoutController } from './ui/CheckoutController.js';

export class CartUI extends CartBase {
  constructor({ storage, productService, renderer, notifications, favorites = null, opts = {} }) {
    super({ storage, productService, notifications, favorites, opts });

    this.storage = storage;
    this.shopMatic = storage.shopMatic;
    this.foxEngine = this.shopMatic.foxEngine;
    this.renderer = renderer;
    this.opts = opts || {};
    this.eventBus = this.shopMatic.eventBus;

    this.dom = new CartDOMRefs(this);
    this.rendererUtils = new GridRenderer(this);
    this.listeners = new GridListeners(this);
    this.rowSync = new RowSync(this);

    this.includeStorageKey = (opts && opts.includeStorageKey) || 'cart:included_states';
    this.included = new IncludedStates(this, { storageKey: this.includeStorageKey, eventBus: this.eventBus });

    this.totals = new TotalsAndBadges(this);
    this.miniCart = new MiniCart({ renderer: this.renderer, notifications: this.notifications, opts: opts.miniCart });

    this.presenter = new CartPresenter(this);
    this.checkout = new CheckoutController(this);

    // DOM refs
    this.headerCartNum = null;
    this.mobileCartNum = null;
    this.cartGrid = null;
    this.cartCountInline = null;
    this.cartTotal = null;
    this.miniCartTotal = null;
    this.cartHeader = null;

    this.masterSelect = null;
    this._masterSelectHandler = null;

    this._gridHandler = null;
    this._gridInputHandler = null;
    this._gridListenersAttachedTo = null;

    this._includedStatesLoaded = false;

    // external API compatibility
    this.setDomRefs = (...a) => this.dom.setDomRefs(...a);
    this.updateCartUI = (...a) => this.presenter.updateUI(...a);

    // Domain bypass to avoid CartModule overrides recursion
    this._domainAdd = (id, qty) => CartBase.prototype.add.call(this, id, qty);
    this._domainRemove = (id) => CartBase.prototype.remove.call(this, id);
    this._domainChangeQty = (id, qty, o = {}) => CartBase.prototype.changeQty.call(this, id, qty, o);
  }

  /**
   * THE ONLY refresh pipeline (called by presenter).
   */
  async _updateCartUI(targetId = null) {
    const overrideIdKey = targetId ? this._normalizeIdKey(targetId) : null;
    const changedIdsSnapshot = overrideIdKey ? [String(overrideIdKey)] : Array.from(this._pendingChangedIds || []);

    this._dedupeCart();
    this._rebuildIndex();

    await this._refreshProducts(overrideIdKey);

    if (!this._includedStatesLoaded) {
      try { this.included.loadIncludedStatesFromLocalStorage(); } catch (e) { this._logError('loadIncludedStates failed', e); }
      this._includedStatesLoaded = true;
    } else {
      // keep included projected onto items when needed
      try { this.included.applyToItems?.(this.cart); } catch {}
    }

    const { totalCount, totalSum } = this.totals.calculateTotals();
    this.totals.updateBadges(totalCount);

    await this.miniCart.render(this.getCart());

    try {
      if (overrideIdKey) await this.rendererUtils.updateGridSingle(overrideIdKey);
      else await this.rendererUtils.updateGridPartial(changedIdsSnapshot);
    } catch (e) {
      this._logError('grid update failed', e);
      try { await this.rendererUtils.renderFullGrid(); } catch (er) { this._logError('full render failed', er); }
    }

    this.totals.updateTotalsUI(totalCount, totalSum);

    try { this.rendererUtils.finalSyncRows(changedIdsSnapshot); } catch (e) { this._logError('finalSyncRows failed', e); }

    this._scheduleSave();

    try {
      this.eventBus?.emit?.('cartUpdated', { cart: this.getCart(), totalCount, totalSum });
      this.eventBus?.emit?.('cart:updated', { cart: this.getCart(), totalCount, totalSum });
    } catch {}

    return { cart: this.getCart(), totalCount, totalSum };
  }
  
    _msg(key, vars = {}) {
    const pool = this.constructor?.UI_MESSAGES || {};
    const tpl = pool[key] ?? '';
    return String(tpl).replace(/\{([^}]+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
    );
  }

  /**
   * Checkout binds are not CartUI responsibility anymore.
   * Keep compatibility for CartModule constructor.
   */
  _bindCheckout(container = document.body) {
    this.checkout.bind(container);
  }
  
  	_addMobileCheckoutBlock(container = document.body) {
		if (this.shopMatic.deviceUtil.isMobile) {
			if (window.location.hash.includes('cart')) {
				const footerMobile = container.querySelector('.menu__content');
				if (!document.getElementById('mobileCheckoutBlock')) {
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
				} else {}
			}
		}
	}


  _unbindCheckout(container = document.body) {
    this.checkout.unbind(container);
  }

  destroy() {
    try { this.listeners.detachGridListeners(); } catch (e) { this._logError('detachGridListeners failed', e); }
    try { if (this.masterSelect && this._masterSelectHandler) this.masterSelect.removeEventListener('change', this._masterSelectHandler); } catch {}
    try { this.checkout.destroy(); } catch {}
    try { if (this.miniCart?.destroy) this.miniCart.destroy(); } catch {}
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
