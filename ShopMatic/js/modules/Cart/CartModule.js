// Cart/CartModule.js

import { CartUI } from './CartUI.js';

/**
 * CartModule — публичный фасад для остального кода.
 * Снаружи API остаётся прежним, внутри — разделено по слоям.
 */
export class CartModule extends CartUI {
  static UI_MESSAGES = Object.freeze({
    NOT_ENOUGH_STOCK: 'Недостаточно товара на складе.',
    ONLY_X_LEFT: 'В наличии только {stock} шт.',
    ADDED_TO_CART_HTML:
      'Товар ({title}) x{qty} добавлен в корзину <a href="#page/cart">Перейти в корзину</a>',
    ADDED_TO_CART_PLAIN:
      'Товар "{title}" x{qty} добавлен в корзину.',
    FAVORITES_UNAVAILABLE: 'Модуль избранного недоступен.',
    INSUFFICIENT_STOCK_ADD:
      'Недостаточно на складе. Доступно: {max}.',
    INSUFFICIENT_STOCK_CHANGEQTY:
      'Недостаточно на складе. Доступно: {stock}.',
    PRODUCT_OUT_OF_STOCK: 'Товар отсутствует на складе.',
    REACHED_MAX_STOCK_LIMIT_NOTIFY:
      'Достигнут максимальный лимит по остатку.',
    PRODUCT_LIMIT_DEFAULT: 'У вас уже максимум в корзине',
    PRODUCT_LIMIT_REACHED:
      'Вы достигли максимального количества этого товара',
    NO_STOCK_TEXT: 'Товара нет в наличии'
  });

  constructor({ storage, productService, renderer, notifications, favorites = null, opts = {} }) {
    super({ storage, productService, renderer, notifications, favorites, opts });
  }

  /**
   * Переопределяем add/remove/changeQty чтобы сразу дергать updateCartUI
   * (поведение как у старой версии CartModule).
   */
  add(productId, qty = 1) {
    const ok = super.add(productId, qty);
    if (!ok) return false;

    const id = this._normalizeId(productId);
    const prod = this._resolveProduct(id);

    // уведомление о добавлении
    try {
      const title =
        prod && (prod.fullname || prod.title)
          ? prod.fullname || prod.title
          : id;
      try {
        this.notifications?.show?.(
          this._msg('ADDED_TO_CART_HTML', { title, qty }),
          { type: 'success', allowHtml: true }
        );
      } catch (_) {
        this.notifications?.show?.(
          this._msg('ADDED_TO_CART_PLAIN', { title, qty }),
          { type: 'success' }
        );
      }
    } catch (e) {
      this._logError('notifications.show failed on add', e);
    }

    return this.updateCartUI();
  }

  remove(productId) {
    const ok = super.remove(productId);
    if (!ok) return false;
    return this.updateCartUI(productId);
  }

  changeQty(productId, newQty, opts = {}) {
    const ok = super.changeQty(productId, newQty, opts);
    if (!ok) return false;
    return this.updateCartUI(productId);
  }

  async loadFromStorage() {
    await super.loadFromStorage();
    return this.updateCartUI();
  }

  clear() {
    super.clear();
    return this.updateCartUI();
  }

  _setCartForTest(cartArray) {
    super._setCartForTest(cartArray);
    return this.updateCartUI();
  }
}
