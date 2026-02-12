// card-cart-helper.js
export class CardCartHelper {
  constructor(card, domHelper, stockHelper) {
    this.card = card;
    this.dom = domHelper;
    this.stock = stockHelper;

    // Stable handler for "go to cart" mode (no re-alloc per sync)
    this._goToCartHandler = this._goToCartHandler.bind(this);

    // Stable HTML once (no string rebuild)
    this._toCartHtml =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" class="_1w4N_" width="16" height="16">
        <path fill="#21201F" fill-rule="evenodd" d="M0 5.752a.5.5 0 0 1 .5-.5h8.65L5.304 1.406a.5.5 0 0 1 0-.707l.342-.343a.5.5 0 0 1 .708 0L12 6.002 6.354 11.65a.5.5 0 0 1-.708 0l-.342-.343a.5.5 0 0 1 0-.707L9.15 6.752H.5a.5.5 0 0 1-.5-.5v-.5Z" clip-rule="evenodd"></path>
      </svg> Корзина`;
  }

  // ---------------------------
  // Public API
  // ---------------------------

// ✅ drop-in replacement for your removeFromCart (keeps OOP + restores base listener + redraw button)
removeFromCart(id, cardEl) {
  if (!id) return;
  const { shopMatic } = this.card;

  let res = null;
  try {
    if (typeof shopMatic.removeFromCart === 'function') res = shopMatic.removeFromCart(id);
    else if (shopMatic.cart?.remove) res = shopMatic.cart.remove(id);
    else if (shopMatic.changeQty) res = shopMatic.changeQty(id, 0);
  } catch {}

  const after = () => {
    // 1) Если ререндеришь — ререндерь
    shopMatic.card?.rerenderCardById?.(id);

    // 2) ВАЖНО: после rerender нужно получить актуальный DOM-элемент карточки
    //    (потому что старый cardEl мог быть заменён)
    requestAnimationFrame(() => {
      const freshCardEl =
        shopMatic.root?.querySelector?.(`[data-id="${CSS.escape(id)}"], [data-product-id="${CSS.escape(id)}"], [data-name="${CSS.escape(id)}"]`)
        || cardEl;

      // 3) Теперь реально снять "go to cart" перехватчик и вернуть режим "add"
      this._restoreBaseBuyButton(freshCardEl);

      // 4) И синкнуть состояние
      this.syncCardControlsState(freshCardEl, { cause: 'removed' });
    });
  };

  if (res && typeof res.then === 'function') res.then(after).catch(after);
  else after();
}

/**
 * Restore "Add to cart" mode:
 * - remove "go to cart" handler
 * - restore original onclick if it existed
 * - reset presence cache so next sync can safely re-apply state
 * - restore original label immediately (no extra reflows later)
 */
_restoreBaseBuyButton(cardEl) {
  if (!cardEl) return;
  const s = this.dom.getCardSelectors(cardEl);
  const btn = s?.buyBtn;
  if (!btn) return;

  if (btn.dataset.cartNavBound) {
    delete btn.dataset.cartNavBound;
    try { btn.removeEventListener('click', this._goToCartHandler, true); } catch {}
  }

  // вернуть текст
  const originalText = btn.dataset.originalText || btn.dataset.label || 'В Корзину';
  if ((btn.textContent || '').trim() !== String(originalText).trim()) {
    btn.textContent = String(originalText);
  }

  delete btn.dataset.state;
  btn.dataset.cartPresence = '0';
}


  /**
   * Sync UI with minimum DOM mutations.
   * @param {HTMLElement} cardEl
   * @param {{cause?: 'qty'|'removed'|'init'|'external'}} opts
   */
  syncCardControlsState(cardEl, opts = {}) {
    if (!cardEl) return;
    const id = this.card._getIdFromElement(cardEl);
    if (!id) return;

    const s = this.dom.getCardSelectors(cardEl);

    const available = this.stock.computeAvailableStock(id);
    const inCartQty = this.stock.findCartQtyById(id);
    const hasAvailable = available > 0;
    const inCart = inCartQty > 0;
    const totalStock = available + inCartQty;

    // Only update button (label + click mode) when:
    // - item was removed (cart->add)
    // - OR first time sync/init (to set correct initial state)
    // Not on regular qty changes.
    const shouldUpdateBuyBtn =
      opts.cause === 'removed' || opts.cause === 'init' || opts.cause === 'external';

    requestAnimationFrame(() => {
      // -------- stock/left text (cheap updates with guards) ----------
      if (s.leftNum) this._setTextIfChanged(s.leftNum, String(available));

      if (s.stock) {
        const next = String(this.card._msg('PRODUCT_LEFT', { left: available }));
        this._setTextIfChanged(s.stock, next);
        this._setHidden(s.stock, !hasAvailable);
      }

      // base disable state (idempotent)
      this.dom.toggleDisabled(s.buyBtn, !hasAvailable && !inCart);

      // ✅ minimal redraw: only on removed/init/external
      if (shouldUpdateBuyBtn) {
        this._syncBuyButtonMode(s.buyBtn, { inCartNow: inCart });
      } else {
        // still keep disabled correct even if we don't redraw
        // (toggleDisabled already done)
      }

      // -------- qty input ----------
      if (s.qtyInput) {
        if (!hasAvailable && !inCart) {
          // disabled state only if differs
          if (!s.qtyInput.disabled) s.qtyInput.disabled = true;
          if (s.qtyInput.getAttribute('aria-disabled') !== 'true') {
            s.qtyInput.setAttribute('aria-disabled', 'true');
          }
          if (s.qtyInput.value !== '0') s.qtyInput.value = '0';
        } else {
          const maxQty = Math.max(0, totalStock);

          let baseRaw = s.qtyInput.value;
          if (!baseRaw) baseRaw = inCart ? String(inCartQty || 1) : '1';
          else if (inCart && Number(baseRaw) < inCartQty) baseRaw = String(inCartQty);

          const val = this.card._clampQty(baseRaw, 1, maxQty);

          if (s.qtyInput.disabled) s.qtyInput.disabled = false;
          if (s.qtyInput.hasAttribute('aria-disabled')) s.qtyInput.removeAttribute('aria-disabled');

          if (s.qtyInput.value !== String(val)) s.qtyInput.value = String(val);

          // attributes only when changed
          this._setAttrIfChanged(s.qtyInput, 'min', '1');
          this._setAttrIfChanged(s.qtyInput, 'max', String(maxQty));
        }
      }

      const curVal = s.qtyInput ? Math.max(0, parseInt(s.qtyInput.value || '0', 10)) : 0;

      // plus button disable state
      this.dom.toggleDisabled(
        s.incrBtn,
        (!hasAvailable && !inCart) || curVal >= (inCart ? totalStock : available)
      );

      // never block minus (as requested earlier)
      this.dom.toggleDisabled(s.decrBtn, false);

      // show/hide blocks only when changed
      if (s.inputControls) this._setDisplay(s.inputControls, inCart ? '' : 'none');
      if (s.buyNow) this._setDisplay(s.buyNow, inCart ? 'none' : '');

      // -------- limit message ----------
      const existing = cardEl.querySelector?.(`.${this.card._limitMsgClass}`);
      if (!hasAvailable) {
        this.dom.toggleDisabled(s.buyBtn, true);
        if (!existing) {
          const m = this.dom.createLimitMsg(this.card._msg('PRODUCT_LIMIT_DEFAULT'));
          (s.controlsWrapper || cardEl).appendChild(m);
          requestAnimationFrame(() => (m.style.opacity = '1'));
        }
      } else if (existing) {
        existing.style.opacity = '0';
        setTimeout(() => existing?.parentNode?.removeChild(existing), 300);
      }
    });
  }

  applyQtyChange(id, row, newVal) {
    if (!row) return;
    const { shopMatic } = this.card;

    const findControls = (el) => ({
      input: el?.querySelector?.('[data-role="qty-input"], .qty-input, input[type="number"]'),
      incr: el?.querySelector?.('[data-role="qty-plus"], .qty-incr, [data-action="qty-incr"]'),
      decr: el?.querySelector?.('[data-role="qty-minus"], .qty-decr, [data-action="qty-decr"]'),
      buy: el?.querySelector?.('[data-role="buy"], [data-action="buy"], .btn-buy')
    });

    const { input, incr, buy } = findControls(row);

    const cleanId = String(id ?? '').trim();
    if (!cleanId) return;

    const inCartQty = this.stock.findCartQtyById(cleanId);
    const available = this.stock.computeAvailableStock(cleanId);
    const totalStock = Math.max(0, Number(inCartQty || 0) + Number(available || 0));
    const maxQty = totalStock;

    if (newVal <= 0) {
      if (input) input.value = '0';
      this.removeFromCart(cleanId, row);
      return;
    }

    if (maxQty <= 0) {
      if (input) input.value = '0';
      this.removeFromCart(cleanId, row);
      return;
    }

    let val = Number.isFinite(Number(newVal)) ? Number(newVal) : 1;
    if (val < 1) val = 1;
    if (val > maxQty) val = maxQty;

    // ✅ Minimal DOM: touch only what changed
    if (input && input.value !== String(val)) input.value = String(val);
    if (input) {
      this._setAttrIfChanged(input, 'min', '1');
      this._setAttrIfChanged(input, 'max', String(maxQty));
    }

    if (incr) this.dom.toggleDisabled(incr, val >= maxQty);
    if (buy) this.dom.toggleDisabled(buy, maxQty <= 0);

    const changeRes = shopMatic.changeQty?.(cleanId, val);
    if (changeRes && typeof changeRes.then === 'function') changeRes.catch(() => {});

    // ✅ IMPORTANT: on qty changes we DO NOT redraw buy button / listener
    this.syncCardControlsState(row, { cause: 'qty' });
  }

  handleBuyAction({ card, id, desired = 1, isBuyNow = false }) {
    const { shopMatic } = this.card;
    const available = this.stock.computeAvailableStock(id);

    if (available <= 0) {
      shopMatic.notifications?.show?.(this.card._msg('CANNOT_ADD_NO_STOCK'), {
        duration: shopMatic.opts?.notificationDuration
      });
      shopMatic._syncAllCardsControls?.();
      return;
    }

    const qtyToAdd = Math.min(desired, available);

    if (qtyToAdd < desired) {
      shopMatic.notifications?.show?.(
        this.card._msg('ADDED_PARTIAL', { added: qtyToAdd, available }),
        { duration: shopMatic.opts?.notificationDuration }
      );
    }

    let res = null;
    if (isBuyNow && typeof shopMatic.buyNow === 'function') res = shopMatic.buyNow(id, qtyToAdd);
    else res = shopMatic.cart?.add?.(id, qtyToAdd);

    // ✅ On "add" we usually need to switch button into "cart" mode once.
    const sync = () => this.syncCardControlsState(card, { cause: 'external' });

    if (res && typeof res.then === 'function') res.then(sync).catch(sync);
    else sync();
  }

  handleBuyNowClick(e, { card, id }) {
    const c = card || this.card.shopMatic?.root || document;
    if (!c) return;

    const ctx = this.card.shopMatic?.ctx || this.card.shopMatic;
    const product =
      ctx?.getProductSync?.(id) || this.card.shopMatic?.productService?.findById?.(id) || null;

    if (!product) return;

    const qtyEl = c.querySelector('.qty-input') || c.querySelector('[data-role="qty-input"]');

    let stock = 0;
    if (ctx?.computeStock) {
      try { stock = Number(ctx.computeStock(product) || 0); }
      catch { stock = Number(product.stock ?? 0); }
    } else {
      stock = Number(product.stock ?? 0);
    }

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
          try { JSON.parse(product.picture); return product.picture; }
          catch { return JSON.stringify([product.picture]); }
        }
        if (Array.isArray(product.picture)) return JSON.stringify(product.picture);
        return '[]';
      })(),
      specs: product.specs ?? product.description ?? ''
    };

    const shop = ctx?.shop || this.card.shopMatic?.shop || this.card.shopMatic;
    if (shop?.router?.toPage) shop.router.toPage('checkout');
    else if (shop?.router?.go) shop.router.go('#page/checkout');
    else location.hash = '#page/checkout';

    setTimeout(() => {
      const shop = ctx?.shop || this.card.shopMatic?.shop || this.card.shopMatic;
      if (shop && shop.checkoutPage) shop.checkoutPage.init('#test', { buyNowItem });
      else console.warn('[Card] checkoutPage не инициализирован');
    }, 800);
  }

  syncAllCardsIn(container = this.card.shopMatic?.root) {
    if (!container) return;
    const cards =
      container.querySelectorAll?.(
        '[data-product-id], [data-id], [data-name], .product-card, .catalog-item'
      ) || [];
    for (const c of cards) {
      this.syncCardControlsState(c, { cause: 'init' });
    }
  }

  // ---------------------------
  // Private helpers (OOП)
  // ---------------------------

  _goToCartHandler(ev) {
    try { ev?.preventDefault?.(); } catch {}
    try { ev?.stopPropagation?.(); } catch {}

    const shop = this.card?.shopMatic;
    if (shop?.router?.go) {
      shop.router.go('#page/cart');
      return;
    }
    try {
      const sm = this.card?.shopMatic;
      if (sm?.router?.toPage) return sm.router.toPage('cart');
      if (sm?.router?.go) return sm.router.go('#page/cart');
      if (location.hash !== '#page/cart') location.hash = '#page/cart';
      else window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch {}
  }

  _syncBuyButtonMode(btn, { inCartNow }) {
    if (!btn) return;

    // store original label and onclick only once
    if (!btn.dataset.originalText) {
      const original =
        (btn.dataset.label && String(btn.dataset.label).trim()) ||
        (btn.textContent && String(btn.textContent).trim()) ||
        'В Корзину';
      btn.dataset.originalText = original;
    }
    if (!btn.dataset.originalOnClickStored) {
      btn.__originalOnClick = typeof btn.onclick === 'function' ? btn.onclick : null;
      btn.dataset.originalOnClickStored = '1';
    }

    // presence guard (no work if not changed)
    const prev = btn.dataset.cartPresence === '1';
    const next = !!inCartNow;
    if (prev === next) return;
    btn.dataset.cartPresence = next ? '1' : '0';

    // ensure fade config once
    if (!btn.dataset.fadeTextReady) {
      btn.dataset.fadeTextReady = '1';
      btn.style.transition = btn.style.transition
        ? `${btn.style.transition}, opacity 180ms ease`
        : 'opacity 180ms ease';
    }

    const setHtmlSmooth = (nextHtml) => {
      const next = String(nextHtml || '').trim();
      if (!next) return;
      if (btn.dataset.fadeTextAnimating === '1') return;
      btn.dataset.fadeTextAnimating = '1';

      btn.style.opacity = '0';
      setTimeout(() => {
        // minimal: update only if really different
        if ((btn.innerHTML || '').trim() !== next) btn.innerHTML = next;
        btn.style.opacity = '1';
        setTimeout(() => {
          delete btn.dataset.fadeTextAnimating;
        }, 220);
      }, 190);
    };

    if (next) {
      // switch to cart mode
      setHtmlSmooth(this._toCartHtml);
      btn.dataset.state = 'in-cart';

      if (!btn.dataset.cartNavBound) {
        try { btn.onclick = null; } catch {}
        btn.addEventListener('click', this._goToCartHandler, true);
        btn.dataset.cartNavBound = '1';
      }
      return;
    }

    // switch back to add mode (only on full remove)
    setHtmlSmooth(btn.dataset.originalText || 'В Корзину');
    delete btn.dataset.state;

    if (btn.dataset.cartNavBound) {
      delete btn.dataset.cartNavBound;
      try { btn.removeEventListener('click', this._goToCartHandler, true); } catch {}
    }
    if (btn.__originalOnClick) {
      try { btn.onclick = btn.__originalOnClick; } catch {}
    }
  }

  _setTextIfChanged(el, nextText) {
    if (!el) return;
    const next = String(nextText ?? '');
    if (el.textContent !== next) el.textContent = next;
  }

  _setAttrIfChanged(el, name, value) {
    if (!el) return;
    const next = String(value ?? '');
    if (el.getAttribute(name) !== next) el.setAttribute(name, next);
  }

  _setHidden(el, hidden) {
    if (!el) return;
    const shouldHide = !!hidden;
    const isHidden = el.hasAttribute('hidden');
    if (shouldHide && !isHidden) el.setAttribute('hidden', 'true');
    if (!shouldHide && isHidden) el.removeAttribute('hidden');
  }

  _setDisplay(el, displayValue) {
    if (!el) return;
    const next = displayValue ?? '';
    if (el.style.display !== next) el.style.display = next;
  }
}
