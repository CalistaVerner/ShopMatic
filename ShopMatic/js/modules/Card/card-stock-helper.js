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

  findCartQtyById(id) {
    const { shopMatic } = this.card;
    try {
      const cartModule = shopMatic?.cart;
      const cartArray = Array.isArray(cartModule?.cart)
        ? cartModule.cart
        : (Array.isArray(cartModule) ? cartModule : []);
      if (!Array.isArray(cartArray)) return 0;

      const keys = ['id', 'productId', 'name', 'cartId', 'itemId'];
      for (const it of cartArray) {
        if (!it) continue;
        for (const k of keys) {
          if (it[k] != null && String(it[k]) === String(id)) {
            return Number(it.qty ?? it.quantity ?? 0) || 0;
          }
        }
        if (String(it) === String(id)) return Number(it.qty ?? 0) || 0;
      }
    } catch {
      // ignore
    }
    return 0;
  }
}
