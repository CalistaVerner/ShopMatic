import { formatPrice, makeSpecHtmlPreview, pluralize } from '../utils.js';
import { RecipientAddressController } from './RecipientAddressController.js';
import { DeliveryBlockController } from './DeliveryBlockController.js';

/**
 * Представление оформления заказа. Инкапсулирует работу с DOM,
 * контроллерами адреса получателя и блока доставки и предоставляет
 * методы для привязки обработчиков событий и управления UI.
 */
export class CheckoutView {
  constructor({ storage, foxEngine} = {}) {
    this.storage = storage;
    this.foxEngine = foxEngine;
    this.goodsWordsArr = ['товар', 'товара', 'товаров'];
    this._handlers = {};
    this._refs = new Map();
    this._listeners = [];

	/*
		if (this.storage && this.foxEngine) {
		  this.recipientAddressController = new RecipientAddressController({
			storage: this.storage,
			foxEngine: this.foxEngine,
			view: this
		  });
		  this.deliveryBlock = new DeliveryBlockController({
			root: document.querySelector('.deliveryBlock'),
			storage: this.storage,
			addressController: this.recipientAddressController
		  });
		}
	*/
  }

  /* DOM helpers */
  setContainer(container) {
    this.container = container instanceof HTMLElement
      ? container
      : document.querySelector(container) || null;
    this._refs.clear();
  }

  getContainer() {
    return this.container;
  }

  _qs(sel) {
    return this.container?.querySelector(sel) || null;
  }

  _qsa(sel) {
    return this.container ? Array.from(this.container.querySelectorAll(sel)) : [];
  }

  _cacheRef(key, el) {
    if (el) this._refs.set(key, el);
  }

  _getRef(key) {
    return this._refs.get(key) || null;
  }

  /* Config */
  setGoodsWords(wordsArr) {
    if (Array.isArray(wordsArr) && wordsArr.length) {
      this.goodsWordsArr = wordsArr;
    }
  }

  /* Event handling */
  bindEvents(handlers = {}) {
    if (!this.container) return;
    this._handlers = handlers || {};
    this._attach('.promo-code-apply', 'click', handlers.onApplyPromo);
    this._attach('.btn-checkout', 'click', handlers.onCheckout);
    this._attach('.btn-return-cart', 'click', handlers.onReturnToCart);
    this._attach(this.container, 'click', handlers.onContainerClick);
    this._attach(this.container, 'change', handlers.onContainerChange);
    if (handlers.onDeliveryPointSelect) {
      this._attach('.delivery-point-button', 'click', handlers.onDeliveryPointSelect);
    }
    if (handlers.onRecipientButton) {
      this._attach('.recipient-button', 'click', handlers.onRecipientButton);
    }
  }

  unbindEvents() {
    for (const { target, evt, fn } of this._listeners) {
      try {
        target.removeEventListener(evt, fn);
      } catch (e) {
        /* ignore */
      }
    }
    this._listeners.length = 0;
    this._handlers = {};
  }

  _attach(selectorOrEl, evt, fn, opts) {
    if (!fn || typeof fn !== 'function') return null;
    let target = null;
    if (typeof selectorOrEl === 'string') {
      target = this._qs(selectorOrEl);
    } else if (selectorOrEl instanceof Element || selectorOrEl === this.container) {
      target = selectorOrEl;
    }
    if (!target) return null;
    target.addEventListener(evt, fn, opts || false);
    this._listeners.push({ target, evt, fn });
    return { target, evt, fn };
  }

  /* UI API */
  toggleReturnToCartButton(isBuyNow, hasCartBackup) {
    const btn = this._qs('.btn-return-cart');
    if (!btn) return;
    btn.style.display = isBuyNow && hasCartBackup ? '' : 'none';
  }

  updateModeIndicator(isBuyNow) {
    const el = this._qs('#checkoutModeIndicator');
    if (!el) return;
    el.classList.toggle('buy-now', Boolean(isBuyNow));
    el.classList.toggle('cart', !isBuyNow);
    el.innerHTML = isBuyNow
      ? `<i class="fa-solid fa-bolt"></i><span>Купить сейчас</span>`
      : `<i class="fa-solid fa-cart-shopping"></i><span>Ваша корзина</span>`;
  }

  getPromoInputValue() {
    return this._qs('#promo-input')?.value?.trim() || '';
  }

  setPromoInputValue(value) {
    const inp = this._qs('#promo-input');
    if (inp) inp.value = value ?? '';
  }

  showPromoHint(message) {
    const hint = this._qs('#promo-hint');
    if (hint) hint.textContent = message || '';
  }

