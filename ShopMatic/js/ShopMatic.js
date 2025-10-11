import { ProductService } from './modules/ProductService.js';
import { StorageService } from './modules/StorageService.js';
import { Notifications } from './modules/Notifications.js';
import { Renderer } from './modules/Renderer.js';
import { CartModule } from './modules/CartModule.js';
import { FavoritesModule } from './modules/FavoritesModule.js';
import { debounce } from './modules/utils.js';

export class ShopMatic {
  constructor(foxEngine, opts = {}) {
    if (!foxEngine) throw new Error('foxEngine is required');
    this.foxEngine = foxEngine;
    this.opts = Object.assign({
      itemsId: 'items',
      categoryFilterId: 'categoryFilter',
      searchId: 'search',
      sortId: 'sort',
      searchBtnId: 'searchBtn',
      cartGridId: 'cart-grid',
      cartCountInlineId: 'cart-count-inline',
      cartTotalId: 'cart-total',
      miniCartListId: 'miniCart',
      headerCartNumId: 'cartNum',
      miniCartHeaderTitleId: 'miniCartHeaderTitle',
      productsCountId: 'productsCount',
      storageKey: 'gribkov_cart_v1',
      favStorageKey: 'gribkov_favs_v1',
      notificationDuration: 3000
    }, opts);

    // modules
    this.productService = new ProductService(this.foxEngine);
    this.storage = new StorageService({ storageKey: this.opts.storageKey, favStorageKey: this.opts.favStorageKey });
    this.notifications = new Notifications();

    // IMPORTANT: disable auto-sync inside FavoritesModule (we handle storage events centrally)
    this.favorites = new FavoritesModule({ storage: this.storage, opts: { sync: false } });

    this.renderer = new Renderer({ foxEngine: this.foxEngine, productService: this.productService, favorites: this.favorites });
    this.cart = new CartModule({
      storage: this.storage,
      productService: this.productService,
      renderer: this.renderer,
      notifications: this.notifications,
      favorites: this.favorites,
      opts: this.opts
    });

    // DOM refs (populated in init)
    this.root = null;
    this.catFilter = null;
    this.search = null;
    this.sort = null;
    this.searchBtn = null;
    this.productsCount = null;

    // subscription handle for favorites
    this._favsUnsub = null;

    // delegation handlers (will be set in _bindCardDelegation)
    this._delegationHandler = null;
    this._qtyInputHandler = null;

    // bound handlers
    this._bound = {
      onStorage: this._onStorageEvent.bind(this),
      onSearchInput: debounce(this._onSearchInput.bind(this), 300),
      onCatChange: this._onCatChange.bind(this),
      onSortChange: this._onSortChange.bind(this),
      onSearchBtn: this._onSearchBtn.bind(this),
      onCartUpdated: this._onCartUpdated.bind(this)
    };
  }

  /* ================== Lifecycle ================== */

