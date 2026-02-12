// ProductPage/ProductPageView.js
import { Gallery } from '../Gallery/Gallery.js';
import { makeSpecHtmlPreview, escapeHtml } from '../utils.js';

export class ProductPageView {
  constructor(context) {
    this.ctx = context;
    this.container = null;
    this.currentProductId = null;
    this.gallery = null;
    this._stripeTimers = new WeakMap();

    this._boundOnAddClick = null;
    this._boundOnBuyNowClick = null;
  }

  /* -------------------------------------------------------------------------- */
  /*  Lifecycle                                                                 */
  /* -------------------------------------------------------------------------- */

  attach(container, productId) {
    this.container = container;
    this.currentProductId = String(productId);
  }

  detach() {
    this.container = null;
    this.currentProductId = null;
    this.gallery = null;
  }

  isAttached() {
    return !!this.container;
  }

  async renderNotFound() {
    const root = this._getContainer();
    if (!root) return;

    root.innerHTML = this.ctx.foxEngine?.templateCache?.productNotFound || '';
  }

  async renderMain(product, cartQty) {
    const root = this._getContainer();
    if (!root) return;

    const html = await this.ctx.buildProductHtml(product, cartQty);
    root.innerHTML = html;
  }

  /* -------------------------------------------------------------------------- */
  /*  Gallery                                                                   */
  /* -------------------------------------------------------------------------- */

  initGallery() {
    const root = this._getContainer();
    if (!root) return;

    const galleryRoot = root.querySelector('.product-gallery');
    if (!galleryRoot) return;

    const product = this._getCurrentProduct() || {};
    const photos = this._extractPhotosFromProduct(product);

    try {
      this.gallery = new Gallery(galleryRoot, photos);
    } catch (err) {
      console.warn('Gallery initialization failed', err);
    }
  }