  /* Delivery options */
  async buildDeliveryOptions(deliveryOptions = []) {
    const host = this._qs('#deliveryOptions');
    if (!host) return;
    const frag = document.createDocumentFragment();
    for (const opt of deliveryOptions) {
      const card = document.createElement('div');
      card.className = 'delivery-card';
	  if(this.foxEngine.deviceUtil.isMobile) {
		  $(card).addClass('mobile');
	  }
      if (opt.disabled) card.classList.add('disabled');
      if (!opt.disabled && opt.checked) card.classList.add('checked');
      card.dataset.zoneName = 'deliveryTypeButton';
      card.dataset.zoneData = JSON.stringify({
        label: opt.label,
        deliveryType: opt.deliveryType
      });
	  let data = await this.foxEngine.templateRenderer.renderTemplate('deliveryLabel', 
		{
		  deliveryType: opt.deliveryType,
		  disabled: opt.disabled ? 'disabled' : '',
		  checked: opt.checked ? 'checked' : '',
		  label: opt.label,
		  description: opt.description,
		  time: opt.time,
		  price: opt.price
		});
      card.innerHTML = data;
      frag.appendChild(card);
    }
    host.replaceChildren(frag);
  }

  handleDeliveryClick(e) {
    const card = e.target.closest?.('.delivery-card');
    if (!card || card.classList.contains('disabled')) return;
    const radio = card.querySelector('input[type="radio"]');
    if (!radio) return;
    this._qsa('.delivery-card').forEach((c) => c.classList.remove('checked'));
    radio.checked = true;
    card.classList.add('checked');
  }

  handleDeliveryChange(e) {
    const radio = e.target.closest?.('input[type="radio"]');
    if (!radio) return;
    const card = radio.closest('.delivery-card');
    if (!card || card.classList.contains('disabled')) return;
    this._qsa('.delivery-card').forEach((c) => c.classList.remove('checked'));
    card.classList.add('checked');
  }

  /* Totals and cart rendering */
  updateTotalsUI(totalPrice, totalQty) {
    const totalEl = this._qs('#cart-total');
    const qtyEl = this._qs('#cart-count-inline');
    const wordEl = this._qs('#goodsNumWord');
    if (totalEl) totalEl.textContent = formatPrice(totalPrice ?? 0);
    if (qtyEl) qtyEl.textContent = String(totalQty ?? 0);
    if (wordEl) wordEl.textContent = pluralize(totalQty ?? 0, this.goodsWordsArr);
  }

  async renderCartItems(cartItems = []) {
    const grid = this._qs('#checkout-grid');
    if (!grid) return { totalPrice: 0, totalQty: 0 };
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      grid.innerHTML = '<p>Ваша корзина пуста.</p>';
      this.updateTotalsUI(0, 0);
      return { totalPrice: 0, totalQty: 0 };
    }
    const frag = document.createDocumentFragment();
    let totalPrice = 0;
    let totalQty = 0;
    for (const item of cartItems) {
      const qty = Number(item.qty) || 1;
      const price = Number(item.price) || 0;
      totalQty += qty;
      totalPrice += qty * price;
      frag.appendChild(await this._createCartItemCard(item));
    }
    grid.replaceChildren(frag);
    this.updateTotalsUI(totalPrice, totalQty);
    return { totalPrice, totalQty };
  }

  async _createCartItemCard(item) {
    const wrapper = document.createElement('div');
    wrapper.className = 'checkout-item card mb-3';
    const pictureUrl = this._parsePictureUrl(item.picture);
    const safeName = item.name || item.fullname || 'Товар';
    wrapper.innerHTML = `
      <div class="checkout-item__image">
        <img src="${pictureUrl}" alt="${this._escapeAttr(safeName)}" class="checkout-item__img"/>
      </div>
      <div class="checkout-item__content">
        <div class="checkout-item__top">
          <h5 class="checkout-item__title">${this._escapeHtml(item.fullname || safeName)}</h5>
          <span class="checkout-item__qty">Количество: ${item.qty}</span>
        </div>
        <p class="checkout-item__specs">${makeSpecHtmlPreview(item.specs)}</p>
        <div class="checkout-item__price-row">
          <span>Цена:</span>
          <span class="price-submain">${formatPrice(item.price)}</span>
        </div>
        <div class="checkout-item__price-row total">
          <span>Итого:</span>
          <span class="price-main">${formatPrice(item.price * item.qty)}</span>
        </div>
      </div>
    `;
    return wrapper;
  }

  /* Helpers */
  _parsePictureUrl(pictureField) {
    if (!pictureField) return '';
    try {
      const parsed = typeof pictureField === 'string' ? JSON.parse(pictureField) : pictureField;
      return Array.isArray(parsed) && parsed.length ? parsed[0] : '';
    } catch (_) {
      return typeof pictureField === 'string' ? pictureField : '';
    }
  }

  _escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  _escapeAttr(str = '') {
    return this._escapeHtml(str);
  }

  /* Callbacks for RecipientAddressController */
  fillRecipient(recipient) {
    if (!this.storage || !recipient) return;
    try { this.storage.selectRecipient(recipient.id); } catch (e) {}
    try { this.deliveryBlock?.render?.(); } catch (e) {}
  }

  fillAddress(address) {
    if (!this.storage || !address) return;
    try { this.storage.selectAddress(address.id); } catch (e) {}
    try { this.deliveryBlock?.render?.(); } catch (e) {}
  }

  clear() {
    if (!this.container) return;
    this.unbindEvents();
    this.container.innerHTML = '';
    this._refs.clear();
  }
}