  async init() {
    // DOM refs
    this.root = document.getElementById(this.opts.itemsId);
    this.catFilter = document.getElementById(this.opts.categoryFilterId);
    this.search = document.getElementById(this.opts.searchId);
    this.sort = document.getElementById(this.opts.sortId);
    this.searchBtn = document.getElementById(this.opts.searchBtnId);
    const cartGridEl = document.getElementById(this.opts.cartGridId);
    const cartCountInlineEl = document.getElementById(this.opts.cartCountInlineId);
    const cartTotalEl = document.getElementById(this.opts.cartTotalId);
    const miniCartListEl = document.getElementById(this.opts.miniCartListId);
    const headerCartNumEl = document.getElementById(this.opts.headerCartNumId);
    const miniCartHeaderTitleEl = document.getElementById(this.opts.miniCartHeaderTitleId);
    this.productsCount = document.getElementById(this.opts.productsCountId);

    // pass DOM refs to cart module via unified API
    this.cart.setDomRefs({
      headerCartNum: headerCartNumEl,
      miniCartList: miniCartListEl,
      miniCartHeaderTitle: miniCartHeaderTitleEl,
      cartGrid: cartGridEl,
      cartCountInline: cartCountInlineEl,
      cartTotal: cartTotalEl
    });

    // load products
    await this.productService.loadProductsSimple();

    // fill categories select
    await this.productService.fillCategories(this.catFilter);

    // load persisted state
    this.favorites.loadFromStorage();
    this.cart.loadFromStorage();

    // subscribe favorites changes -> update UI (cards + wish counter)
    // Subscribe returns unsubscribe function
    this._favsUnsub = this.favorites.subscribe((evt) => {
      // update all rendered product cards' fav state
      if (this.root) {
        const allCards = this.root.querySelectorAll('[data-product-id]');
        allCards.forEach(card => {
          const pid = card.getAttribute('data-product-id');
          this.renderer.updateProductCardFavState(this.root, pid, this.favorites.isFavorite(pid));
        });
      }
      // update wish count UI element (absolute)
      const wishEl = document.getElementById('wishNum');
	  wishEl.style.display = this.favorites.getCount() > 0 ? 'inline-flex' : 'none';
      if (wishEl) wishEl.textContent = String(this.favorites.getCount());
    });

    // bind storage events + UI events
    window.addEventListener('storage', this._bound.onStorage);
    window.addEventListener('cart:updated', this._bound.onCartUpdated);
    if (this.search) this.search.addEventListener('input', this._bound.onSearchInput);
    if (this.catFilter) this.catFilter.addEventListener('change', this._bound.onCatChange);
    if (this.sort) this.sort.addEventListener('change', this._bound.onSortChange);
    if (this.searchBtn) this.searchBtn.addEventListener('click', this._bound.onSearchBtn);

    // initial render
    await this.applyFilters();
    await this.cart.updateCartUI();

    // expose for debug (use public API)
    window._SHOPMATIC = {
      cart: this.cart.cart,
      products: this.productService.products,
      favs: this.favorites.getAll ? this.favorites.getAll() : []
    };

    // attach delegated UI behavior for cards in root (fav and buy) — uses event delegation
    this._bindCardDelegation();

    // ensure initial controls state (disable buy when nothing available)
    this._syncAllCardsControls();
  }

  destroy() {
    window.removeEventListener('storage', this._bound.onStorage);
    window.removeEventListener('cart:updated', this._bound.onCartUpdated);
    if (this.search) this.search.removeEventListener('input', this._bound.onSearchInput);
    if (this.catFilter) this.catFilter.removeEventListener('change', this._bound.onCatChange);
    if (this.sort) this.sort.removeEventListener('change', this._bound.onSortChange);
    if (this.searchBtn) this.searchBtn.removeEventListener('click', this._bound.onSearchBtn);
    // remove delegated handler
    if (this._delegationHandler && this.root) this.root.removeEventListener('click', this._delegationHandler);
    if (this._qtyInputHandler && this.root) this.root.removeEventListener('input', this._qtyInputHandler);
    // unsubscribe favorites subscriber
    if (typeof this._favsUnsub === 'function') {
      try { this._favsUnsub(); } catch (e) { /* ignore */ }
      this._favsUnsub = null;
    }
    // if favorites exposes destroy, call it
    if (this.favorites && typeof this.favorites.destroy === 'function') {
      try { this.favorites.destroy(); } catch (e) { /* ignore */ }
    }
    // destroy cart (which contains miniCart internally)
    if (this.cart && typeof this.cart.destroy === 'function') {
      try { this.cart.destroy(); } catch (e) { /* ignore */ }
    }
  }

  /* ================== Helpers ================== */

  // Normalize getting product id from element
  _getIdFromElement(el) {
    if (!el) return null;
    if (!el.getAttribute) return null;
    return el.getAttribute('data-product-id') ||
           el.getAttribute('data-id') ||
           el.getAttribute('data-name') ||
           el.getAttribute('data-cart-id') ||
           el.getAttribute('data-item-id') || null;
  }

