import { EventBus } from "./modules/EventBus.js";
import { Card } from './modules/Card/Card.js';
import { ProductService } from './modules/ProductService/ProductService.js';
import { StorageService } from './modules/StorageService/StorageService.js';
import { Notifications } from './modules/Notifications.js';
import { Renderer } from './modules/Renderer/Renderer.js';
import { CartModule } from './modules/Cart/Cart.js';
import { FavoritesModule } from './modules/Wishlist/FavoritesModule.js';
import { ProductPage } from './modules/ProductPage/ProductPage.js';
import { ViewedItemsModule } from './modules/ViewedItemsModule.js';
import { Catalog } from './modules/Catalog/CatalogController.js';
import { CheckoutPage } from './modules/Checkout/CheckoutController.js';

// External services / integrations
import { ServiceRegistry } from './modules/Api/ServiceRegistry.js';
import { ApiClient } from './modules/Api/ApiClient.js';
import { FoxService } from './modules/Api/FoxService.js';
import { KnowledgeBaseApi } from './modules/Integrations/KnowledgeBaseApi.js';

// App kernel: store + router (production-grade SPA policy layer)
import { combineReducers, createStore } from './modules/App/Store.js';
import { routeReducer } from './modules/App/slices/routeSlice.js';
import { RouterPolicy } from './modules/App/RouterPolicy.js';
import { Events } from './modules/Events.js';
import { makeEventEnvelope } from './modules/EventContracts.js';

/**
 * ShopMatic orchestrates all modules of the shop and exposes a high level API
 * for cart management, favourites and product navigation. The actual product
 * listing, filtering and rendering logic is delegated to the Catalog class
 * which encapsulates all DOM events related to searching and sorting.
 */
export class ShopMatic {
  /**
   * Create a new ShopMatic instance.
   * @param {Object} foxEngine Host engine providing template loading and routing.
   * @param {Object} opts Optional configuration overrides.
   */
  constructor(foxEngine, opts = {}) {
    if (!foxEngine) throw new Error('foxEngine is required');
    this.foxEngine = foxEngine;

    // ---------------------------------------------------------------------
    // External services & API
    // ---------------------------------------------------------------------
    // Service registry allows decoupled integrations (REST, sysRequest, etc.)
    this.services = new ServiceRegistry();
    // Default backend transport (sysRequest via foxEngine)
    this.services.register('fox', new FoxService(this.foxEngine));

    // Unified API client. Modules can use it for integrations.
    this.api = new ApiClient(this.services, {
      defaultService: 'fox',
      defaultTimeoutMs: 7000,
      maxRetries: 1,
      retryBaseDelayMs: 220,
      cacheTtlMs: 10_000,
      debug: !!opts.debug
    });

    // Integrations namespace: other modules can reuse ShopMatic transports.
    this.integrations = {
      knowledgeBase: new KnowledgeBaseApi(this.api)
    };

    // Merge default options with any overrides
    this.opts = Object.assign({
      itemsId: 'items',
      categoryFilterId: 'categoryFilter',
      brandFilterId: 'brandFilter',
      searchId: 'search',
      sortId: 'sort',
      searchBtnId: 'searchBtn',
      cartGridId: 'cart-grid',
      checkoutGridId: 'checkout-grid',
      cartCountInlineId: 'cart-count-inline',
      cartTotalId: 'cart-total',
      miniCartTotalId: 'miniCartTotal',
      miniCartListId: 'miniCart',
      headerCartNumId: 'cartNum',
      mobileCartNumId: 'mobileCartNum',
      miniCartHeaderTitleId: 'miniCartHeaderTitle',
      productsCountId: 'productsCount',
      storageKey: 'gribkov_cart_v1',
      favStorageKey: 'gribkov_favs_v1',
      notificationDuration: 3000,
      debug: false
    }, opts);

    // Core modules
    this.eventBus = new EventBus();
    this.deviceUtil = foxEngine.deviceUtil;

    // ---------------------------------------------------------------------
    // App kernel (store + router policy)
    // ---------------------------------------------------------------------
    this.store = createStore(
      combineReducers({
        route: routeReducer
      })
    );

    this.router = new RouterPolicy(this.store, { debug: !!opts.debug });
    try { this.router.init(); } catch (e) { console.warn('[ShopMatic] router.init failed', e); }

    this.productService = new ProductService(this.foxEngine);
    this.card = new Card(this);

    this.storage = new StorageService(this, {
      storageKey: this.opts.storageKey,
      favStorageKey: this.opts.favStorageKey
    });

    this.notifications = new Notifications();

    // Favourites with central sync
    this.favorites = new FavoritesModule({ storage: this.storage, opts: { sync: false } });

    this.renderer = new Renderer({
      shopMatic: this,
      productService: this.productService,
      favorites: this.favorites
    });

    this.cart = new CartModule({
      storage: this.storage,
      productService: this.productService,
      renderer: this.renderer,
      notifications: this.notifications,
      favorites: this.favorites,
      opts: this.opts
    });

    this.productPage = new ProductPage(this);

    this.viewedModule = new ViewedItemsModule({
      storageService: this.storage,
      renderer: null,
      container: '#viewed-items'
    });

    // Create catalog for product list and filters
    this.catalog = new Catalog({
      shop: this,
      rootId: this.opts.itemsId,
      catFilterId: this.opts.categoryFilterId,
      brandFilterId: this.opts.brandFilterId,
      searchId: this.opts.searchId,
      sortId: this.opts.sortId,
      searchBtnId: this.opts.searchBtnId,
      productsCountId: this.opts.productsCountId
    });

    this.checkoutPage = new CheckoutPage(this.cart);

    // Subscription handle for favourites updates
    this._favsUnsub = null;

    // Bound handlers for global events
    this._bound = {
      onStorage: this._onStorageEvent.bind(this)
    };

    // Delegation handlers registry (legacy; kept for compatibility)
    this._delegationHandlers = new WeakMap();

    // DOM refs (for backwards compatibility; assigned after catalog.init())
    this.root = null;
    this.catFilter = null;
    this.brandFilter = null;
    this.search = null;
    this.sort = null;
    this.searchBtn = null;
    this.productsCount = null;
  }

