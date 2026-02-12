/**
 * CatalogController — catalog display + filters orchestration.
 * @author Calista Verner
 * @date [13.11.25]
 */
import { deepEqual } from "../utils.js";
import { FilterController } from './FilterController.js';
import { CatalogView } from './CatalogView.js';

export class CatalogController {
  static UI_MESSAGES = Object.freeze({
    PRODUCT_LIMIT_DEFAULT: 'У вас уже максимум в корзине',
    PRODUCT_LIMIT_REACHED: 'Вы достигли максимального количества этого товара',
    NO_STOCK_TEXT: 'Товара нет в наличии',
    CANNOT_ADD_NO_STOCK: 'Невозможно добавить: нет доступного остатка.',
    ADDED_PARTIAL: 'В корзину добавлено {added} шт. (доступно {available}).',
    FAVORITES_UNAVAILABLE: 'Модуль избранного недоступен.',
    PRODUCT_LEFT: 'Остаток: {left}',

    CATALOG_LOAD_ERROR: 'Не удалось загрузить товары',
    CATALOG_ALL_OPTION: 'Все',
    CATALOG_NO_RESULTS: 'По текущим опциям нет товаров',
    CATALOG_NO_RESULTS_HINT: 'Попробуйте изменить фильтры или сбросить поиск.'
  });

  constructor({
    shop,
    rootId, catFilterId, brandFilterId, searchId, sortId, searchBtnId, productsCountId,
    debounceMs = 300
  } = {}) {
    if (!shop) throw new Error('CatalogController requires a shop instance');

    this.shop = shop;
    this.eventBus = shop.eventBus;
    this.opts = { rootId, catFilterId, brandFilterId, searchId, sortId, searchBtnId, productsCountId, debounceMs };

    this.root = null;
    this.catFilter = null;
    this.brandFilter = null;
    this.search = null;
    this.sort = null;
    this.searchBtn = null;
    this.resetBtn = null;
    this.productsCount = null;

    this.filters = null;
    this.view = null;

    this._productCache = new ProductCache(() => this._getProductService());
    this._lastAppliedState = null;
    this._isInitializing = false;
    this._selectorsInitialized = false;

    this._filterService = new CatalogFilterService();

    // Prevent race conditions: only latest applyFilters() may update the view.
    this._applySeq = 0;
    this._activeApplySeq = 0;
  }

  _msg(key, fallback = '') {
    try {
      if (this.shop && typeof this.shop._msg === 'function') {
        const val = this.shop._msg(key);
        if (val != null && val !== key) return val;
      }
      const i18n = this.shop?.i18n;
      if (i18n && typeof i18n.t === 'function') {
        const val = i18n.t(key);
        if (val != null && val !== key) return val;
      }
    } catch {}
    return CatalogController.UI_MESSAGES[key] ?? fallback;
  }

  _getProductService() {
    return this.shop.productService;
  }

  _setLocationHash(hash) {
    const h = String(hash || '').trim();
    if (!h) return;
    try {
      if (this.shop?.router?.go) return this.shop.router.go(h);
    } catch {}
    try { location.hash = h; } catch {}
  }

  _showNotification(message) {
    try {
      this.shop.notifications.show(message, {
        duration: this.shop.opts?.notificationDuration ?? 3000
      });
    } catch {
      console.info('[CatalogController] notify:', message);
    }
  }

  async init() {
    this._cacheDomElements();
    this._createHelpers();

    const ps = this._getProductService();
    if (!ps) {
      console.warn('[CatalogController] productService absent — module disabled');
      return;
    }

    this._isInitializing = true;

    await this.initSelectors('', '', { applyOnComplete: true });

    try {
      if (typeof ps.loadProductsSimple === 'function') {
        await ps.loadProductsSimple();
        this._productCache.clear();
      }
    } catch (err) {
      console.error('CatalogController.init: loadProductsSimple failed', err);
      this._showNotification(this._msg('CATALOG_LOAD_ERROR', 'Не удалось загрузить товары'));
    } finally {
      this._isInitializing = false;
    }

    this._bindFilterEvents();
  }

  async initSelectors(brand = '', category = '', options = {}) {
    const ps = this._getProductService();
    if (!ps) return;

    const { applyOnComplete = true } = options;

    await Promise.all([
      this.catFilter
        ? SelectPopulator.populate(this.catFilter, ps, {
            fillMethod: 'fillCategories',
            fetchMethod: 'fetchCategories',
            getterSuffix: 'Categories',
            selectedValue: category,
            msgFn: this._msg.bind(this)
          })
        : Promise.resolve(),

      this.brandFilter
        ? SelectPopulator.populate(this.brandFilter, ps, {
            fillMethod: 'fillBrands',
            fetchMethod: 'fetchBrands',
            getterSuffix: 'Brands',
            selectedValue: brand,
            msgFn: this._msg.bind(this)
          })
        : Promise.resolve()
    ]);

    this._selectorsInitialized = true;

    if (applyOnComplete) await this.applyFilters();
  }