  // учитывает количество уже в корзине и возвращает доступный остаток (>=0)
  _computeAvailableStock(id) {
    if (!id) return 0;
    const prod = this.productService && typeof this.productService.findById === 'function' ? this.productService.findById(id) : null;
    const totalStock = Number(prod && prod.stock ? prod.stock : 0);
    // сколько уже в корзине (если есть)
    const inCartQty = (this.cart && Array.isArray(this.cart.cart)) ? (this.cart.cart.find(i => String(i.name) === String(id))?.qty || 0) : 0;
    const available = Math.max(0, totalStock - inCartQty);
    return available;
  }

  // Sync controls (buy button, incr, input) for a single card element
  _syncCardControlsState(card) {
    if (!card) return;
    const id = this._getIdFromElement(card);
    if (!id) return;
    const leftNum = card.querySelector && card.querySelector('.leftNum');

    const buyBtn = card.querySelector && (card.querySelector('[data-role="buy"], [data-action="buy"], .btn-buy'));
    const incrBtn = card.querySelector && (card.querySelector('[data-role="qty-plus"], .qty-incr, [data-action="qty-incr"]'));
    const decrBtn = card.querySelector && (card.querySelector('[data-role="qty-minus"], .qty-decr, [data-action="qty-decr"]'));
    const qtyInput = card.querySelector && (card.querySelector('[data-role="qty-input"], .qty-input, input[type="number"]'));

    const available = this._computeAvailableStock(id);
    if (leftNum) leftNum.textContent = String(available);
    const hasAvailable = available > 0;

    // buy button
    if (buyBtn) {
      buyBtn.disabled = !hasAvailable;
      if (!hasAvailable) buyBtn.setAttribute('aria-disabled', 'true');
      else buyBtn.removeAttribute('aria-disabled');
    }

    // incr button
    if (incrBtn) {
      // disable when nothing available OR when input value already equals available
      let currentVal = qtyInput ? parseInt(qtyInput.value || '0', 10) : 0;
      if (isNaN(currentVal)) currentVal = 0;
      const disableIncr = !hasAvailable || (currentVal >= available);
      incrBtn.disabled = disableIncr;
      if (disableIncr) incrBtn.setAttribute('aria-disabled', 'true'); else incrBtn.removeAttribute('aria-disabled');
    }

    // optionally disable qty input if nothing available (keeps UX clear)
    if (qtyInput) {
      if (!hasAvailable) {
        qtyInput.disabled = true;
        qtyInput.setAttribute('aria-disabled', 'true');
        // show 0 so user sees none available (optional)
        qtyInput.value = '0';
      } else {
        qtyInput.disabled = false;
        qtyInput.removeAttribute('aria-disabled');
        // clamp input value to available if needed
        let val = parseInt(qtyInput.value || '1', 10);
        if (isNaN(val) || val < 1) val = 1;
        if (val > available) val = available;
        qtyInput.value = String(val);
      }
    }

    // decr button: always enabled if qtyInput > 1
    if (decrBtn && qtyInput) {
      let v = parseInt(qtyInput.value || '0', 10);
      decrBtn.disabled = v <= 1;
      if (decrBtn.disabled) decrBtn.setAttribute('aria-disabled', 'true'); else decrBtn.removeAttribute('aria-disabled');
    }

    // --- Показываем сообщение о лимите ---
    let limitMsg = card.querySelector && card.querySelector('.product-limit-msg');
    if (available <= 0) {
      if (!limitMsg) {
        limitMsg = document.createElement('div');
        limitMsg.className = 'product-limit-msg';
        limitMsg.textContent = 'У вас уже максимум в корзине';
        limitMsg.style.cssText = `
          margin-top: 6px;
          font-size: 13px;
          color: #c62828;
          font-weight: 500;
          text-align: center;
          transition: opacity 0.3s ease;
          opacity: 0;
        `;
        const controls = card.querySelector('.card-controls') || card;
        controls.appendChild(limitMsg);
        // Плавное появление
        requestAnimationFrame(() => { limitMsg.style.opacity = '1'; });
      }
    } else if (limitMsg) {
      // Удаляем, если лимит исчез
      limitMsg.style.opacity = '0';
      setTimeout(() => {
        if (limitMsg && limitMsg.parentNode) limitMsg.parentNode.removeChild(limitMsg);
      }, 300);
    }
  }

