// Checkout/CheckoutController.js
import { CheckoutView } from './CheckoutView.js';
import { RecipientAddressStorage } from './RecipientAddressStorage.js';
import { RecipientAddressController } from './RecipientAddressController.js';
import { DeliveryBlockController } from './DeliveryBlockController.js';

export class CheckoutController {
  constructor(cartService) {
    this.cartService = cartService;
    this.foxEngine = this.cartService?.storage?.shopMatic?.foxEngine;

    this.cartItems = [];
    this.totalPrice = 0;
    this.totalQty = 0;
    this.promoCode = '';
    this.goodsWordsArr = ['товар', 'товара', 'товаров'];

    this.isBuyNow = false;
    this.buyNowStorageKey = 'shopmatic_buy_now_item_v1';
    this._hasCartBackup = false;

    this.deliveryOptions = [
      {
        label: 'По клику',
        deliveryType: 'ON_DEMAND',
        description: 'По клику за 15-30 минут',
        time: 'Завтра или позже',
        price: 'бесплатно',
        checked: false,
        disabled: true
      },
      {
        label: 'Пункт выдачи',
        deliveryType: 'PICKUP',
        description: 'Рядом, 7 минут',
        time: 'Завтра или позже',
        price: 'бесплатно',
        checked: true,
        disabled: false
      },
      {
        label: 'Курьер',
        deliveryType: 'COURIER',
        description: 'Доставка на дом',
        time: 'Завтра или позже',
        price: 'бесплатно',
        checked: false,
        disabled: true
      }
    ];

    // view
    // NOTE: we create CheckoutView without container yet; container will be set in init()
    this.view = new CheckoutView({storage: cartService.storage, foxEngine: cartService.shopMatic.foxEngine});
    this.view.setGoodsWords(this.goodsWordsArr);

    // address storage + controller (we keep ownership here)
    this.addressStorage = new RecipientAddressStorage('checkout_data_v1');
    this.addressBook = new RecipientAddressController({
      storage: this.addressStorage,
      foxEngine: this.foxEngine,
      view: this.view
    });

    // expose global for legacy inline templates / modals (keeps previous behaviour)
    window.__RecipientAddressController = this.addressBook;

    // deliveryBlock will be created when DOM container is available (in init)
    this.deliveryBlock = null;

    // bound handlers
    this._bound = {
      onDeliveryPointSelect: this._onDeliveryPointSelect.bind(this),
      onRecipientButton: this._onRecipientButton.bind(this),
      onApplyPromo: this._onApplyPromo.bind(this),
      onCheckout: this._onCheckout.bind(this),
      onContainerClick: this._onContainerClick.bind(this),
      onContainerChange: this._onContainerChange.bind(this),
      onReturnToCart: this._onReturnToCart.bind(this)
    };
  }

