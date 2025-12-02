import { pluralize } from '../../utils.js';
/**
 * TotalsAndBadges — расчёт totals, обновление бейджей и miniCart render
 * ctx — CartUI
 */
export class TotalsAndBadges {
  constructor(ctx) {
	this.shopMatic = ctx.shopMatic;
    this.ctx = ctx;
	this.goodsWordsArr = ['товар', 'товара', 'товаров'];
  }

  calculateTotals() {
    const c = this.ctx;
    let totalCount = 0;
    let totalSum = 0;
    for (const it of c.cart) {
      let included = c.included.ensureItemIncluded(it);
      if (included === false) continue; // skip excluded
      totalCount += Number(it.qty || 0);
      totalSum += Number(it.price || 0) * Number(it.qty || 0);
    }
    return { totalCount, totalSum };
  }

  updateBadges(totalCount) {
    const c = this.ctx;
    try {
      if (c.headerCartNum) {
        c.headerCartNum.textContent = String(totalCount);
		$("#cartSummaryWord").html(pluralize(totalCount || 0, this.goodsWordsArr));
        c.headerCartNum.style.display = totalCount > 0 ? 'inline-flex' : 'none';
        c.headerCartNum.setAttribute('aria-hidden', totalCount > 0 ? 'false' : 'true');

		if(this.shopMatic.deviceUtil.isMobile) {
			if (c.mobileCartNum) {
			  c.mobileCartNum.textContent = String(totalCount);
			  c.mobileCartNum.style.display = totalCount > 0 ? 'inline-flex' : 'none';
			  c.mobileCartNum.setAttribute('aria-hidden', totalCount > 0 ? 'false' : 'true');
			}
			
			document.getElementById('mobileProductCount').innerHTML = String(totalCount);
			document.getElementById('mobileProductWord'). innerHTML = pluralize(totalCount || 0, this.goodsWordsArr);
		}
      }
    } catch (e) {
      c._logError('headerCartNum update failed', e);
    }

    try {
      if (c.miniCart && typeof c.miniCart.updateHeader === 'function') {
        c.miniCart.updateHeader(totalCount);
      }
    } catch (e) {
      c._logError('miniCart.updateHeader failed', e);
    }
  }

  async renderMiniCart() {
    const c = this.ctx;
    try {
      if (c.miniCart && typeof c.miniCart.render === 'function') {
        const maybe = c.miniCart.render(c.cart);
        if (c._isThenable(maybe)) {
          await maybe.catch((err) => c._logError('miniCart.render failed', err));
        }
      }
    } catch (e) {
      c._logError('miniCart.render threw', e);
    }
  }

  updateTotalsUI(totalCount, totalSum) {
    const c = this.ctx;
    try {
      if (c.cartTotal) c.cartTotal.textContent = c._formatPrice(totalSum);
      if (c.miniCartTotal) c.miniCartTotal.textContent = c._formatPrice(totalSum);
      if (c.cartCountInline) c.cartCountInline.textContent = String(totalCount);
    } catch (e) {
      c._logError('totals update failed', e);
    }

    // update master select state visual
    c.included.updateMasterSelectState();
	document.getElementById('mobileTotalPrice').innerHTML = c._formatPrice(totalSum);
  }

  updateFavButtonState(row, id) {
    const c = this.ctx;
    if (!row || !id || !c.favorites) return;
    try {
      const favBtn = row.querySelector && row.querySelector('.fav-btn');
      if (!favBtn) return;
      let isFav = false;
      try {
        if (typeof c.favorites.isFavorite === 'function') {
          isFav = !!c.favorites.isFavorite(id);
        } else if (Array.isArray(c.favorites.getAll && c.favorites.getAll())) {
          isFav = c.favorites.getAll().indexOf(id) >= 0;
        }
      } catch (e) {
        isFav = false;
      }
      favBtn.classList.toggle('is-fav', isFav);
      favBtn.setAttribute('aria-pressed', String(isFav));
      const icon = favBtn.querySelector && favBtn.querySelector('i');
      if (icon) icon.classList.toggle('active', isFav);
    } catch (e) {
      c._logError('_updateFavButtonState failed', e);
    }
  }
}