  // Sync all rendered cards in root
  _syncAllCardsControls() {
    if (!this.root) return;
    const cards = Array.from(this.root.querySelectorAll('[data-product-id]'));
    cards.forEach(card => this._syncCardControlsState(card));
  }

  /* ================== Delegation: fav / buy / qty controls ================== */

  _bindCardDelegation() {
    if (!this.root) return;

    // helper: find qty input and +/- buttons within a card/row element
    const findQtyControls = (container) => {
      if (!container) return { input: null, incr: null, decr: null, buy: null };
      const input = container.querySelector && (container.querySelector('[data-role="qty-input"], .qty-input, input[type="number"]'));
      const incr = container.querySelector && (container.querySelector('[data-role="qty-plus"], .qty-incr, [data-action="qty-incr"]'));
      const decr = container.querySelector && (container.querySelector('[data-role="qty-minus"], .qty-decr, [data-action="qty-decr"]'));
      const buy = container.querySelector && (container.querySelector('[data-role="buy"], [data-action="buy"], .btn-buy'));
      return { input, incr, decr, buy };
    };

    // Validate and clamp qty to [1, available], update input value and enable/disable incr
    const clampAndApplyQty = (inputEl, id) => {
      if (!inputEl) return;
      let v = parseInt(inputEl.value || '1', 10);
      if (isNaN(v) || v < 1) v = 1;

      // available = stock - alreadyInCart
      const available = this._computeAvailableStock(id);
      const maxStock = Number.isFinite(available) ? Math.max(0, available) : 0;

      if (v > maxStock) v = maxStock;
      inputEl.value = String(v);

      // update incr button state if present (find parent container)
      const parent = inputEl.closest('[data-product-id], [data-id], [data-name], .cart-row, li') || inputEl.parentElement;
      const { incr, buy } = findQtyControls(parent);
      if (incr) {
        const disabled = (maxStock === 0) || (v >= maxStock);
        incr.disabled = disabled;
        if (disabled) incr.setAttribute('aria-disabled', 'true'); else incr.removeAttribute('aria-disabled');
      }
      if (buy) {
        const buyDisabled = (maxStock === 0);
        buy.disabled = buyDisabled;
        if (buyDisabled) buy.setAttribute('aria-disabled', 'true'); else buy.removeAttribute('aria-disabled');
      }
      return v;
    };

    // Click delegation
    this._delegationHandler = (ev) => {
      const target = ev.target;

      // Prefer to discover containing card/row early
      const card = (target.closest && target.closest('[data-product-id], [data-id], [data-name], [data-cart-id], [data-item-id]')) || null;
      const idFromCard = this._getIdFromElement(card);

      // ---------- Favorite ----------
      const favBtn = target.closest && target.closest('[data-role="fav"], .fav-btn');
      if (favBtn && this.root.contains(favBtn)) {
        ev.stopPropagation();
        const cardForFav = favBtn.closest && favBtn.closest('[data-product-id], [data-id], [data-name], [data-cart-id], [data-item-id]');
        const id = this._getIdFromElement(cardForFav) || idFromCard;
        const now = this.favorites.toggle(id);

        // immediate visual update
        this.renderer.updateProductCardFavState(this.root, id, now);

        // absolute wish counter update
        const wishEl = document.getElementById('wishNum');
        if (wishEl && typeof this.favorites.getCount === 'function') wishEl.textContent = String(this.favorites.getCount());

        const icon = favBtn.querySelector && favBtn.querySelector('i');
        if (icon) {
          icon.classList.add('animate-pop');
          setTimeout(() => icon.classList.remove('animate-pop'), 380);
        }
        return;
      }

      // ---------- Buy (add to cart) ----------
      const buyBtn = target.closest && target.closest('[data-role="buy"], [data-action="buy"], .btn-buy');
      if (buyBtn && this.root.contains(buyBtn)) {
        ev.stopPropagation();
        const cardForBuy = buyBtn.closest && buyBtn.closest('[data-product-id], [data-id], [data-name]');
        const id = this._getIdFromElement(cardForBuy) || idFromCard;
        const { input } = findQtyControls(cardForBuy || card);
        const desired = input ? Math.max(1, parseInt(input.value || 1, 10)) : 1;
        const available = this._computeAvailableStock(id);

        if (available <= 0) {
          // nothing can be added
          this.notifications.show('Невозможно добавить: нет доступного остатка.', { duration: this.opts.notificationDuration });
          // sync UI in case state changed
          this._syncAllCardsControls();
          return;
        }

        const qtyToAdd = Math.min(desired, available);

        if (qtyToAdd < desired) {
          // notify about partial add
          this.notifications.show(
            `В корзину добавлено ${qtyToAdd} шт. (доступно ${available}).`,
            { duration: this.opts.notificationDuration }
          );
        } else {
          // optionally show success later (CartModule may also show)
        }

        // call cart module with corrected qty
        const res = this.cart.add(id, qtyToAdd);
        // update will be reflected via cart:updated event (which we listen to)
        if (res && typeof res.then === 'function') {
          res.then(() => {
            // ensure cart UI updated (CartModule handles this), but keep a safety sync of card controls
            this._syncCardControlsState(cardForBuy || card);
          }).catch(() => {
            this._syncCardControlsState(cardForBuy || card);
          });
        } else {
          // sync that single card immediately
          this._syncCardControlsState(cardForBuy || card);
        }
        return;
      }

      // ---------- Quantity decrement ----------
      const decrBtn = target.closest && target.closest('[data-role="qty-minus"], .qty-decr, [data-action="qty-decr"]');
      if (decrBtn && this.root.contains(decrBtn)) {
        ev.stopPropagation();
        const row = decrBtn.closest('[data-product-id], [data-id], [data-name], .cart-row') || decrBtn.closest('li') || decrBtn.parentElement;
        const id = this._getIdFromElement(row) || idFromCard;
        const { input, incr } = findQtyControls(row);
        if (!input) return;
        let newVal = Math.max(1, parseInt(input.value || '1', 10) - 1);
        // clamp to available as safety
        const available = this._computeAvailableStock(id);
        const maxStock = Number.isFinite(available) ? Math.max(0, available) : 0;
        if (newVal > maxStock) newVal = maxStock;
        input.value = String(newVal);
        // enable incr if was disabled and now below stock
        if (incr) {
          const disabled = (maxStock === 0) || (newVal >= maxStock);
          incr.disabled = disabled;
          if (disabled) incr.setAttribute('aria-disabled', 'true'); else incr.removeAttribute('aria-disabled');
        }
        const res = this.changeQty(id, newVal);
        if (res && typeof res.then === 'function') {
          res.then(() => { /* cart:updated will be handled */ }).catch(() => { /* ignore*/ });
        }
        // sync only this card
        this._syncCardControlsState(row);
        return;
      }

      // ---------- Quantity increment ----------
      const incrBtn = target.closest && target.closest('[data-role="qty-plus"], .qty-incr, [data-action="qty-incr"]');
      if (incrBtn && this.root.contains(incrBtn)) {
        ev.stopPropagation();
        const row = incrBtn.closest('[data-product-id], [data-id], [data-name], .cart-row') || incrBtn.closest('li') || incrBtn.parentElement;
        const id = this._getIdFromElement(row) || idFromCard;
        const { input } = findQtyControls(row);
        if (!input) return;

        const available = this._computeAvailableStock(id);
        const maxStock = Number.isFinite(available) ? Math.max(0, available) : 0;

        let newVal = Math.min(maxStock, parseInt(input.value || '1', 10) + 1);
        if (isNaN(newVal) || newVal < 1) newVal = 1;

        // if available is 0, newVal becomes 0 -> set 0 to show none available
        input.value = String(newVal);

        // disable incr when hitting stock limit
        const disabled = (maxStock === 0) || (newVal >= maxStock);
        incrBtn.disabled = disabled;
        if (disabled) incrBtn.setAttribute('aria-disabled', 'true'); else incrBtn.removeAttribute('aria-disabled');

        // If stock is zero, also disable buy
        const { buy } = findQtyControls(row);
        if (buy) {
          const buyDisabled = (maxStock === 0);
          buy.disabled = buyDisabled;
          if (buyDisabled) buy.setAttribute('aria-disabled', 'true'); else buy.removeAttribute('aria-disabled');
        }

        const res = this.changeQty(id, newVal);
        if (res && typeof res.then === 'function') {
          res.then(() => { /* cart:updated will be handled */ }).catch(() => { /* ignore*/ });
        }
        // sync only this card
        this._syncCardControlsState(row);
        return;
      }

      // Other clicks — no action here
    };

    // Input delegation: validate manual typing in qty inputs and update incr/buy state
    this._qtyInputHandler = (ev) => {
      const input = ev.target;
      if (!input || !(input.matches && input.matches('[data-role="qty-input"], .qty-input, input[type="number"]'))) return;
      const row = input.closest('[data-product-id], [data-id], [data-name], .cart-row') || input.parentElement;
      const id = this._getIdFromElement(row);
      const clamped = clampAndApplyQty(input, id);
      // update cart if user typed a new valid value
      if (clamped !== undefined) {
        const res = this.changeQty(id, clamped);
        if (res && typeof res.then === 'function') {
          res.then(() => { /* cart:updated will be handled */ }).catch(() => { /* ignore */ });
        }
        // sync only this card
        this._syncCardControlsState(row);
      }
    };

    // Attach listeners
    this.root.addEventListener('click', this._delegationHandler, { passive: true });
    // input should not be passive
    this.root.addEventListener('input', this._qtyInputHandler);
  }