  _extractPhotosFromProduct(product) {
    if (!product) return [];
    if (Array.isArray(product.images)) return product.images.slice();

    try {
      if (product.picture) {
        const parsed = JSON.parse(product.picture);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      // ignore
    }

    return [];
  }

  /* -------------------------------------------------------------------------- */
  /*  Favorites / Wishlist                                                      */
  /* -------------------------------------------------------------------------- */

  syncFavButton() {
    const root = this._getContainer();
    if (!root || !this.ctx.favorites) return;

    const btn = root.querySelector('.fav-toggle');
    if (!btn) return;

    const isFav = this.ctx.isFavorite(this.currentProductId);
    btn.innerHTML = isFav
      ? this.ctx.messages.favLabelIn
      : this.ctx.messages.favLabelAdd;
  }

  syncWishlistButton() {
    const root = this._getContainer();
    if (!root || !this.ctx.wishlist) return;

    const btn = root.querySelector('.wishlist-toggle');
    if (!btn) return;

    const isIn = this.ctx.isInWishlist(this.currentProductId);
    btn.textContent = isIn
      ? this.ctx.messages.wishlistLabelIn
      : this.ctx.messages.wishlistLabelAdd;
  }

  /* -------------------------------------------------------------------------- */
  /*  Button animations                                                         */
  /* -------------------------------------------------------------------------- */

  animateStripes(btn, duration = 1800) {
    if (!btn || !(btn instanceof HTMLElement)) return;

    const timers = this._stripeTimers;
    const prev = timers.get(btn);
    if (prev) {
      clearTimeout(prev);
      timers.delete(btn);
    }

    btn.classList.add('with-stripes', 'active');
    btn.classList.remove('hidden');

    const finish = () => {
      btn.classList.add('hidden');
      const cleanup = setTimeout(() => {
        btn.classList.remove('with-stripes', 'hidden');
        timers.delete(btn);
        clearTimeout(cleanup);
      }, 300);
    };

    const t = setTimeout(finish, duration);
    timers.set(btn, t);
  }

  /* -------------------------------------------------------------------------- */
  /*  Qty controls                                                              */
  /* -------------------------------------------------------------------------- */

  setQtyControlHandlers(onAddClick, onBuyNowClick) {
    this._boundOnAddClick = onAddClick;
    this._boundOnBuyNowClick = onBuyNowClick;
  }

  syncQtyControls() {
    const root = this._getContainer();
    if (!root || this.currentProductId == null) return;

    const product = this._getCurrentProduct();
    const stock = this.ctx.computeStock(product);

    const ui = this._getQtyControlsUI(root);

    this._updateStockText(ui.stockEl, stock);
    this._ensureBuyNowBound(ui.buyNowBtn);

    const cartItem = this.ctx.isInCart(this.currentProductId);
    const inCart = !!cartItem;
    const cartQty = cartItem ? Number(cartItem.qty || 0) || 1 : 1;

    const startQty = this._resolveInitialQty(ui.qtyEl, { inCart, cartQty });
    this._setMode(inCart, ui);

    const appliedQty = this._applyStockToQtyAndAddBtn(ui.qtyEl, ui.addBtn, stock, startQty);
    this._updatePlusMinusControls(ui.btnPlus, ui.btnMinus, stock, appliedQty);
  }

  _getQtyControlsUI(root) {
    return {
      stockEl: root.querySelector('.stock-count'),
      controlBar: root.querySelector('.qty-controls'),
      qtyEl: root.querySelector('.qty-input'),
      btnPlus: root.querySelector('.qty-incr'),
      btnMinus: root.querySelector('.qty-decr'),
      addBtn: root.querySelector(
        '[data-action="add-to-cart"], .add-to-cart, .btn-yellow'
      ),
      buyNowBtn: root.querySelector('[data-action="buy-now"]'),
    };
  }

  _updateStockText(stockEl, stock) {
    if (!stockEl) return;
    stockEl.textContent = String(stock);
  }

  _ensureBuyNowBound(buyNowBtn) {
    if (!buyNowBtn || buyNowBtn._buyBound || !this._boundOnBuyNowClick) return;
    buyNowBtn.addEventListener('click', this._boundOnBuyNowClick);
    buyNowBtn._buyBound = true;
  }

  _resolveInitialQty(qtyEl, { inCart, cartQty }) {
    if (!qtyEl) {
      return inCart && cartQty > 0 ? cartQty : 1;
    }

    const rawValue = qtyEl.value && qtyEl.value.trim();
    const parsed = rawValue ? parseInt(rawValue, 10) : NaN;

    if (inCart && cartQty > 0) return cartQty;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return 1;
  }

  _setMode(inCart, ui) {
    if (inCart) {
      this._setModeInCart(ui);
    } else {
      this._setModeNotInCart(ui);
    }
  }

  _setModeInCart({ buyNowBtn, controlBar, addBtn }) {
    if (buyNowBtn) buyNowBtn.style.display = 'none';
    if (controlBar) controlBar.style.display = 'flex';

    if (!addBtn) return;

    this._detachAddClick(addBtn);

    addBtn.onclick = () => {
      try {
        this.ctx.foxEngine?.page?.loadPage('cart');
      } catch (e) {
        this.ctx.log('open cart failed', e?.message || e);
      }
    };

    addBtn.innerHTML = this._buildGoToCartButtonHtml();
  }

  _setModeNotInCart({ buyNowBtn, controlBar, addBtn }) {
    if (buyNowBtn) buyNowBtn.style.display = 'flex';
    if (controlBar) controlBar.style.display = 'none';

    if (!addBtn) return;

    addBtn.onclick = null;
    this._detachAddClick(addBtn);
    this._attachAddClick(addBtn);

    addBtn.innerHTML = this.ctx.messages.addToCartButton;
  }

  _detachAddClick(addBtn) {
    if (!addBtn || !this._boundOnAddClick) return;
    try {
      addBtn.removeEventListener('click', this._boundOnAddClick);
    } catch {
      // ignore
    }
  }

  _attachAddClick(addBtn) {
    if (!addBtn || !this._boundOnAddClick) return;
    addBtn.addEventListener('click', this._boundOnAddClick);
  }

  _buildGoToCartButtonHtml() {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"
           class="_1w4N_" width="16" height="16">
        <path fill="#21201F" fill-rule="evenodd"
              d="M0 5.752a.5.5 0 0 1 .5-.5h8.65L5.304 1.406a.5.5 0 0 1 0-.707l.342-.343a.5.5 0 0 1 .708 0L12 6.002 6.354 11.65a.5.5 0 0 1-.708 0l-.342-.343a.5.5 0 0 1 0-.707L9.15 6.752H.5a.5.5 0 0 1-.5-.5v-.5Z"
              clip-rule="evenodd"></path>
      </svg> ${this.ctx.messages.goToCartButton}`.trim();
  }

  _applyStockToQtyAndAddBtn(qtyEl, addBtn, stock, currentQty) {
    if (!qtyEl) return currentQty;

    qtyEl.setAttribute('min', '1');
    qtyEl.setAttribute('max', String(Math.max(1, stock)));

    let cur = Number.isFinite(currentQty) && currentQty > 0
      ? currentQty
      : 1;

    if (stock <= 0) {
      qtyEl.value = '0';
      qtyEl.disabled = true;
      if (addBtn) {
        addBtn.disabled = true;
        addBtn.classList.add('disabled');
      }
      return 0;
    }

    if (cur > stock) cur = stock;
    qtyEl.value = String(cur);
    qtyEl.disabled = false;

    if (addBtn) {
      addBtn.disabled = false;
      addBtn.classList.remove('disabled');
    }

    return cur;
  }

  _updatePlusMinusControls(btnPlus, btnMinus, stock, qty) {
    const current = Number.isFinite(qty) ? qty : 1;

    if (btnPlus) {
      const disablePlus = stock <= 0 || current >= stock;
      btnPlus.disabled = disablePlus;
      this._setAriaDisabled(btnPlus, disablePlus);
    }

    if (btnMinus) {
      const disableMinus = stock < 0;
      btnMinus.disabled = disableMinus;
      this._setAriaDisabled(btnMinus, disableMinus);
    }
  }

  _setAriaDisabled(el, disabled) {
    if (!el) return;
    if (disabled) el.setAttribute('aria-disabled', 'true');
    else el.removeAttribute('aria-disabled');
  }

  /* -------------------------------------------------------------------------- */
  /*  Extra handlers binding helpers                                            */
  /* -------------------------------------------------------------------------- */

  setThumbHandlers(handler) {
    const root = this._getContainer();
    if (!root) return;

    this._forEach(root.querySelectorAll('.thumb-btn'), btn => {
      btn.addEventListener('click', ev => {
        const idx = parseInt(
          ev.currentTarget.getAttribute('data-thumb-index'),
          10,
        ) || 0;
        handler(idx);
      });
    });
  }

  setSizeButtonsHandler(handler) {
    const root = this._getContainer();
    if (!root) return;

    this._forEach(root.querySelectorAll('.size-btn'), btn => {
      btn.addEventListener('click', ev => handler(ev.currentTarget));
    });
  }

  /* -------------------------------------------------------------------------- */
  /*  Cards / Related                                                           */
  /* -------------------------------------------------------------------------- */

  createCardNode(product) {
    const normalized = this._normalizeProductForCard(product);
    const html = this._buildCardHtml(normalized);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    const node = wrapper.firstElementChild || wrapper;
    node?.setAttribute('data-product-id', String(normalized.id));
    return node;
  }

  async renderCardsVertical(list = [], rootEl) {
    if (!rootEl) return;

    rootEl.innerHTML = '';
    const frag = document.createDocumentFragment();

    const products = Array.isArray(list) ? list : [];
    const cards = products.map(p => this.createCardNode(p));

    for (const card of cards) {
      if (!card) continue;
      card.style.opacity = '0';
      card.style.transition = 'opacity .22s ease';
      frag.append(card);
      requestAnimationFrame(() => {
        card.style.opacity = '1';
      });
    }

    rootEl.append(frag);
  }

  updateProductCardFavState(rootEl, id, isFav) {
    if (!rootEl || !id) return;

    const esc = typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(String(id))
      : String(id).replace(/"/g, '\\"');

    const card = rootEl.querySelector(`[data-product-id="${esc}"]`);
    if (!card) return;

    const favBtn = card.querySelector('.fav-btn, .fav-toggle, [data-role="fav"]');
    if (!favBtn) return;

    favBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    favBtn.title = isFav ? 'В избранном' : 'Добавить в избранное';
    favBtn.classList.toggle('is-fav', Boolean(isFav));

    const icon = favBtn.querySelector('i');
    if (!icon) return;

    icon.classList.remove('fa-regular', 'fa-solid');
    icon.classList.add(isFav ? 'fa-solid' : 'fa-regular');
    if (!icon.classList.contains('fa-heart')) icon.classList.add('fa-heart');
  }

  _normalizeProductForCard(product = {}) {
    const id = String(product.name ?? product.id ?? '');
    const priceText = this.ctx.formatPrice(product.price ?? 0);
    const hasOldPrice = product.oldPrice && Number(product.oldPrice) > 0;

    const badgeText =
      Number(product.stock) > 0
        ? this.ctx.messages.badgeInStock
        : this.ctx.messages.badgeOutOfStock;

    const specsHtml = makeSpecHtmlPreview
      ? makeSpecHtmlPreview(product.specs || product.attributes || {})
      : '';

    return {
      id,
      fullname: product.fullname ?? product.title ?? product.name ?? '',
      img: product.picture ?? product.image ?? '/assets/no-image.png',
      short: product.short ?? '',
      price: priceText,
      oldPrice: hasOldPrice ? this.ctx.formatPrice(product.oldPrice) : '',
      hasOldPrice,
      badgeText,
      stock: Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0,
      specsHtml,
    };
  }

  _buildCardHtml(data) {
    const fox = this.ctx.foxEngine;
    const tplKey = this.ctx.opts.cardTemplateKey;

    try {
      if (fox?.templateCache?.[tplKey]) {
        return fox.replaceTextInTemplate(fox.templateCache[tplKey], data);
      }
    } catch (e) {
      fox?.log?.('ProductPage.createCard template error: ' + e, 'ERROR');
    }

    // Fallback — простая карточка
    const specs = data.specsHtml || '';

    return `
      <article class="card product-card" data-product-id="${escapeHtml(data.id)}">
        <div class="card__media">
          <img src="${escapeHtml(data.img)}" alt="${escapeHtml(data.fullname)}" loading="lazy">
        </div>
        <div class="card__body p-2">
          <h3 class="card__title small">${escapeHtml(data.fullname)}</h3>
          <div class="card__price">
            ${escapeHtml(data.price)}${
              data.hasOldPrice
                ? ' <small class="old">' + escapeHtml(data.oldPrice) + '</small>'
                : ''
            }
          </div>
          <div class="card__short small text-muted">${escapeHtml(data.short)}</div>
          <div class="card__specs small">${specs}</div>
          <div class="card__controls mt-2">
            <button data-role="buy" class="sm-btn sm-btn--sm sm-btn--outline">
              ${this.ctx.messages.addToCartButton}
            </button>
          </div>
        </div>
      </article>`;
  }

  /* -------------------------------------------------------------------------- */
  /*  Low-level helpers                                                         */
  /* -------------------------------------------------------------------------- */

  _getContainer() {
    return this.container || null;
  }

  _getCurrentProduct() {
    if (!this.currentProductId) return null;
    return this.ctx.getProductSync(this.currentProductId);
  }

  _forEach(nodeList, fn) {
    if (!nodeList) return;
    Array.prototype.forEach.call(nodeList, fn);
  }
}
