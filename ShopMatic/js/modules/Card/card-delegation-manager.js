// card-delegation-manager.js
export class CardDelegationManager {
  /**
   * @param {Object} card       — инстанс карточек (this.card)
   * @param {Object} domHelper  — хелпер для DOM (если нужен)
   * @param {Object} cartHelper — хелпер корзины
   */
  constructor(card, domHelper, cartHelper) {
    this.card = card;
    this.dom = domHelper;
    this.cart = cartHelper;
	this.foxEngine = this.card.shopMatic.foxEngine;

    // локальное хранилище обработчиков по контейнеру (WeakMap = не мешаем GC)
    this._delegationHandlers = new WeakMap();
  }

  // ---------------------------------------------------------------------------
  // Публичные методы
  // ---------------------------------------------------------------------------

  /**
   * Привязка делегирования к контейнеру (список карточек).
   * Если контейнер не указан — берём корневой root из shopMatic.
   *
   * @param {Element} [container=this.card.shopMatic.root]
   */
  bindCardDelegation(container = this.card?.shopMatic?.root) {
    this._bindDelegationTarget(container);
  }

  /**
   * Привязка обработчиков только к одной карточке.
   * Внутри используется тот же механизм делегирования, просто корнем
   * выступает сама карточка.
   *
   * @param {Element} cardEl
   */
  bindCard(cardEl) {
    if (!cardEl) return;
    this._bindDelegationTarget(cardEl);
  }