  /* ================== Storage / events ================== */

  _onStorageEvent(e) {
    if (!e) return;
    if (e.key === this.opts.storageKey) {
      this.cart.loadFromStorage();
      this.cart.updateCartUI();
      // sync card controls when cart changed from another tab
      this._syncAllCardsControls();
    }
    if (e.key === this.opts.favStorageKey) {
      // reload favorites and allow subscription handler to update UI
      this.favorites.loadFromStorage();
      // fallback: if subscription hasn't updated cards for any reason, update here
      if (this.root) {
        const allCards = this.root.querySelectorAll('[data-product-id]');
        allCards.forEach(card => {
          const pid = card.getAttribute('data-product-id');
          this.renderer.updateProductCardFavState(this.root, pid, this.favorites.isFavorite(pid));
        });
      }
      // update wish counter
      const wishEl = document.getElementById('wishNum');
      if (wishEl) wishEl.textContent = String(this.favorites.getCount());
    }
  }

  // Handle cart:updated events from CartModule (detail.changedIds expected)
  _onCartUpdated(e) {
    try {
      const detail = e && e.detail ? e.detail : {};
      const changedIds = Array.isArray(detail.changedIds) ? detail.changedIds : [];
      if (!this.root || !changedIds.length) {
        // if no changedIds, fallback to syncing all cards
        this._syncAllCardsControls();
        return;
      }
      // update only cards that changed
      changedIds.forEach(id => {
        if (!id) return;
        const selector = `[data-product-id="${(typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(String(id)) : String(id).replace(/"/g, '\\"')}"]`;
        const card = this.root.querySelector(selector);
        if (card) this._syncCardControlsState(card);
      });
    } catch (err) {
      // failure fallback
      this._syncAllCardsControls();
    }
  }