  /**
   * Initialise all modules, load persisted state, bind events and perform
   * initial rendering. This should be called once after constructing the
   * ShopMatic instance.
   */
  async init() {
    // Collect cart related DOM elements
    const cartGridEl = document.getElementById(this.opts.cartGridId);
    const cartCountInlineEl = document.getElementById(this.opts.cartCountInlineId);
    const cartTotalEl = document.getElementById(this.opts.cartTotalId);
    const miniCartTotalEl = document.getElementById(this.opts.miniCartTotalId);
    const miniCartListEl = document.getElementById(this.opts.miniCartListId);
    const headerCartNumEl = document.getElementById(this.opts.headerCartNumId);
    const mobileCartNumEl = document.getElementById(this.opts.mobileCartNumId);
    const miniCartHeaderTitleEl = document.getElementById(this.opts.miniCartHeaderTitleId);

    // Pass references to cart module
    try {
      this.cart.setDomRefs({
        headerCartNum: headerCartNumEl,
        mobileCartNum: mobileCartNumEl,
        miniCartList: miniCartListEl,
        miniCartHeaderTitle: miniCartHeaderTitleEl,
        cartGrid: cartGridEl,
        cartCountInline: cartCountInlineEl,
        cartTotal: cartTotalEl,
        miniCartTotal: miniCartTotalEl,
        cartHeader: document.querySelector('.cart-header')
      });
    } catch (err) {
      console.warn('cart.setDomRefs failed', err);
    }

    // Initialise catalog (loads products, categories & brands, binds filter events, renders)
    await this.catalog.init();

    // Copy references from catalog for backward compatibility
    this.root = this.catalog.root;
    this.catFilter = this.catalog.catFilter;
    this.brandFilter = this.catalog.brandFilter;
    this.search = this.catalog.search;
    this.sort = this.catalog.sort;
    this.searchBtn = this.catalog.searchBtn;
    this.productsCount = this.catalog.productsCount;

    // Sync UI to loaded favourites
    this._updateWishUI();

    // Subscribe to favourites changes (UI only).
    // Card DOM updates are now automatic via eventBus + Card.syncById.
    try {
      this._favsUnsub = this.favorites.subscribe(() => {
        this._updateWishUI();
      });
    } catch (err) {
      console.warn('favorites.subscribe failed', err);
    }

    // Bind global events
    window.addEventListener('storage', this._bound.onStorage);

    // IMPORTANT:
    // No global card delegation bind here anymore.
    // Bindings happen ONLY in renderers that create card DOM via Card.mount(...)

    await this.viewedModule.load();

    // Update cart UI after loading persisted state
    await this.cart.updateCartUI();

    // Initial hints (optional, harmless)
    try {
      const favIds = this.favorites.exportToArray?.() || [];
      if (favIds.length) {
        this.eventBus.emit(
          Events.DOMAIN_FAVORITES_CHANGED,
          makeEventEnvelope(Events.DOMAIN_FAVORITES_CHANGED, { ids: favIds, action: 'init' }, { source: 'ShopMatic' })
        );
      }
      this.eventBus.emit(
        Events.DOMAIN_CART_CHANGED,
        makeEventEnvelope(Events.DOMAIN_CART_CHANGED, { action: 'init' }, { source: 'ShopMatic' })
      );
    } catch {}
  }