  async loadCatalog({ request = null } = {}) {
    const ps = this._getProductService();
    if (!ps) return;

    const selectedCategory = request?.category ?? '';
    const selectedBrand = request?.brand ?? '';
    const searchValue = request?.search ?? '';
    const sortValue = request?.sort ?? '';

    this._setLocationHash('#page/catalog');

    if (!this._selectorsInitialized) {
      await this.initSelectors(selectedBrand, selectedCategory, { applyOnComplete: true });
    }

    this._applyRequestToControls({ category: selectedCategory, brand: selectedBrand, search: searchValue, sort: sortValue });

    if (this.filters) {
      this.filters.setState(
        { category: selectedCategory, brand: selectedBrand, search: searchValue, sort: sortValue },
        { silent: true }
      );
    }

    await this.applyFilters();
  }

  destroy() {
    try { this.filters?.unbind(); } catch {}

    this.root = null;
    this.catFilter = null;
    this.brandFilter = null;
    this.search = null;
    this.sort = null;
    this.searchBtn = null;
    this.resetBtn = null;
    this.productsCount = null;

    this.filters = null;
    this.view = null;

    this._productCache.clear();
    this._lastAppliedState = null;
  }

  _cacheDomElements() {
    const { rootId, catFilterId, brandFilterId, searchId, sortId, searchBtnId, productsCountId } = this.opts;

    this.root = document.getElementById(rootId) || null;
    this.catFilter = document.getElementById(catFilterId) || null;
    this.brandFilter = document.getElementById(brandFilterId) || null;
    this.search = document.getElementById(searchId) || null;
    this.sort = document.getElementById(sortId) || null;
    this.searchBtn = document.getElementById(searchBtnId) || null;
    this.productsCount = document.getElementById(productsCountId) || null;
    this.resetBtn = document.getElementById('resetFilters') || null;
  }

  _createHelpers() {
    this.filters = new FilterController({
      searchEl: this.search,
      catFilterEl: this.catFilter,
      brandFilterEl: this.brandFilter,
      sortEl: this.sort,
      searchBtnEl: this.searchBtn,
      resetBtnEl: this.resetBtn,
      productsCountEl: this.productsCount,
      debounceMs: this.opts.debounceMs
    });

    this.view = new CatalogView({
      root: this.root,
      productsCountEl: this.productsCount,
      shop: this.shop,
      msg: this._msg.bind(this)
    });
  }

  _bindFilterEvents() {
    if (!this.filters) return;
    this.filters.bind(() => {
      const state = this.filters.getState();
      this.eventBus?.emit?.('filtersChanged', state);
      this.applyFilters();
    });
  }

  _applyRequestToControls({ category, brand, search, sort }) {
    if (this.search && typeof search === 'string') this.search.value = search;
    if (this.catFilter && typeof category === 'string') this.catFilter.value = category;
    if (this.brandFilter && typeof brand === 'string') this.brandFilter.value = brand;
    if (this.sort && typeof sort === 'string') this.sort.value = sort;
  }

  async _populateCacheIfNeeded() {
    const ps = this._getProductService();
    if (!ps) return;

    if (!this._productCache.hasData()) {
      try {
        if (typeof ps.loadProducts === 'function') await ps.loadProducts();
        else if (typeof ps.loadProductsSimple === 'function') await ps.loadProductsSimple();
      } catch (err) {
        console.warn('CatalogController: productService load failed', err);
        this._showNotification(this._msg('CATALOG_LOAD_ERROR'));
      } finally {
        const list = (typeof ps.getProducts === 'function') ? ps.getProducts() : [];
        this._productCache.set(list || []);
      }
    }
  }

  _getCurrentFilterState() {
    if (this.filters && typeof this.filters.getState === 'function') return this.filters.getState();
    return {
      search: (this.search?.value || '').trim(),
      category: this.catFilter?.value || '',
      brand: this.brandFilter?.value || '',
      sort: this.sort?.value || ''
    };
  }