  /* ================== Filters / render ================== */

  async applyFilters() {
    let list = this.productService.getProducts();
    list = Array.isArray(list) ? [...list] : [];

    const s = (this.search && this.search.value || '').trim().toLowerCase();
    if (s) {
      list = list.filter(p => (
        String(p.fullname || p.title || p.name || '').toLowerCase().includes(s) ||
        String(p.short || '').toLowerCase().includes(s) ||
        String(p.category || '').toLowerCase().includes(s)
      ));
    }

    const c = (this.catFilter && this.catFilter.value) || '';
    if (c) list = list.filter(p => p.category === c);

    const so = (this.sort && this.sort.value) || '';
    if (so === 'price_asc') list.sort((a, b) => (a.price || 0) - (b.price || 0));
    if (so === 'price_desc') list.sort((a, b) => (b.price || 0) - (a.price || 0));

    if (this.productsCount) this.productsCount.textContent = String(list.length);

    // Рендерим карточки
    await this.renderer.render(list, this.root);

    // --- ВАЖНО: обновляем состояние избранного для всех карточек ---
    if (this.root && this.favorites) {
      const allCards = this.root.querySelectorAll('[data-product-id]');
      allCards.forEach(card => {
        const pid = card.getAttribute('data-product-id');
        const isFav = this.favorites.isFavorite(pid);
        this.renderer.updateProductCardFavState(this.root, pid, isFav);
      });
    }

    // --- Обновляем доступность контролов ---
    this._syncAllCardsControls();
  }

