// ProductPage/ProductPageContext.js
import { makeSpecHtmlPreview } from '../utils.js';

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

export class ProductPageContext {
  constructor(shop, opts = {}) {
    if (!shop) throw new Error('ProductPageContext requires ShopMatic instance');

    const {
      productService,
      cart,
      favorites,
      renderer,
      notifications,
      wishlistModule: wishlist,
      storage,
      foxEngine,
      checkoutPage,
    } = shop;

    this.shop = shop;
    this.productService = productService;
    this.cart = cart;
    this.favorites = favorites;
    this.renderer = renderer;
    this.notifications = notifications;
    this.wishlist = wishlist || null;
    this.storage = storage || null;
    this.foxEngine = foxEngine || null;
    this.checkoutPage = checkoutPage || null;

    const { messages = {}, debug = false, ...rest } = opts;

    this.opts = {
      templateId: null,
      relatedLimit: 6,
      cardTemplateKey: 'cardVertical',
      ...rest,
    };

    this.messages = { ...DEFAULT_MESSAGES, ...messages };
    this.debug = !!debug;
  }

  log(...args) {
    if (!this.debug) return;
    try {
      const msg = args.join(' ');
      this.foxEngine?.log?.(`ProductPage: ${msg}`, 'DEBUG');
    } catch {
      // eslint-disable-next-line no-console
      console.debug('ProductPage:', ...args);
    }
  }

  /* ---------- продукт / корзина ---------- */

  getProductSync(id) {
    return this.productService?.findById?.(id) ?? null;
  }

  async fetchProduct(id) {
    try {
      const p = await this.productService.fetchById(id);
      return p || null;
    } catch {
      return null;
    }
  }

  getCartItem(productId) {
    const pid = String(productId);
    const arr = this.cart?.cart;
    if (!Array.isArray(arr)) return null;
    return arr.find(i => String(i.name) === pid) || null;
  }

  isInCart(productId) {
    return this.getCartItem(productId) || null;
  }

  computeStock(product) {
    if (!product) return 0;
    return Number(product.stock ?? product.qty ?? 0) || 0;
  }

  computeAvailableStock(productId) {
    const pid = String(productId);
    if (this.cart && typeof this.cart._computeAvailableStock === 'function') {
      return Number(this.cart._computeAvailableStock(pid)) || 0;
    }
    const product = this.getProductSync(pid);
    return this.computeStock(product);
  }

  addToCart(productId, qty) {
    const pid = String(productId);
    this.cart?.add?.(pid, qty);
  }

  changeCartQty(productId, qty) {
    const pid = String(productId);
    this.cart?.changeQty?.(pid, qty);
  }

  removeFromCart(productId) {
    const pid = String(productId);
    if (this.cart?.remove) {
      this.cart.remove(pid);
      return;
    }
    if (Array.isArray(this.cart?.cart)) {
      const idx = this.cart.cart.findIndex(i => String(i.name) === pid);
      if (idx >= 0) {
        this.cart.cart.splice(idx, 1);
        this.cart.save?.();
      }
    }
  }

  /* ---------- избранное / вишлист ---------- */

  toggleFavorite(productId) {
    const pid = String(productId);
    this.favorites?.toggle?.(pid);
  }

  isFavorite(productId) {
    const pid = String(productId);
    return this.favorites?.isFavorite?.(pid) ?? false;
  }

  toggleWishlist(productId) {
    const pid = String(productId);
    if (!this.wishlist) return;
    if (this.wishlist.toggle) this.wishlist.toggle(pid);
    else if (this.wishlist.add) this.wishlist.add(pid);
  }

  isInWishlist(productId) {
    const pid = String(productId);
    if (!this.wishlist) return false;
    try {
      return (
        this.wishlist.isIn?.(pid) ||
        this.wishlist.has?.(pid) ||
        false
      );
    } catch {
      return false;
    }
  }

  /* ---------- уведомления / логика UI ---------- */

  notify(text, opts = {}) {
    try {
      if (this.notifications?.show) {
        return this.notifications.show(text, opts);
      }
      const fe = this.foxEngine;
      if (fe?.notifications?.show) {
        return fe.notifications.show(text, opts);
      }
      const sm = fe?.shopMatic;
      if (sm?.notifications?.show) {
        return sm.notifications.show(text, opts);
      }
    } catch (e) {
      this.log('notify failed', e?.message || e);
    }
    if (opts.type === 'error') alert(text);
  }

  formatPrice(v) {
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

  escapeAttr(str) {
    if (str == null) return '';
    return String(str).replace(/"/g, '&quot;');
  }

  replaceTokens(template, data = {}) {
    return String(template).replace(/\{\{\s*([^}]+)\s*\}\}/g, (m, key) => {
      const v = Object.prototype.hasOwnProperty.call(data, key)
        ? data[key]
        : '';
      return v == null ? '' : String(v);
    });
  }

  /* ---------- построение HTML продукта ---------- */

  async buildProductHtml(product, currentCartQty = 0) {
    try {
      this.storage?.addViewed?.(product);
    } catch {}

    const photos = Array.isArray(product.images)
      ? product.images.slice()
      : product.image
        ? [product.image]
        : product.picture
          ? [product.picture]
          : [];

    const mainImage = photos[0] ?? product.picture ?? product.image ?? '';

    const thumbsHtml = photos.length
      ? photos
          .map((src, i) => {
            const esc = this.escapeAttr(src);
            const active = i === 0 ? ' active' : '';
            return `<button class="thumb-btn${active}" data-thumb-index="${i}" aria-label="thumb-${i}"><img src="${esc}" alt="" loading="lazy" /></button>`;
          })
          .join('')
      : '';

    try {
      await this.productService.fetchCategories?.();
    } catch {}

    const tplData = {
      name: product.name ?? '',
      fullname: product.title ?? product.name ?? product.fullname ?? '',
      price: this.formatPrice(product.price),
      oldPrice: product.oldPrice ? this.formatPrice(product.oldPrice) : '',
      short: product.short ?? '',
      long: product.long ?? '',
      qty: currentCartQty > 0 ? currentCartQty : 1,
      mainImage,
      images: photos,
      picture: product.picture ?? mainImage,
      discountPercent: '',
      thumbs: thumbsHtml,
      brandName: product.brandName ?? '',
      categoryName: product.categoryName,
      brand: product.brand ?? '',
      category: product.category ?? '',
      specs: typeof makeSpecHtmlPreview === 'function'
        ? makeSpecHtmlPreview(product.specs || {})
        : '',
    };

    const fox = this.foxEngine;

    // 1) кастомный templateId
    try {
      if (this.opts.templateId) {
        const t = document.getElementById(this.opts.templateId);
        if (t?.content) {
          const raw = t.innerHTML || '';
          return this.replaceTokens(raw, tplData);
        }
      }
    } catch (e) {
      this.log('templateId render failed', e?.message || e);
    }

    // 2) foxEngine шаблон
    try {
      if (fox?.templateRenderer?.renderTemplate) {
        const rendered = await fox.templateRenderer.renderTemplate('productPage', tplData);
        if (typeof rendered === 'string' && rendered.length) return rendered;
      }
    } catch (e) {
      this.log('templateRenderer.renderTemplate failed', e?.message || e);
    }

    return '';
  }
}
