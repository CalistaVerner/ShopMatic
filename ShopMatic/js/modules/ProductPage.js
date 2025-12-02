/*
 * ProductPage - optimized and improved.
 *
 * This module provides a modernized implementation of a product detail page. It
 * refactors the original code to use modern JavaScript features such as
 * destructuring, optional chaining, arrow functions, and default parameters.
 * Repetitive logic has been extracted into helper methods, and error
 * handling has been streamlined. The objective is to retain full functionality
 * while improving readability and maintainability.
 */

import { makeSpecHtmlPreview } from './utils.js';
import { Gallery } from './Gallery.js';

const DEFAULT_MESSAGES = {
  addToCartDisabled: 'Невозможно добавить: нет доступного остатка.',
  addToCartError: 'Ошибка при добавлении в корзину',
  favoriteAdded: 'Товар добавлен в избранное',
  favoriteRemoved: 'Товар удалён из избранного',
  wishlistNotConfigured: 'Вишлист не настроен',
  wishlistUpdated: 'Обновлено в вишлисте',
  maxAvailableTemplate: 'Максимум доступно: {count}',
  itemRemovedFromCart: 'Товар удалён из корзины',
  favLabelAdd: '<i class="fa-heart fa-solid"></i> В избранное',
  favLabelIn: '<i class="fa-heart fa-solid active"></i> В избранном',
  wishlistLabelAdd: 'В вишлист',
  wishlistLabelIn: 'В вишлисте',
  badgeInStock: 'В наличии',
  badgeOutOfStock: 'Под заказ',
  addToCartButton: 'В Корзину',
  goToCartButton: 'Корзина',
};

export class ProductPage {
  constructor(shop, opts = {}) {
    if (!shop) throw new Error('ProductPage requires ShopMatic instance');

    const {
      productService,
      cart,
      favorites,
      renderer,
      notifications,
      wishlistModule: wishlist,
    } = shop;

    this.shop = shop;
    this.productService = productService;
    this.cart = cart;
    this.favorites = favorites;
    this.renderer = renderer;
    this.notifications = notifications;
    this.wishlist = wishlist || null;

    const {
      messages = {},
      debug = false,
      ...rest
    } = opts;

    this.opts = {
      templateId: null,
      relatedLimit: 6,
      cardTemplateKey: 'cardVertical',
      ...rest,
    };

    this.messages = { ...DEFAULT_MESSAGES, ...messages };
    this.debug = !!debug;

    this._stripeTimers = new WeakMap();
    this.container = null;
    this.currentProductId = null;

    this._bound = {
      onAddClick: this._onAddClick.bind(this),
      onFavClick: this._onFavClick.bind(this),
      onQtyInput: this._onQtyInput.bind(this),
      onQtyIncr: this._onQtyIncr.bind(this),
      onQtyDecr: this._onQtyDecr.bind(this),
      onWishlistClick: this._onWishlistClick.bind(this),
      onBackClick: this._onBackClick.bind(this),
      onCartUpdated: this._onCartUpdated.bind(this),
      onBuyNowClick: this._onBuyNowClick.bind(this),
    };
  }

  _log(...args) {
    if (!this.debug) return;
    try {
      const msg = args.join(' ');
      this.shop?.foxEngine?.log?.(`ProductPage: ${msg}`, 'DEBUG');
    } catch (_) {
      // eslint-disable-next-line no-console
      console.debug('ProductPage:', ...args);
    }
  }

  _initGallery() {
    if (!this.container) return;
    const galleryRoot = this.container.querySelector('.product-gallery');
    if (!galleryRoot) return;

    const product = this.productService.findById(this.currentProductId) ?? {};
    let photos = [];

    try {
      photos = Array.isArray(product.images)
        ? product.images.slice()
        : JSON.parse(product.picture || '[]');
    } catch {
      photos = [];
    }

    try {
      this.gallery = new Gallery(galleryRoot, photos);
    } catch (err) {
      console.warn('Gallery initialization failed', err);
    }
  }

  async render(productId, container = this.shop.foxEngine.replaceData.contentBlock) {
    //if (!this.pageTemplate) {
     // const tplPath = `/templates/${this.shop.foxEngine.replaceData.template}/foxEngine/product/productPage.tpl`;
      
    //}
	this.pageTemplate = this.shop.foxEngine.templateCache.productPage;

    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) throw new Error('container element required');