  _onSearchInput() { this.applyFilters(); }
  _onCatChange() { this.applyFilters(); }
  _onSortChange() { this.applyFilters(); }
  _onSearchBtn() { this.applyFilters(); }

  /* ================== Helpers / UI utils ================== */

  // Note: legacy helper kept for compatibility; prefer using favorites.getCount()
  _updateWishCountUI(deltaOrAbsolute, absolute = false) {
    const el = document.getElementById('wishNum');
    if (!el) return;
    if (absolute) {
      el.textContent = String(deltaOrAbsolute ?? (this.favorites.getCount ? this.favorites.getCount() : 0));
      return;
    }
    const cur = parseInt(el.innerText || el.textContent || '0', 10) || 0;
    el.textContent = String(Math.max(0, cur + (Number(deltaOrAbsolute) || 0)));
  }

  /* ================== Public API (delegates) ================== */

  addToCart(id, qty = 1) {
    const desired = Math.max(1, parseInt(qty || 1, 10));
    const available = this._computeAvailableStock(id);
    if (available <= 0) {
      this.notifications.show('Невозможно добавить: нет доступного остатка.', { duration: this.opts.notificationDuration });
      // sync UI
      this._syncAllCardsControls();
      return false;
    }
    const toAdd = Math.min(desired, available);
    if (toAdd < desired) {
      this.notifications.show(`Добавлено ${toAdd} шт. (доступно ${available}).`, { duration: this.opts.notificationDuration });
    }
    const res = this.cart.add(id, toAdd);
    // cart:update will drive UI updates via cart:updated listener
    return res;
  }

  removeFromCart(id) {
    const res = this.cart.remove(id);
    return res;
  }

  changeQty(id, qty) {
    const res = this.cart.changeQty(id, qty);
    return res;
  }

  isFavorite(id) { return this.favorites.isFavorite ? this.favorites.isFavorite(id) : false; }
  toggleFavorite(id) { return this.favorites.toggle ? this.favorites.toggle(id) : false; }

  // Return product objects for favorites (map ids -> products)
  getFavorites() {
    const ids = (this.favorites.getAll ? this.favorites.getAll() : (this.favorites.exportToArray ? this.favorites.exportToArray() : []));
    return Array.isArray(ids) ? ids.map(id => this.productService.findById(id)).filter(Boolean) : [];
  }

  renderCartPage() {
    const cartGridEl = document.getElementById(this.opts.cartGridId);
    const cartCountInlineEl = document.getElementById(this.opts.cartCountInlineId);
    const cartTotalEl = document.getElementById(this.opts.cartTotalId);

    this.cart.setDomRefs({
      cartGrid: cartGridEl,
      cartCountInline: cartCountInlineEl,
      cartTotal: cartTotalEl
    });

    this.cart.loadFromStorage();
    this.cart.updateCartUI();
    // sync controls after loading
    this._syncAllCardsControls();
  }
}