  /**
   * Инициализация страницы.
   * @param {string|HTMLElement} selector - корневой контейнер
   * @param {Object} [options] - { buyNowItem }
   */
  async init(selector, options = {}) {
    this.view.setContainer(selector);
    const container = this.view.getContainer();

    if (!container) {
      console.error('[CheckoutController] Container not found:', selector);
      return;
    }

    // ensure delivery block controller exists and points to real DOM root
    const deliveryRoot =
      container.querySelector('.deliveryBlock') || document.querySelector('.deliveryBlock');

    // create or recreate deliveryBlock so it has correct root
    if (this.deliveryBlock) {
      // if exists but root is missing, recreate
      if (!this.deliveryBlock.root || !document.body.contains(this.deliveryBlock.root)) {
        this.deliveryBlock = new DeliveryBlockController({
		  engine: this.foxEngine,
          root: deliveryRoot,
          storage: this.addressStorage,
          addressController: this.addressBook
        });
      }
    } else {
      this.deliveryBlock = new DeliveryBlockController({
		engine: this.foxEngine,
        root: deliveryRoot,
        storage: this.addressStorage,
        addressController: this.addressBook
      });
    }

    const { buyNowItem } = options;

    // 1. Если явно передан buyNowItem — он в приоритете
    if (buyNowItem) {
      this.isBuyNow = true;
      const normalized = this._normalizeItemForCheckout(buyNowItem);
      this.cartItems = [normalized];
      this._saveBuyNowToStorage(normalized);
    } else {
      // 2. Пробуем восстановить buyNow из localStorage
      const cached = this._loadBuyNowFromStorage();

      if (cached) {
        this.isBuyNow = true;
        this.cartItems = [cached];
      } else {
        // 3. Обычная корзина
        this.isBuyNow = false;
        try {
          let items = await this.cartService.getCartItems();
          if (!Array.isArray(items)) items = [];
          // попытка использовать предпочтительный API includedStates, fallback на included
          this.cartItems = items.filter((item) => {
            try {
              const includedChecker =
                this.cartService.includedStates?.ensureItemIncluded ||
                this.cartService.included?.ensureItemIncluded ||
                null;

              if (includedChecker) {
                return includedChecker.call(this.cartService.includedStates || this.cartService.included, item) === true;
              }
              return true;
            } catch (e) {
              console.warn('[CheckoutController] included check failed', e);
              return true;
            }
          });
        } catch (e) {
          console.error('[CheckoutController] Failed to load cart items', e);
          this.cartItems = [];
        }
      }
    }

    // 4. Есть ли корзина, к которой можно вернуться
    this._hasCartBackup = await this._checkCartNotEmpty();

    // Рендер delivery options (static list)
    this.view.buildDeliveryOptions(this.deliveryOptions);

    // Рендер товаров
    const { totalPrice, totalQty } = await this.view.renderCartItems(this.cartItems);
    this.totalPrice = totalPrice;
    this.totalQty = totalQty;

    // UI state
    this.view.toggleReturnToCartButton(this.isBuyNow, this._hasCartBackup);
    this.view.updateModeIndicator(this.isBuyNow);

    // Bind events (view will attach handlers)
    this.view.bindEvents(this._bound);

    // subscribe to storage changes so we re-render delivery block / view if selection changes
    this.addressStorage.subscribe(() => {
      try { this.deliveryBlock?.render?.(); } catch (e) { /* ignore */ }
    });
  }

  /** Short helper to create checkout for single item */
  static createSingleItem(containerSelector, cartService, buyNowItem) {
    const page = new CheckoutController(cartService);
    const normalized = page._normalizeItemForCheckout(buyNowItem);
    page._saveBuyNowToStorage(normalized);
    page.init(containerSelector, { buyNowItem: normalized });
    return page;
  }

  /* ===================== PRIVATE HELPERS ===================== */

  _normalizeItemForCheckout(raw) {
    if (!raw || typeof raw !== 'object') {
      return {
        id: null,
        name: '',
        fullname: '',
        price: 0,
        qty: 1,
        picture: '[]',
        specs: ''
      };
    }

    const price =
      Number(raw.price ?? raw.product_price ?? raw.cost ?? 0) || 0;

    const qty = Number(raw.qty ?? raw.quantity ?? 1) || 1;

    let picture;
    if (typeof raw.picture === 'string') {
      try {
        JSON.parse(raw.picture);
        picture = raw.picture; // already JSON-array string
      } catch {
        picture = JSON.stringify([raw.picture]);
      }
    } else if (Array.isArray(raw.picture) || Array.isArray(raw.pictures)) {
      const arr = raw.picture || raw.pictures;
      picture = JSON.stringify(arr);
    } else {
      picture = '[]';
    }

    return {
      id: raw.id ?? raw.productId ?? null,
      name: raw.name ?? raw.fullname ?? '',
      fullname: raw.fullname ?? raw.name ?? '',
      price,
      qty,
      picture,
      specs: raw.specs ?? raw.description ?? ''
    };
  }