    this.container = el;
    this.currentProductId = String(productId);

    this._log('render: fetching product', productId);

    let product = null;
    try {
      product = await this.productService.fetchById(productId);
    } catch {
      product = null;
    }

    if (!product) {
      this._log('render: product not found', productId);
      await this._renderNotFound();
      return;
    }

    try {
      this.cart?.loadFromStorage?.();
    } catch {}

    let html;
    try {
      html = await this._buildHtml(product);
      this.container.innerHTML = html;
      this._log('render: HTML injected', productId);
    } catch (e) {
      console.error('_buildHtml error', e);
      await this._renderNotFound();
      return;
    }

    try {
      this._syncFavButton();
      this._syncQtyControls();
      this._syncWishlistButton();
      this._bindListeners();
    } catch (e) {
      console.error('UI sync/bind error', e);
    }

    try {
      await this._renderRelated(product);
    } catch (e) {
      console.error('_renderRelated error', e);
    }
  }

  destroy() {
    if (!this.container) return;
    this._unbindListeners();
    this.container = null;
    this.currentProductId = null;
  }

  async _renderNotFound() {
    if (!this.container) return;
    this.container.innerHTML = this.shop.foxEngine.templateCache.productNotFound;
    const back = this.container.querySelector('[data-action="back"]');
    back?.addEventListener('click', this._bound.onBackClick);
  }

  async _buildHtml(p) {
    try {
      this.shop.storage.addViewed?.(p);
    } catch {}

    const cartItem = Array.isArray(this.cart?.cart)
      ? this.cart.cart.find(item => String(item.name) === String(p.name))
      : null;

    const qtyFromCart = cartItem ? Number(cartItem.qty || 0) : 0;

    const photos = Array.isArray(p.images)
      ? p.images.slice()
      : p.image
        ? [p.image]
        : p.picture
          ? [p.picture]
          : [];

    const mainImage = photos[0] ?? p.picture ?? p.image ?? '';

    const thumbsHtml = photos.length
      ? photos
          .map((src, i) => {
            const esc = this._escapeAttr(src);
            const active = i === 0 ? ' active' : '';
            return `<button class="thumb-btn${active}" data-thumb-index="${i}" aria-label="thumb-${i}"><img src="${esc}" alt="" loading="lazy" /></button>`;
          })
          .join('')
      : '';

    try {
      await this.productService.fetchCategories?.();
    } catch {}

    const tplData = {
      name: p.name ?? '',
      fullname: p.title ?? p.name ?? p.fullname ?? '',
      price: this._formatPrice(p.price),
      oldPrice: p.oldPrice ? this._formatPrice(p.oldPrice) : '',
      short: p.short ?? '',
      long: p.long ?? '',
      qty: qtyFromCart > 0 ? qtyFromCart : 1,
      mainImage,
      images: photos,
      picture: p.picture ?? mainImage,
      discountPercent: '',
      thumbs: thumbsHtml,
      brandName: p.brandName ?? '',
      categoryName: p.categoryName ? `<small>${p.categoryName}</small>` : '',
      brand: p.brand ?? '',
      category: p.category ?? '',
      specs: typeof makeSpecHtmlPreview === 'function'
        ? makeSpecHtmlPreview(p.specs || {})
        : '',
    };

    const fox = this.shop.foxEngine;

    try {
      if (this.opts.templateId) {
        const t = document.getElementById(this.opts.templateId);
        if (t?.content) {
          const raw = t.innerHTML || '';
          return this._replaceTokens(raw, tplData);
        }
      }

      if (fox?.replaceTextInTemplate) {
        const replaced = await fox.replaceTextInTemplate(this.pageTemplate, tplData);
        if (typeof replaced === 'string' && replaced.length) return replaced;
      }
    } catch (e) {
      console.warn('ProductPage: template replacement failed', e);
    }

    const pictureToken = this._escapeAttr(tplData.picture || tplData.mainImage);
    const nameToken = this._escapeAttr(tplData.name);
    const fullnameHtml = escapeHtml(tplData.fullname);
    const priceToken = tplData.price || '';
    const oldPriceToken = tplData.oldPrice || '';
    const stockToken = String(p.stock ?? p.qty ?? 0);
    const qtyToken = String(tplData.qty);
    const specsHtml = tplData.specs || '';
    const thumbsToken = tplData.thumbs || '';
    const noticesToken = '';

    return this.pageTemplate
      .replace(/\{name\}/g, nameToken)
      .replace(/\{fullname\}/g, fullnameHtml)
      .replace(/\{picture\}/g, pictureToken)
      .replace(/\{price\}/g, priceToken)
      .replace(/\{oldPrice\}/g, oldPriceToken)
      .replace(/\{stock\}/g, stockToken)
      .replace(/\{qty\}/g, qtyToken)
      .replace(/\{specs\}/g, specsHtml)
      .replace(/\{thumbs\}/g, thumbsToken)
      .replace(/\{notices\}/g, noticesToken);
  }

  _bindListeners() {
    if (!this.container) return;

    const add = (selector, event, handler) => {
      const el = this.container.querySelector(selector);
      if (el) el.addEventListener(event, handler);
    };

    add('[data-action="add-to-cart"], .add-to-cart, .btn-yellow', 'click', this._bound.onAddClick);
    add('.fav-toggle', 'click', this._bound.onFavClick);
    add('.wishlist-toggle', 'click', this._bound.onWishlistClick);
    add('.qty-input', 'input', this._bound.onQtyInput);
    add('[data-action="back"]', 'click', this._bound.onBackClick);
    add('[data-action="buy-now"]', 'click', this._bound.onBuyNowClick);

    this.container
      .querySelectorAll('.qty-incr')
      .forEach(btn => btn.addEventListener('click', this._bound.onQtyIncr));

    this.container
      .querySelectorAll('.qty-decr')
      .forEach(btn => btn.addEventListener('click', this._bound.onQtyDecr));

    this.container
      .querySelectorAll('.thumb-btn')
      .forEach(btn =>
        btn.addEventListener('click', ev => {
          const idx = parseInt(ev.currentTarget.getAttribute('data-thumb-index'), 10) || 0;
          const product = this.productService.findById(this.currentProductId) || {};
          const photos = Array.isArray(product.images) ? product.images : [];
          const src = photos[idx];
          const main = this.container.querySelector('.product-main-img');
          if (main && src) main.src = src;
        })
      );

    this.container
      .querySelectorAll('.size-btn')
      .forEach(btn =>
        btn.addEventListener('click', ev => {
          this.container
            .querySelectorAll('.size-btn')
            .forEach(b => b.classList.remove('active'));
          ev.currentTarget.classList.add('active');
        })
      );

    window.addEventListener('cart:updated', this._bound.onCartUpdated);

    try {
      this._initGallery();
    } catch (e) {
      console.warn('gallery init failed', e);
    }
  }

  _unbindListeners() {
    if (!this.container) return;

    const remove = (selector, event, handler) => {
      const el = this.container.querySelector(selector);
      if (el) el.removeEventListener(event, handler);
    };

    remove('[data-action="add-to-cart"], .add-to-cart, .btn-yellow', 'click', this._bound.onAddClick);
    remove('.fav-toggle', 'click', this._bound.onFavClick);
    remove('.wishlist-toggle', 'click', this._bound.onWishlistClick);
    remove('.qty-input', 'input', this._bound.onQtyInput);
    remove('[data-action="back"]', 'click', this._bound.onBackClick);
    remove('[data-action="buy-now"]', 'click', this._bound.onBuyNowClick);

    this.container
      .querySelectorAll('.qty-incr')
      .forEach(btn => btn.removeEventListener('click', this._bound.onQtyIncr));

    this.container
      .querySelectorAll('.qty-decr')
      .forEach(btn => btn.removeEventListener('click', this._bound.onQtyDecr));

    this.container
      .querySelectorAll('.thumb-btn')
      .forEach(t => t.replaceWith(t.cloneNode(true)));

    this.container
      .querySelectorAll('.size-btn')
      .forEach(b => b.replaceWith(b.cloneNode(true)));

    window.removeEventListener('cart:updated', this._bound.onCartUpdated);
  }

  // ===== events =====

  _onAddClick() {
    const pid = this.currentProductId;
    if (!pid) return;

    try {
      const qtyEl = this.container.querySelector('.qty-input');
      const qty = Math.max(1, parseInt(qtyEl?.value || '1', 10));

      const available = this.cart && typeof this.cart._computeAvailableStock === 'function'
        ? this.cart._computeAvailableStock(pid)
        : this.productService.findById(pid)?.stock || 0;

      if (available <= 0) {
        this.notifications.show(this.messages.addToCartDisabled, { duration: 3000 });
        return;
      }

      const toAdd = Math.min(qty, available);
      this.cart?.add?.(pid, toAdd);
      this._syncQtyControls();
    } catch (err) {
      console.error('_onAddClick error', err);
      this.notifications.show(this.messages.addToCartError, { duration: 3000 });
    }
  }

  _onFavClick() {
    try {
      const pid = this.currentProductId;
      if (!pid || !this.favorites?.toggle) return;

      this.favorites.toggle(pid);
      this._syncFavButton();

      const isFav = this.favorites.isFavorite?.(pid);
      this.notifications.show(
        isFav ? this.messages.favoriteAdded : this.messages.favoriteRemoved,
        { duration: 1500 }
      );
    } catch (err) {
      console.warn(err);
    }
  }

  _onWishlistClick() {
    const pid = this.currentProductId;
    if (!pid) return;

    if (!this.wishlist) {
      this.notifications.show(this.messages.wishlistNotConfigured, { duration: 1400 });
      return;
    }

    try {
      if (this.wishlist.toggle) this.wishlist.toggle(pid);
      else if (this.wishlist.add) this.wishlist.add(pid);

      this._syncWishlistButton();
      this.notifications.show(this.messages.wishlistUpdated, { duration: 1200 });
    } catch (err) {
      console.warn(err);
    }
  }

  _onQtyInput(e) {
    const qty = parseInt(e.target.value || '1', 10) || 1;
    const pid = this.currentProductId;
    const product = this.productService.findById(pid);
    const available = product ? product.stock ?? product.qty ?? 0 : 0;

    if (qty > available) {
      e.target.value = String(available || 1);
      const msg = this.messages.maxAvailableTemplate.replace('{count}', String(available));
      this.notifications.show(msg, { duration: 1400 });
    }

    const cartItem = Array.isArray(this.cart?.cart)
      ? this.cart.cart.find(i => String(i.name) === String(pid))
      : null;

    if (cartItem && typeof this.cart?.changeQty === 'function') {
      const newQty = Math.max(
        1,
        Math.min(available || 1, parseInt(e.target.value || '1', 10))
      );
      try {
        this.cart.changeQty(pid, newQty);
      } catch (err) {
        console.warn(err);
      }
    }

    this._syncQtyControls();
  }

  _onQtyIncr(e) {
    try {
      const ctrl = e.currentTarget?.closest?.('.qty-controls') || null;
      const qtyEl = ctrl?.querySelector('.qty-input') || this.container.querySelector('.qty-input');
      if (!qtyEl) return;

      const pid = this.currentProductId;
      const product = this.productService.findById(pid);
      const stock = product ? product.stock ?? product.qty ?? 0 : 0;

      let cur = parseInt(qtyEl.value || '1', 10) || 1;
      const target = Math.min(stock || cur + 1, cur + 1);

      if (target > cur) {
        qtyEl.value = String(target);
        this.cart?.changeQty?.(pid, target);
      }

      this._syncQtyControls();
      this._log('_onQtyIncr: increment', pid, '->', qtyEl?.value);
    } catch (err) {
      console.error('_onQtyIncr', err);
    }
  }

  _onQtyDecr(e) {
    try {
      const ctrl = e.currentTarget?.closest?.('.qty-controls') || null;
      const qtyEl = ctrl?.querySelector('.qty-input') || this.container.querySelector('.qty-input');
      if (!qtyEl) return;

      const pid = this.currentProductId;
      let cur = parseInt(qtyEl.value || '1', 10) || 1;
      const target = Math.max(0, cur - 1);
      qtyEl.value = String(target);

      if (target === 0) {
        try {
          if (this.cart?.remove) {
            this.cart.remove(String(pid));
          } else if (Array.isArray(this.cart?.cart)) {
            const idx = this.cart.cart.findIndex(i => String(i.name) === String(pid));
            if (idx >= 0) {
              this.cart.cart.splice(idx, 1);
              this.cart.save?.();
            }
          }

          this.notifications.show(this.messages.itemRemovedFromCart, { duration: 1500 });
          this._log('_onQtyDecr: removed from cart', pid);
        } catch (err) {
          console.warn('cart.remove threw', err);
        }

        window.dispatchEvent(
          new CustomEvent('cart:updated', { detail: { changedIds: [pid] } })
        );
      } else {
        try {
          this.cart?.changeQty?.(String(pid), Number(target));
        } catch (err) {
          console.warn('cart.changeQty threw', err);
        }

        if (Array.isArray(this.cart?.cart)) {
          const idx = this.cart.cart.findIndex(i => String(i.name) === String(pid));
          if (idx >= 0) {
            this.cart.cart[idx].qty = Number(target);
            this.cart.save?.();
            window.dispatchEvent(
              new CustomEvent('cart:updated', { detail: { changedIds: [pid] } })
            );
          }
        }
      }

      this._syncQtyControls();
    } catch (err) {
      console.error('_onQtyDecr', err);
    }
  }

  _onBackClick() {
    if (window.history && window.history.length > 1) {
      window.history.back();
      return;
    }
    if (this.container) this.container.innerHTML = '';
  }

  _onCartUpdated() {
    this._syncQtyControls();
  }

  _onBuyNowClick(e) {
    e.preventDefault();
    if (!this.container) return;

    const pid = this.currentProductId;
    const product = this.productService.findById(pid);
    if (!product) return;

    const qtyEl = this.container.querySelector('.qty-input');
    const stock = Number(product.stock ?? product.qty ?? 0) || 0;

    let qty = 1;
    if (qtyEl) {
      const raw = Number(qtyEl.value || 1);
      qty = Number.isFinite(raw) && raw > 0 ? raw : 1;
    }
    if (stock > 0) qty = Math.min(qty, stock);

    const buyNowItem = {
      id: product.id ?? product.productId ?? null,
      name: product.name ?? product.fullname ?? '',
      fullname: product.fullname ?? product.name ?? '',
      price: Number(product.price ?? product.product_price ?? 0),
      qty,
      picture: (() => {
        if (!product.picture) return '[]';
        if (typeof product.picture === 'string') {
          try {
            JSON.parse(product.picture);
            return product.picture;
          } catch {
            return JSON.stringify([product.picture]);
          }
        }
        if (Array.isArray(product.picture)) return JSON.stringify(product.picture);
        return '[]';
      })(),
      specs: product.specs ?? product.description ?? '',
    };

    location.hash = '#page/checkout';

    setTimeout(() => {
      if (this.shop && this.shop.checkoutPage) {
        this.shop.checkoutPage.init('#test', { buyNowItem });
      } else {
        console.warn('[ProductPage] this.shop.checkoutPage не инициализирован');
      }
    }, 800);
  }

  // ===== sync UI =====

  _syncFavButton() {
    if (!this.container || !this.favorites) return;

    const btn = this.container.querySelector('.fav-toggle');
    if (!btn) return;

    const isFav = this.favorites.isFavorite?.(String(this.currentProductId)) ?? false;
    btn.innerHTML = isFav ? this.messages.favLabelIn : this.messages.favLabelAdd;
  }

  _animateStripes(btn, duration = 1800) {
    if (!btn || !(btn instanceof HTMLElement)) return;

    const timers = this._stripeTimers;
    const prev = timers.get(btn);
    if (prev) {
      clearTimeout(prev);
      timers.delete(btn);
    }

    btn.classList.add('with-stripes', 'active');
    btn.classList.remove('hidden');

    const t = setTimeout(() => {
      btn.classList.add('hidden');
      const cleanup = setTimeout(() => {
        btn.classList.remove('with-stripes', 'hidden');
        timers.delete(btn);
        clearTimeout(cleanup);
      }, 300);
      timers.delete(btn);
    }, duration);

    timers.set(btn, t);
  }

  _syncWishlistButton() {
    if (!this.container || !this.wishlist) return;

    const btn = this.container.querySelector('.wishlist-toggle');
    if (!btn) return;

    let isIn = false;
    try {
      isIn =
        this.wishlist.isIn?.(this.currentProductId) ||
        this.wishlist.has?.(this.currentProductId) ||
        false;
    } catch {}

    btn.textContent = isIn ? this.messages.wishlistLabelIn : this.messages.wishlistLabelAdd;
  }

  _syncQtyControls() {
    if (!this.container) return;

    const pid = this.currentProductId;
    const product = this.productService.findById(pid);

    const stock = product ? Number(product.stock ?? product.qty ?? 0) : 0;
    const stockEl = this.container.querySelector('.stock-count');
    if (stockEl) stockEl.textContent = String(stock);

    const controlBar = this.container.querySelector('.qty-controls');
    const qtyEl = this.container.querySelector('.qty-input');
    const btnPlus = this.container.querySelector('.qty-incr');
    const btnMinus = this.container.querySelector('.qty-decr');

    const addBtn = this.container.querySelector(
      '[data-action="add-to-cart"], .add-to-cart, .btn-yellow'
    );
    const buyNowBtn = this.container.querySelector('[data-action="buy-now"]');

    if (buyNowBtn && !buyNowBtn._buyBound) {
      buyNowBtn.addEventListener('click', this._bound.onBuyNowClick);
      buyNowBtn._buyBound = true;
    }

    const cartItem = Array.isArray(this.cart?.cart)
      ? this.cart.cart.find(i => String(i.name) === String(pid))
      : null;

    const cartQty = cartItem ? Number(cartItem.qty || 0) : 0;

    if (qtyEl) {
      qtyEl.setAttribute('min', '1');
      qtyEl.setAttribute('max', String(Math.max(1, stock)));

      let cur = parseInt(
        qtyEl.value || (cartQty > 0 ? String(cartQty) : '1'),
        10
      ) || 1;

      if (cartQty > 0) {
        cur = cartQty;

        if (buyNowBtn) buyNowBtn.style.display = 'none';
        if (controlBar) controlBar.style.display = 'flex';

        if (addBtn) {
          try {
            addBtn.removeEventListener('click', this._bound.onAddClick);
          } catch {}

          addBtn.onclick = () => {
            try {
              this.shop.foxEngine?.page?.loadPage('cart');
            } catch {}
          };

          addBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"
                 class="_1w4N_" width="16" height="16">
              <path fill="#21201F" fill-rule="evenodd"
                    d="M0 5.752a.5.5 0 0 1 .5-.5h8.65L5.304 1.406a.5.5 0 0 1 0-.707l.342-.343a.5.5 0 0 1 .708 0L12 6.002 6.354 11.65a.5.5 0 0 1-.708 0l-.342-.343a.5.5 0 0 1 0-.707L9.15 6.752H.5a.5.5 0 0 1-.5-.5v-.5Z"
                    clip-rule="evenodd"></path>
            </svg> ${this.messages.goToCartButton}`;
        }
      } else {
        if (buyNowBtn) buyNowBtn.style.display = 'flex';
        if (controlBar) controlBar.style.display = 'none';

        if (addBtn) {
          addBtn.onclick = null;
          addBtn.addEventListener('click', this._bound.onAddClick);
          addBtn.innerHTML = this.messages.addToCartButton;
        }
      }

      if (stock <= 0) {
        qtyEl.value = '0';
        qtyEl.disabled = true;
        if (addBtn) {
          addBtn.disabled = true;
          addBtn.classList.add('disabled');
        }
      } else {
        if (cur > stock) cur = stock;
        qtyEl.value = String(cur);
        qtyEl.disabled = false;
        if (addBtn) {
          addBtn.disabled = false;
          addBtn.classList.remove('disabled');
        }
      }
    }

    try {
      const current = qtyEl ? parseInt(qtyEl.value || '1', 10) || 1 : 1;

      if (btnPlus) {
        const disablePlus = stock <= 0 || current >= stock;
        btnPlus.disabled = disablePlus;
        if (disablePlus) btnPlus.setAttribute('aria-disabled', 'true');
        else btnPlus.removeAttribute('aria-disabled');
      }

      if (btnMinus) {
        const disableMinus = current <= 0;
        btnMinus.disabled = disableMinus;
        if (disableMinus) btnMinus.setAttribute('aria-disabled', 'true');
        else btnMinus.removeAttribute('aria-disabled');
      }
    } catch {}
  }

  // ===== cards / related =====

  async createCard(product = {}) {
    const p = product || {};
    const id = String(p.name ?? p.id ?? p.productId ?? '');
    const priceText = this._formatPrice(p.price ?? 0);
    const hasOldPrice = p.oldPrice && Number(p.oldPrice) > 0;

    const badgeText =
      Number(p.stock) > 0
        ? this.messages.badgeInStock
        : this.messages.badgeOutOfStock;

    const specsHtml = makeSpecHtmlPreview
      ? makeSpecHtmlPreview(p.specs || p.attributes || {})
      : '';

    const data = {
      id,
      fullname: p.fullname ?? p.title ?? p.name ?? '',
      img: p.picture ?? p.image ?? '/assets/no-image.png',
      short: p.short ?? '',
      price: priceText,
      oldPrice: hasOldPrice ? this._formatPrice(p.oldPrice) : '',
      badgeText,
      stock: Number.isFinite(Number(p.stock)) ? Number(p.stock) : 0,
      specsHtml,
    };

    let html = '';
    const fox = this.shop.foxEngine;

    try {
      if (fox?.templateCache?.[this.opts.cardTemplateKey]) {
        html = await fox.replaceTextInTemplate(
          fox.templateCache[this.opts.cardTemplateKey],
          data
        );
      }
    } catch (e) {
      fox?.log?.('ProductPage.createCard template error: ' + e, 'ERROR');
      html = '';
    }

    if (!html) {
      const escTitle = escapeHtml(data.fullname);
      const escImg = escapeHtml(data.img);
      const escPrice = escapeHtml(data.price);
      const escOld = escapeHtml(data.oldPrice);
      const escShort = escapeHtml(data.short);
      const escSpecs = data.specsHtml || '';

      html = `
        <article class="card product-card" data-product-id="${escapeHtml(id)}">
          <div class="card__media">
            <img src="${escImg}" alt="${escTitle}" loading="lazy">
          </div>
          <div class="card__body p-2">
            <h3 class="card__title small">${escTitle}</h3>
            <div class="card__price">
              ${escPrice}${hasOldPrice ? ' <small class="old">' + escOld + '</small>' : ''}
            </div>
            <div class="card__short small text-muted">${escShort}</div>
            <div class="card__specs small">${escSpecs}</div>
            <div class="card__controls mt-2">
              <button data-role="buy" class="btn btn-sm btn-outline-primary">
                ${this.messages.addToCartButton}
              </button>
            </div>
          </div>
        </article>`;
    }

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    const node = wrapper.firstElementChild || wrapper;

    try {
      node?.setAttribute('data-product-id', String(id));
    } catch {}

    return node;
  }

  async _renderCartVertical(list = [], rootEl) {
    if (!rootEl) return;

    rootEl.innerHTML = '';

    const frag = document.createDocumentFragment();
    const cards = await Promise.all(
      (Array.isArray(list) ? list : []).map(p => this.createCard(p))
    );

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

    const selector = `[data-product-id="${esc}"]`;
    const card = rootEl.querySelector(selector);
    if (!card) return;

    const favBtn = card.querySelector('.fav-btn, .fav-toggle, [data-role="fav"]');
    if (!favBtn) return;

    favBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    favBtn.title = isFav ? 'В избранном' : 'Добавить в избранное';
    favBtn.classList.toggle('is-fav', Boolean(isFav));

    const icon = favBtn.querySelector('i');
    if (icon) {
      icon.classList.remove('fa-regular', 'fa-solid');
      icon.classList.add(isFav ? 'fa-solid' : 'fa-regular');
      if (!icon.classList.contains('fa-heart')) icon.classList.add('fa-heart');
    }
  }

  async _renderRelated(product) {
    if (!this.container) return;

    const relatedRoot = this.container.querySelector('[data-related]');
    if (!relatedRoot) return;

    try {
      const all = Array.isArray(this.productService.getProducts())
        ? this.productService.getProducts()
        : [];

      let related = all.filter(
        p => p && p.id != product.id && p.category === product.category
      );
      if (!related.length) {
        related = all.filter(p => p && p.id != product.id);
      }

      related = related.slice(0, this.opts.relatedLimit);

      await this._renderCartVertical(related, relatedRoot);

      related.forEach(p => {
        const isFav = this.favorites?.isFavorite?.(String(p.id)) ?? false;
        this.updateProductCardFavState(relatedRoot, p.id, isFav);
      });
    } catch (err) {
      console.warn('renderRelated failed', err);
    }
  }

  _replaceTokens(template, data = {}) {
    return String(template).replace(/\{\{\s*([^}]+)\s*\}\}/g, (m, key) => {
      const v = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : '';
      return v == null ? '' : String(v);
    });
  }

  _formatPrice(v) {
    if (v == null) return '';
    if (typeof v === 'number') {
      try {
        return new Intl.NumberFormat('ru-RU', {
          style: 'currency',
          currency: 'RUB',
          maximumFractionDigits: 0,
        }).format(v);
      } catch {
        return String(v);
      }
    }
    return String(v);
  }

  _escapeAttr(str) {
    if (str == null) return '';
    return String(str).replace(/"/g, '&quot;');
  }
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
