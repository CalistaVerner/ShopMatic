import { pluralize, formatPrice } from '../../utils.js';

/**
 * TotalsAndBadges — totals calculation + badges/totals UI updates.
 * ctx — CartUI
 */
export class TotalsAndBadges {
  constructor(ctx) {
    this.shopMatic = ctx.shopMatic;
    this.foxEngine = this.shopMatic.foxEngine;
    this.ctx = ctx;
    this.goodsWordsArr = ['товар', 'товара', 'товаров'];
  }

  calculateTotals() {
    const { cart, included } = this.ctx;
    let totalCount = 0;
    let totalSum = 0;

    for (const it of cart) {
      const id = String(it?.name ?? it?.id ?? '').trim();
      const isIncluded =
        it?.included !== undefined
          ? !!it.included
          : (included?.get ? included.get(id) : true);

      if (!isIncluded) continue;

      const qty = Number(it?.qty || 0);
      const price = Number(it?.price || 0);

      totalCount += qty;
      totalSum += price * qty;
    }

    return { totalCount, totalSum };
  }

  updateBadges(totalCount) {
    const { ctx, shopMatic } = this;
    const { headerCartNum, mobileCartNum } = ctx;

    try {
      if (headerCartNum) {
        headerCartNum.textContent = String(totalCount);
        $("#cartSummaryWord").html(pluralize(totalCount || 0, this.goodsWordsArr));
        headerCartNum.style.display = totalCount > 0 ? 'inline-flex' : 'none';
        headerCartNum.setAttribute('aria-hidden', totalCount > 0 ? 'false' : 'true');
      }

      if (shopMatic.deviceUtil.isMobile) {
        if (mobileCartNum) {
          mobileCartNum.textContent = String(totalCount);
          mobileCartNum.style.display = totalCount > 0 ? 'inline-flex' : 'none';
          mobileCartNum.setAttribute('aria-hidden', totalCount > 0 ? 'false' : 'true');
        }

        const mobileProductCount = document.getElementById('mobileProductCount');
        const mobileProductWord = document.getElementById('mobileProductWord');
        if (mobileProductCount) mobileProductCount.textContent = String(totalCount);
        if (mobileProductWord) mobileProductWord.innerHTML = pluralize(totalCount || 0, this.goodsWordsArr);
      }
    } catch (e) {
      ctx._logError('header/mobile badge update failed', e);
    }

    try {
      if (ctx.miniCart?.updateHeader) ctx.miniCart.updateHeader(totalCount);
    } catch (e) {
      ctx._logError('miniCart.updateHeader failed', e);
    }
  }

  async renderMiniCart() {
    const { ctx } = this;
    try {
      if (!ctx.miniCart?.render) return;
      const maybe = ctx.miniCart.render(ctx.cart);
      if (ctx._isThenable(maybe)) await maybe.catch((err) => ctx._logError('miniCart.render failed', err));
    } catch (e) {
      ctx._logError('miniCart.render threw', e);
    }
  }

  updateTotalsUI(totalCount, totalSum) {
    const { ctx } = this;

    // Mobile checkout block lifecycle is owned by CheckoutController.
    // TotalsAndBadges only updates numbers.

    try {
      if (ctx.cartTotal) ctx.cartTotal.textContent = formatPrice(totalSum);
      if (ctx.miniCartTotal) ctx.miniCartTotal.textContent = formatPrice(totalSum);
      if (ctx.cartCountInline) ctx.cartCountInline.textContent = String(totalCount);

      ctx.included?.updateMasterSelectState?.();

      const mobileTotalPrice = document.getElementById('mobileTotalPrice');
      if (mobileTotalPrice) mobileTotalPrice.innerHTML = formatPrice(totalSum);
    } catch (e) {
      ctx._logError('totals update failed', e);
    }
  }

  updateFavButtonState(row, id) {
    const { ctx } = this;
    if (!row || !id || !ctx.favorites) return;

    try {
      const favBtn = row.querySelector('.fav-btn');
      if (!favBtn) return;

      let isFav = false;
      try {
        if (typeof ctx.favorites.isFavorite === 'function') {
          isFav = !!ctx.favorites.isFavorite(id);
        } else if (Array.isArray(ctx.favorites.getAll && ctx.favorites.getAll())) {
          isFav = ctx.favorites.getAll().includes(id);
        }
      } catch {
        isFav = false;
      }

      favBtn.classList.toggle('is-fav', isFav);
      favBtn.setAttribute('aria-pressed', String(isFav));
      const icon = favBtn.querySelector('i');
      if (icon) icon.classList.toggle('active', isFav);
    } catch (e) {
      ctx._logError('_updateFavButtonState failed', e);
    }
  }
}