  async _checkCartNotEmpty() {
    try {
      const items = await this.cartService.getCartItems();
      return Array.isArray(items) && items.length > 0;
    } catch {
      return false;
    }
  }

  /* ===== buy-now storage helpers ===== */

  _saveBuyNowToStorage(item) {
    if (!item) return;
    try {
      const payload = { mode: 'buyNow', item };
      localStorage.setItem(this.buyNowStorageKey, JSON.stringify(payload));
    } catch (e) {
      console.warn('[CheckoutController] Failed to save buyNow item to storage', e);
    }
  }

  _loadBuyNowFromStorage() {
    try {
      const raw = localStorage.getItem(this.buyNowStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.mode !== 'buyNow' || !parsed.item) return null;
      return this._normalizeItemForCheckout(parsed.item);
    } catch (e) {
      console.warn('[CheckoutController] Failed to load buyNow item from storage', e);
      return null;
    }
  }

  _clearBuyNowStorage() {
    try {
      localStorage.removeItem(this.buyNowStorageKey);
    } catch (e) {
      console.warn('[CheckoutController] Failed to clear buyNow storage', e);
    }
  }

  /* ======================= EVENTS / HANDLERS ======================= */

  async _onReturnToCart() {
    this._clearBuyNowStorage();
    this.isBuyNow = false;

    try {
      const items = await this.cartService.getCartItems();
      this.cartItems = Array.isArray(items) ? items : [];
    } catch {
      this.cartItems = [];
    }

    // Фильтруем только включенные (try both apis)
    this.cartItems = this.cartItems.filter((item) => {
      try {
        const checker =
          this.cartService.includedStates?.ensureItemIncluded ||
          this.cartService.included?.ensureItemIncluded;
        return checker ? checker.call(this.cartService.includedStates || this.cartService.included, item) === true : true;
      } catch {
        return true;
      }
    });

    this._hasCartBackup = this.cartItems.length > 0;

    const { totalPrice, totalQty } = await this.view.renderCartItems(
      this.cartItems.map((i) => this._normalizeItemForCheckout(i))
    );

    this.totalPrice = totalPrice;
    this.totalQty = totalQty;

    this.view.toggleReturnToCartButton(this.isBuyNow, this._hasCartBackup);
    this.view.updateModeIndicator(this.isBuyNow);
  }

  _onDeliveryPointSelect() {
    // Open address modal via addressBook controller
    try { this.addressBook.openAddressModal(); } catch (e) { console.error(e); }
  }

  _onRecipientButton() {
    try { this.addressBook.openRecipientModal(); } catch (e) { console.error(e); }
  }

  _onApplyPromo() {
    this.promoCode = this.view.getPromoInputValue();
    if (!this.promoCode) return;

    if (this.promoCode === 'DISCOUNT10') {
      this.totalPrice = Math.round(this.totalPrice * 0.9);
      this.view.updateTotalsUI(this.totalPrice, this.totalQty);
      this.view.showPromoHint('Промокод применен! Скидка 10%');
    } else {
      this.view.showPromoHint('Неверный промокод');
    }
  }

  _onContainerClick(e) {
    this.view.handleDeliveryClick(e);
  }

  _onContainerChange(e) {
    this.view.handleDeliveryChange(e);
  }

  _onCheckout() {
    if (this.isBuyNow) {
      alert('Режим "Купить сейчас". Платёжная логика ещё не реализована.');
      this._clearBuyNowStorage();
      this.isBuyNow = false;
      this.view.toggleReturnToCartButton(this.isBuyNow, this._hasCartBackup);
      this.view.updateModeIndicator(this.isBuyNow);
    } else {
      alert('Платежная информация ещё не реализована.');
    }
  }

  destroy() {
    try { this.view.unbindEvents(); } catch (e) {}
    try { this.view.clear(); } catch (e) {}
  }
}

/* backward compatibility */
export { CheckoutController as CheckoutPage };
