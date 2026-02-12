import { IdUtils } from '../Utils/IdUtils.js';
// card-stock-helper.js
export class CardStockHelper {
  constructor(card) {
    this.card = card;
  }

  computeAvailableStock(id) {
    if (!id) return 0;
    const { shopMatic } = this.card;
    try {
      const prod = shopMatic.productService?.findById?.(id);
      // Если сервис async — считаем, что добавить нельзя
      if (prod && typeof prod.then === 'function') return 0;
      const totalStock = Number(prod?.stock || 0);
      const inCartQty = this.card._findCartQtyById(id);
      return Math.max(0, totalStock - inCartQty);
    } catch {
      return 0;
    }
  }

  _norm(v) { return IdUtils.key(v); }

  findCartQtyById(id) {
    const { shopMatic } = this.card;
    try {
      const cartModule = shopMatic?.cart;
      const cartArray = Array.isArray(cartModule?.cart)
        ? cartModule.cart
        : (Array.isArray(cartModule) ? cartModule : []);
      if (!Array.isArray(cartArray)) return 0;

      const keys = ['id', 'productId', 'name', 'cartId', 'itemId'];
      const target = this._norm(id);
      if (!target) return 0;
      for (const it of cartArray) {
        if (!it) continue;
        for (const k of keys) {
          const v = this._norm(it[k]);
          if (v && v === target) {
            return Number(it.qty ?? it.quantity ?? 0) || 0;
          }
        }
        if (this._norm(it) === target) return Number(it.qty ?? 0) || 0;
      }
    } catch {
      // ignore
    }
    return 0;
  }
}