  /**
   * Destroy all event listeners and subordinate modules. Should be called
   * when the ShopMatic instance is no longer used.
   */
  destroy() {
    window.removeEventListener('storage', this._bound.onStorage);

    // Destroy catalog and unbind filter events
    if (this.catalog && typeof this.catalog.destroy === 'function') {
      try { this.catalog.destroy(); } catch (_) {}
    }

    // Unsubscribe favourites
    if (typeof this._favsUnsub === 'function') {
      try { this._favsUnsub(); } catch (e) { /* ignore */ }
      this._favsUnsub = null;
    }

    // Destroy modules
    if (this.favorites && typeof this.favorites.destroy === 'function') {
      try { this.favorites.destroy(); } catch (e) { /* ignore */ }
    }
    if (this.cart && typeof this.cart.destroy === 'function') {
      try { this.cart.destroy(); } catch (e) { /* ignore */ }
    }

    try { this.card?.destroy?.(); } catch {}
    try { this.eventBus?.clear?.(); } catch {}
  }

  /**
   * Update the wish counter in the UI to reflect the number of favourite
   * items. If there are none the element is hidden.
   */
  _updateWishUI() {
    try {
      const wishEl = document.getElementById('wishNum');
      const mobileWishEl = document.getElementById('mobileFavorites');
      if (!wishEl) return;

      const count =
        (this.favorites && typeof this.favorites.getCount === 'function')
          ? this.favorites.getCount()
          : 0;

      wishEl.style.display = count > 0 ? 'inline-flex' : 'none';
      wishEl.textContent = String(count);

      if (mobileWishEl) {
        mobileWishEl.style.display = count > 0 ? 'inline-flex' : 'none';
        mobileWishEl.textContent = String(count);
      }
    } catch (e) {
      console.warn('_updateWishUI failed', e);
    }
  }

  /**
   * Handle updates from storage. Re-sync cart/favourites and refresh UI.
   * @param {StorageEvent} e Storage event
   */
  _onStorageEvent(e) {
    if (!e) return;

    // Reload both cart and favourites if storage cleared
    if (e.key === null) {
      try { this.cart.loadFromStorage(); } catch (_) {}
      try { this.favorites.loadFromStorage(); } catch (_) {}

      this._updateWishUI();

      // Hint reactive layer (canonical)
      try {
        this.eventBus.emit(
          Events.DOMAIN_CART_CHANGED,
          makeEventEnvelope(Events.DOMAIN_CART_CHANGED, { action: 'storage:clear' }, { source: 'ShopMatic' })
        );
        this.eventBus.emit(
          Events.DOMAIN_FAVORITES_CHANGED,
          makeEventEnvelope(Events.DOMAIN_FAVORITES_CHANGED, { action: 'storage:clear' }, { source: 'ShopMatic' })
        );
      } catch {}
      return;
    }

    // Cart storage changed
    if (e.key === this.opts.storageKey) {
      try { this.cart.loadFromStorage(); } catch (_) {}
      try { this.cart.updateCartUI(); } catch (_) {}

      try {
        this.eventBus.emit(
          Events.DOMAIN_CART_CHANGED,
          makeEventEnvelope(Events.DOMAIN_CART_CHANGED, { action: 'storage:cart' }, { source: 'ShopMatic' })
        );
      } catch {}
    }

    // Favourites storage changed
    if (e.key === this.opts.favStorageKey) {
      try { this.favorites.loadFromStorage(); } catch (_) {}

      this._updateWishUI();

      try {
        const favIds = this.favorites.exportToArray?.() || [];
        this.eventBus.emit(
          Events.DOMAIN_FAVORITES_CHANGED,
          makeEventEnvelope(
            Events.DOMAIN_FAVORITES_CHANGED,
            favIds.length ? { ids: favIds, action: 'storage:favs' } : { action: 'storage:favs' },
            { source: 'ShopMatic' }
          )
        );
      } catch {}
    }
  }

