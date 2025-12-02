/**
 * GridListeners — управление событиями грида и делегирование действий
 * ctx — CartUI (контекст)
 */
export class GridListeners {
  constructor(ctx) {
    this.ctx = ctx;
  }

  attachGridListeners() {
    const c = this.ctx;
    if (!c.cartGrid) return;
    if (c._gridListenersAttachedTo && c._gridListenersAttachedTo !== c.cartGrid) {
      this.detachGridListeners();
    }
    if (c._gridHandler) return;

    c._gridHandler = (ev) => this.handleGridClick(ev);
    c._gridInputHandler = (ev) => this.handleGridInput(ev);

    try {
      c.cartGrid.addEventListener('click', c._gridHandler);
      c.cartGrid.addEventListener('change', c._gridInputHandler);
      c._gridListenersAttachedTo = c.cartGrid;
    } catch (e) {
      c._logError('_attachGridListeners failed', e);
    }
  }

  detachGridListeners() {
    const c = this.ctx;
    if (!c._gridListenersAttachedTo) return;
    try {
      c._gridListenersAttachedTo.removeEventListener('click', c._gridHandler);
      c._gridListenersAttachedTo.removeEventListener('change', c._gridInputHandler);
    } catch (e) {
      c._logError('_detachGridListeners error', e);
    }
    c._gridHandler = null;
    c._gridInputHandler = null;
    c._gridListenersAttachedTo = null;
  }

  handleGridClick(ev) {
    const c = this.ctx;
    const target = ev.target;
    const row = c.rowSync.findRowFromElement(target);
    if (!row) return;
    const id = c.rowSync.getIdFromRow(row);
    if (!id) return;

    const closest = (sel) => (target.closest && target.closest(sel)) || null;

    const fav = closest('.fav-btn, [data-role="fav"]');
    if (fav) {
      ev.preventDefault();
      this.handleFavClick(id, row);
      return;
    }

    const plus = closest('.qty-btn.qty-incr, [data-action="qty-incr"], [data-role="qty-plus"]');
    if (plus) {
      ev.preventDefault();
      this.handlePlusClick(id, row);
      return;
    }

    const minus = closest('.qty-btn.qty-decr, [data-action="qty-decr"], [data-role="qty-minus"]');
    if (minus) {
      ev.preventDefault();
      this.handleMinusClick(id, row);
      return;
    }

    const rem = closest('.remove-btn, [data-action="remove"], [data-role="remove"]');
    if (rem) {
      ev.preventDefault();
      this.handleRemoveClick(id);
    }
  }

  handleGridInput(ev) {
    const c = this.ctx;
    const input = ev.target;
    if (!input) return;

    // qty inputs
    if (
      input.matches &&
      (input.matches('.qty-input') ||
        input.matches('[data-role="qty-input"]') ||
        input.matches('input[type="number"]'))
    ) {
      const row = c.rowSync.findRowFromElement(input);
      if (!row) return;
      const id = c.rowSync.getIdFromRow(row);
      if (!id) return;

      let v = parseInt(input.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      const max = parseInt(input.getAttribute('max') || '0', 10);
      if (Number.isFinite(max) && max > 0 && v > max) v = max;

      if (c.changeQty(id, v, { sourceRow: row })) {
        c.updateCartUI(id);
      }
      return;
    }

    // include-checkbox
    const isIncludeCheckbox =
      (input.matches &&
        (input.matches('input[data-role="include"]') ||
          input.matches('input.include-checkbox') ||
          input.matches('input[name="include"]'))) ||
      (!!input.closest && !!input.closest('.include-checkbox')) ||
      (!!input.closest && !!input.closest('.cart-item__include'));

    if (isIncludeCheckbox) {
      const row = c.rowSync.findRowFromElement(input);
      if (!row) return;
      const id = c.rowSync.getIdFromRow(row);
      if (!id) return;
      const checked = Boolean(input.checked);
      if (c.included.toggleInclude(id, checked, { sourceRow: row })) {
        c.updateCartUI(id);
      }
      return;
    }
  }

  handleFavClick(id, row) {
    const c = this.ctx;
    if (!c.favorites) {
      c.notifications?.show?.(c._msg('FAVORITES_UNAVAILABLE'), { type: 'error' });
      return;
    }
    try {
      let res;
      if (typeof c.favorites.toggle === 'function') {
        res = c.favorites.toggle(id);
      } else if (
        typeof c.favorites.add === 'function' &&
        typeof c.favorites.remove === 'function'
      ) {
        const now =
          typeof c.favorites.isFavorite === 'function' ? !!c.favorites.isFavorite(id) : false;
        res = now ? c.favorites.remove(id) : c.favorites.add(id);
      }

      const favBtnEl = row.querySelector && row.querySelector('.fav-btn');
      const isFavNow =
        typeof c.favorites.isFavorite === 'function' ? !!c.favorites.isFavorite(id) : false;
      if (favBtnEl) {
        favBtnEl.classList.toggle('is-fav', isFavNow);
        favBtnEl.setAttribute('aria-pressed', String(isFavNow));
      }

      const wishEl = document.getElementById && document.getElementById('wishNum');
      try {
        if (wishEl && typeof c.favorites.getCount === 'function') {
          wishEl.textContent = String(c.favorites.getCount());
        }
      } catch (_) {}

      if (res && c._isThenable(res)) {
        res
          .then(() => {
            const finalFav =
              typeof c.favorites.isFavorite === 'function' ? !!c.favorites.isFavorite(id) : false;
            if (favBtnEl) favBtnEl.classList.toggle('is-fav', finalFav);
            if (wishEl && typeof c.favorites.getCount === 'function') {
              wishEl.textContent = String(c.favorites.getCount());
            }
          })
          .catch((err) => c._logError('favorites operation failed', err));
      }
    } catch (e) {
      c._logError('fav handling failed', e);
    }
  }

  handlePlusClick(id, row) {
    const c = this.ctx;
    const item = c._getCartItemById(id);
    if (!item) return;
    const stock = Number(item.stock || 0);
    if (stock <= 0) {
      c.notifications?.show?.(c._msg('PRODUCT_OUT_OF_STOCK'), { type: 'warning' });
      c.rowSync.syncRowControls(row, item);
      return;
    }
    if (item.qty < stock) {
      if (c.changeQty(id, item.qty + 1, { sourceRow: row })) {
        c.updateCartUI(id);
      }
    } else {
      c.notifications?.show?.(c._msg('REACHED_MAX_STOCK_LIMIT_NOTIFY'), {
        type: 'warning'
      });
    }
  }

  handleMinusClick(id, row) {
    const c = this.ctx;
    const item = c._getCartItemById(id);
    if (!item) return;
    if (item.qty > 1 && c.changeQty(id, item.qty - 1, { sourceRow: row })) {
      c.updateCartUI(id);
    }
  }

  handleRemoveClick(id) {
    const c = this.ctx;
    if (c.remove(id)) {
      c.updateCartUI(id);
    }
  }
}