  async applyFilters() {
    if (!this.view) return;

    const seq = ++this._applySeq;
    this._activeApplySeq = seq;

    this.view.showLoading?.();

    try {
      await this._populateCacheIfNeeded();

      const baseList = this._productCache.getAll() || [];
      const list = Array.isArray(baseList) ? baseList : [];

      const state = this._getCurrentFilterState();

      // If a newer applyFilters() started — abandon this one.
      if (seq !== this._activeApplySeq) return;

      if (this._lastAppliedState && deepEqual(this._lastAppliedState, state)) {
        if (seq === this._activeApplySeq) this.view.hideLoading?.();
        return;
      }

      const finalList = this._filterService.apply(list, state);

      if (seq !== this._activeApplySeq) return;

      if (!finalList.length) {
        const message = this._msg('CATALOG_NO_RESULTS', 'По текущим опциям нет товаров');
        const hint = this._msg('CATALOG_NO_RESULTS_HINT', 'Попробуйте изменить фильтры или сбросить поиск.');
        if (typeof this.view.renderEmpty === 'function') await this.view.renderEmpty({ message, hint, state });
        else await this.view.render([]);
      } else {
        await this.view.render(finalList);
      }

      this._lastAppliedState = state;
    } catch (err) {
      console.error('CatalogController.applyFilters failed', err);
      this._showNotification(this._msg('CATALOG_LOAD_ERROR', 'Ошибка при обработке каталога'));
    } finally {
      if (seq === this._activeApplySeq) this.view.hideLoading?.();
    }
  }
}

class ProductCache {
  constructor() { this._data = null; }
  hasData() { return Array.isArray(this._data) && this._data.length > 0; }
  set(list) { this._data = Array.isArray(list) ? Array.from(list) : []; }
  getAll() { return this._data || []; }
  clear() { this._data = null; }
}

class SelectPopulator {
  static async populate(selectEl, ps, {
    fillMethod, fetchMethod, getterSuffix, selectedValue = '', msgFn = () => ''
  } = {}) {
    if (!selectEl || !ps) return;

    try {
      if (typeof ps[fillMethod] === 'function') {
        await ps[fillMethod](selectEl, { selected: selectedValue });
        if (selectedValue && selectEl.value !== selectedValue) selectEl.value = selectedValue;
        return;
      }

      if (typeof ps[fetchMethod] === 'function') await ps[fetchMethod]();

      const getterName = `get${getterSuffix}`;
      const items = (typeof ps[getterName] === 'function') ? (ps[getterName]() || []) : [];

      const frag = document.createDocumentFragment();

      const allLabel = (typeof msgFn === 'function') ? msgFn('CATALOG_ALL_OPTION') : 'Все';
      const allOption = document.createElement('option');
      allOption.value = '';
      allOption.textContent = allLabel;
      frag.appendChild(allOption);

      for (const item of items) {
        if (!item) continue;
        const option = document.createElement('option');
        option.value = (item.id ?? item.name ?? '');
        option.textContent = (item.fullname ?? item.name ?? item.id ?? '');
        if (selectedValue && String(option.value) === String(selectedValue)) option.selected = true;
        frag.appendChild(option);
      }

      selectEl.innerHTML = '';
      selectEl.appendChild(frag);

      if (selectedValue) selectEl.value = selectedValue;
    } catch (err) {
      console.warn('SelectPopulator.populate failed', err);
    }
  }
}

class CatalogFilterService {
  apply(list, { search = '', category = '', brand = '', sort = '' } = {}) {
    if (!Array.isArray(list)) return [];

    const searchTerm = String(search || '').trim().toLowerCase();
    const categoryVal = String(category || '');
    const brandVal = String(brand || '').toLowerCase();
    const sortOrder = String(sort || '');

    let filtered = list.filter(p => this._passesAllFilters(p, { searchTerm, categoryVal, brandVal }));
    if (!sortOrder || filtered.length <= 1) return filtered;

    return this._sort(filtered, sortOrder);
  }

  _passesAllFilters(p, { searchTerm, categoryVal, brandVal }) {
    if (!p) return false;

    if (searchTerm) {
      const target = String(p.fullname ?? p.title ?? p.name ?? '').toLowerCase();
      if (!target.includes(searchTerm)) return false;
    }

    if (categoryVal) {
      if (String(p.category ?? '') !== categoryVal) return false;
    }

    if (brandVal) {
      const pb = String(p.brand ?? p.brandName ?? '').toLowerCase();
      if (pb !== brandVal) return false;
    }

    return true;
  }

  _sort(list, sortOrder) {
    const arr = Array.from(list);

    switch (sortOrder) {
      case 'price_asc':
        arr.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
        break;
      case 'price_desc':
        arr.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
        break;
      case 'brand_asc':
        arr.sort((a, b) =>
          String(a.brandName ?? a.brand ?? '')
            .localeCompare(String(b.brandName ?? b.brand ?? ''), undefined, { sensitivity: 'base' })
        );
        break;
      case 'brand_desc':
        arr.sort((a, b) =>
          String(b.brandName ?? b.brand ?? '')
            .localeCompare(String(a.brandName ?? a.brand ?? ''), undefined, { sensitivity: 'base' })
        );
        break;
      default:
        break;
    }

    return arr;
  }
}

export { CatalogController as Catalog };