  /**
   * Navigate to a product page. Sets the location hash and delegates to
   * ProductPage for rendering.
   * @param {string} product ID of the product to show.
   * @param {HTMLElement|string} block Container in which to render.
   */
  openProductPage(product, block) {
    this.foxEngine.loadTemplates();
    if (this.router && typeof this.router.toProduct === 'function') this.router.toProduct(product);
    else location.hash = '#product/' + product;
    this.productPage.render(product, block);
  }

  /* ================== Public API (delegates) ================== */

  addToCart(id, qty = 1) {
    const desired = Math.max(1, parseInt(qty || 1, 10));
    const available = this.card._computeAvailableStock(id);

    if (available <= 0) {
      this.notifications.show('Невозможно добавить: нет доступного остатка.', {
        duration: this.opts.notificationDuration
      });
      return false;
    }

    const toAdd = Math.min(desired, available);
    if (toAdd < desired) {
      this.notifications.show(`Добавлено ${toAdd} шт. (доступно ${available}).`, {
        duration: this.opts.notificationDuration
      });
    }

    // CartModule will emit cart:changed via eventBus on its own.
    return this.cart.add(id, toAdd);
  }

  changeQty(id, qty) { return this.cart.changeQty(id, qty); }

  isFavorite(id) { return this.favorites.isFavorite ? this.favorites.isFavorite(id) : false; }

  toggleFavorite(id) { return this.favorites.toggle ? this.favorites.toggle(id) : false; }

  getFavorites() {
    const ids = (this.favorites.getAll ? this.favorites.getAll() : (this.favorites.exportToArray ? this.favorites.exportToArray() : []));
    return Array.isArray(ids) ? ids.map(id => this.productService.findById(id)).filter(Boolean) : [];
  }

  removeCartItem(id) {
    this.cart.remove(id);
    this.catalog.view.updateCardByName(id);
  }



/**
 * Load catalog.
 * Backward-compatible overload:
 * - loadCatalog(argsObject) forwards directly to Catalog.loadCatalog(...)
 * - loadCatalog(brand, category) builds the legacy request object
 */
async loadCatalog(arg1 = "", arg2 = "") {
  // New signature: loadCatalog(argsObject)
  if (arg1 && typeof arg1 === "object") {
    return this.catalog.loadCatalog(arg1);
  }

  // Legacy signature: loadCatalog(brand, category)
  const brand = (arg1 ?? "").toString();
  const category = (arg2 ?? "").toString();
  return this.catalog.loadCatalog({ request: { brand, category } });
}


  removeWishlistItem(id) {
    if (this.wishlistModule && typeof this.wishlistModule.removeFromFav === 'function') {
      this.wishlistModule.removeFromFav(id);
    }
  }

  /**
   * Render the cart page. Optionally resets cart DOM references.
   */
  renderCartPage() {
    const cartGridEl = document.getElementById(this.opts.cartGridId);
    const cartCountInlineEl = document.getElementById(this.opts.cartCountInlineId);
    const cartTotalEl = document.getElementById(this.opts.cartTotalId);

    this.cart.setDomRefs({
      cartGrid: cartGridEl,
      cartCountInline: cartCountInlineEl,
      cartTotal: cartTotalEl
    });

    this.cart.loadFromStorage();
    this.cart.updateCartUI();

    // Legacy fallback (kept)
    this._syncAllCardsControls();
  }

  /**
   * Wrapper around Catalog.loadCatalog for compatibility with legacy code.
   * Delegates to the Catalog instance.
   */

  /**
   * Wrapper around Catalog.applyFilters for compatibility with legacy code.
   */
  async applyFilters() {
    return this.catalog.applyFilters();
  }

  // Legacy handlers preserved as wrappers around applyFilters. They are not bound
  // in the new architecture but retained for external callers if needed.
  _onSearchInput() { this.applyFilters(); }
  _onCatChange() { this.applyFilters(); }
  _onBrandChange() { this.applyFilters(); }
  _onSortChange() { this.applyFilters(); }
  _onSearchBtn() { this.applyFilters(); }
}