  /**
   * Отвязываем делегирование.
   *
   * @param {Element|null} [container=null]
   *   - если передан контейнер/карточка — снимаем обработчики только с него
   *   - если не передан — снимаем со всех контейнеров, зарегистрированных
   *     в shopMatic._delegationHandlers
   */
  destroyDelegation(container = null) {
    const shopMatic = this.card?.shopMatic;
    if (!shopMatic || !shopMatic._delegationHandlers) return;

    try {
      // Удалить только с одного контейнера
      if (container) {
        const h =
          this._delegationHandlers.get(container) ||
          shopMatic._delegationHandlers.get(container);

        if (h) {
          try {
            container.removeEventListener('click', h.clickHandler);
          } catch {}
          try {
            container.removeEventListener('input', h.inputHandler);
          } catch {}
          shopMatic._delegationHandlers.delete(container);
          try {
            this._delegationHandlers.delete(container);
          } catch {}
        }
        return;
      }

      // Удалить со всех контейнеров
      for (const [cont, h] of Array.from(
        shopMatic._delegationHandlers.entries(),
      )) {
        try {
          cont.removeEventListener('click', h.clickHandler);
        } catch {}
        try {
          cont.removeEventListener('input', h.inputHandler);
        } catch {}
        shopMatic._delegationHandlers.delete(cont);
      }

      // пересоздаём WeakMap, чтобы точно сбросить ссылки
      this._delegationHandlers = new WeakMap();
    } catch (e) {
      if (shopMatic?.opts?.debug) {
        console.error('[Card] destroyDelegation failed', e);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Внутренние помощники
  // ---------------------------------------------------------------------------

  /**
   * Общая точка входа: привязка делегирования к любому "корню"
   * (контейнеру списка или конкретной карточке).
   *
   * @param {Element} rootEl
   * @private
   */
  _bindDelegationTarget(rootEl) {
    const card = this.card;
    const shopMatic = card.shopMatic;
	if (!rootEl || !card || !shopMatic || !this.cart) return;
    this.foxEngine.log('Binding card actions for:', 'DEBUG');
	if(this.foxEngine.debug) {
		console.log(rootEl);
	}

    // Инициализируем глобальный реестр обработчиков на стороне shopMatic
    if (!shopMatic._delegationHandlers) {
      shopMatic._delegationHandlers = new Map();
    }

    // Не дублируем обработчики, если уже повесили на этот root
    if (this._delegationHandlers.has(rootEl)) return;
    if (shopMatic._delegationHandlers.has(rootEl)) return;

    const findQtyControls = (el) => this._findQtyControls(el);

    const clickHandler = (ev) => {
      const t = ev.target;
      if (!t || !rootEl.contains(t)) return;

      const cardEl =
        t.closest?.(
          '[data-product-id], [data-id], [data-name], [data-cart-id], [data-item-id]',
        ) || null;

      const idFromCard = card._getIdFromElement(cardEl);

      // -------------------------------------------------------------
      // Избранное
      // -------------------------------------------------------------
      const favBtn = t.closest?.('[data-role="fav"], .fav-btn');
      if (favBtn && rootEl.contains(favBtn)) {
        ev.stopPropagation();

        const id =
          card._getIdFromElement(
            favBtn.closest(
              '[data-product-id], [data-id], [data-name], [data-cart-id], [data-item-id]',
            ),
          ) || idFromCard;

        if (!id) return;

        try {
          const res = shopMatic.favorites.toggle(id);
		  card._applyFavState(cardEl, shopMatic.isFavorite(id));

          if (typeof shopMatic._updateWishUI === 'function') {
            try {
              shopMatic._updateWishUI();
            } catch {}
          }

          const icon = favBtn.querySelector?.('i');
          if (icon) {
            icon.classList.add('animate-pop');
            setTimeout(() => icon.classList.remove('animate-pop'), 380);
          }
		 

          if (res && typeof res.then === 'function') {
            res.catch(() => {});
          }
        } catch (e){
          shopMatic?.notifications?.show?.(
            card._msg('FAVORITES_UNAVAILABLE'),
            { type: 'error' },
          );
        }
        return;
      }

      // -------------------------------------------------------------
      // "Купить сейчас"
      // -------------------------------------------------------------
      const buyNowBtn = t.closest?.(
        '[data-role="buy-now"], [data-action="buy-now"], .buyNow',
      );
      if (buyNowBtn && rootEl.contains(buyNowBtn)) {
        ev.stopPropagation();

        const id =
          card._getIdFromElement(
            buyNowBtn.closest('[data-product-id], [data-id], [data-name]'),
          ) || idFromCard;

        this.cart.handleBuyNowClick(ev, { card: cardEl, id });
        return;
      }

      // -------------------------------------------------------------
      // "Купить / в корзину"
      // -------------------------------------------------------------
      const buyBtn = t.closest?.(
        '[data-role="buy"], [data-action="buy"], .btn-buy',
      );
      if (buyBtn && rootEl.contains(buyBtn)) {
        ev.stopPropagation();

        const id =
          card._getIdFromElement(
            buyBtn.closest('[data-product-id], [data-id], [data-name]'),
          ) || idFromCard;

        const { input } = findQtyControls(cardEl);
        const desired = input
          ? Math.max(1, parseInt(input.value || '1', 10))
          : 1;

        this.cart.handleBuyAction({
          card: cardEl,
          id,
          desired,
          isBuyNow: false,
        });
        return;
      }

      // -------------------------------------------------------------
      // Минус количества
      // -------------------------------------------------------------
      const decrBtn = t.closest?.(
        '[data-role="qty-minus"], .qty-decr, [data-action="qty-decr"]',
      );
      if (decrBtn && rootEl.contains(decrBtn)) {
        ev.stopPropagation();

        const row =
          decrBtn.closest(
            '[data-product-id], [data-id], [data-name], .cart-row',
          ) ||
          decrBtn.closest('li') ||
          decrBtn.parentElement;

        const id = card._getIdFromElement(row) || idFromCard;
        const { input } = findQtyControls(row);
        if (!input) return;

        let current = parseInt(input.value || '1', 10);
        if (isNaN(current)) current = 1;

        this.cart.applyQtyChange(id, row, current - 1);
        return;
      }

      // -------------------------------------------------------------
      // Плюс количества
      // -------------------------------------------------------------
      const incrBtn = t.closest?.(
        '[data-role="qty-plus"], .qty-incr, [data-action="qty-incr"]',
      );
      if (incrBtn && rootEl.contains(incrBtn)) {
        ev.stopPropagation();

        const row =
          incrBtn.closest('[data-product-id], [data-id], [data-name], .cart-row') ||
          incrBtn.closest('li') ||
          incrBtn.parentElement;

        const id = card._getIdFromElement(row) || idFromCard;
        const { input } = findQtyControls(row);
        if (!input) return;

        let current = parseInt(input.value);
        if (isNaN(current) || current < 1) current = 1;

        this.cart.applyQtyChange(id, row, current + 1);
        return;
      }
    };

    const inputHandler = (ev) => {
      const inputEl = ev.target;
      if (
        !inputEl?.matches?.(
          '[data-role="qty-input"], .qty-input, input[type="number"]',
        )
      )
        return;

      const row =
        inputEl.closest(
          '[data-product-id], [data-id], [data-name], .cart-row',
        ) || inputEl.parentElement;

      const id = card._getIdFromElement(row);
      let v = parseInt(inputEl.value);
      if (isNaN(v) || v < 0) v = 0;

      this.cart.applyQtyChange(id, row, v);
    };

    try {
      rootEl.addEventListener('click', clickHandler, { passive: true });
      rootEl.addEventListener('input', inputHandler);

      const handlers = { clickHandler, inputHandler };

      this._delegationHandlers.set(rootEl, handlers);
      shopMatic._delegationHandlers.set(rootEl, handlers);
    } catch (e) {
      if (shopMatic?.opts?.debug) {
        console.error('[Card] attach listeners failed', e);
      }
    }
  }

  /**
   * Поиск контролов количества внутри строки/карточки.
   *
   * @param {Element|null} el
   * @returns {{input: Element|null, incr: Element|null, decr: Element|null, buy: Element|null, buyNow: Element|null}}
   * @private
   */
  _findQtyControls(el) {
    if (!el?.querySelector) {
      return { input: null, incr: null, decr: null, buy: null, buyNow: null };
    }

    return {
      input: el.querySelector(
        '[data-role="qty-input"], .qty-input, input[type="number"]',
      ),
      incr: el.querySelector(
        '[data-role="qty-plus"], .qty-incr, [data-action="qty-incr"]',
      ),
      decr: el.querySelector(
        '[data-role="qty-minus"], .qty-decr, [data-action="qty-decr"]',
      ),
      buy: el.querySelector(
        '[data-role="buy"], [data-action="buy"], .btn-buy',
      ),
      buyNow: el.querySelector(
        '[data-role="buy-now"], [data-action="buy-now"], .buyNow',
      ),
    };
  }
}