/**
 * CatalogView — чистое представление каталога:
 *  • рендер списка товаров
 *  • пустое состояние
 *  • синхронизация избранного
 *  • оптимизированное обновление DOM без пересоздания обработчиков
 */
export class CatalogView {
  constructor({ root, productsCountEl, shop, msg }) {
    this.root = root || null;
    this.productsCountEl = productsCountEl || null;
    this.shop = shop;
    this._msg = typeof msg === 'function' ? msg : (k, f = '') => f || k;
  }

  // --- public ----------------------------------------------------------------

  async render(list = []) {
    const arr = Array.isArray(list) ? list : [];
    if (!this.root) return;

    // Обновляем количество товаров
    if (this.productsCountEl) this.productsCountEl.textContent = String(arr.length);

    if (arr.length === 0) {
      this.renderNoResults();
      return;
    }

    this.clearNoResults();

    // Переупорядочим DOM, если карточки уже присутствуют, иначе полный рендер
    if (this._canReorder(arr)) {
      this._reorder(arr);
      this._syncAndApplyFavorites(arr);
    } else {
      await this._fullRender(arr);
    }
  }

  // --- Полный рендер -----------------------------------------------------------

  async _fullRender(arr) {
    try {
      await this.shop.renderer._renderCartVertical(arr, this.root);
    } catch (e) {
      console.error('[CatalogView] renderer._renderCartVertical failed', e);
      this.root.innerHTML = '';
      return;
    }

    this._syncAndApplyFavorites(arr);
  }

  // --- Синхронизация и применение избранного ----------------------------------

  _syncAndApplyFavorites(arr) {
    // Сначала синхронизируем контролы карточек
    try {
      this.shop._syncAllCardsControls?.();
    } catch (e) {
      console.warn('[CatalogView] _syncAllCardsControls failed', e);
    }

    // Применяем избранное с использованием renderer или fallback
    requestAnimationFrame(() => this._applyFavorites(arr));
  }

  // --- Проверка возможности переупорядочивания карточек ----------------------

  _canReorder(arr) {
    if (!this.root) return false;
    for (const p of arr) {
      if (!p || (p.id === undefined || p.id === null)) return false;
      if (!this.root.querySelector(`[data-product-id="${p.id}"]`)) return false;
    }
    return true;
  }

  // --- Переупорядочивание карточек в DOM ------------------------------------

  _reorder(arr) {
    const frag = document.createDocumentFragment();
    const kept = new Set();

    for (const p of arr) {
      const node = this.root.querySelector(`[data-product-id="${p.id}"]`);
      if (node) {
        frag.appendChild(node);
        kept.add(String(p.id));
      }
    }

    // Удаляем карточки, которые больше не присутствуют в списке
    this.root.querySelectorAll('[data-product-id]').forEach(card => {
      const id = card.getAttribute('data-product-id');
      if (!kept.has(id)) card.remove();
    });

    // Заменяем контент атомарно
    this.root.innerHTML = '';
    this.root.appendChild(frag);
  }

  // --- Применение избранного ----------------------------------------------

  /**
   * Универсальный аплай избранного с использованием renderer или fallback.
   * Обновляет класс кнопки (is-favorite) и aria-pressed атрибут.
   */
  _applyFavorites(arr) {
    if (!this.root || !this.shop?.favorites) return;

    const useRendererMethod = typeof this.shop.renderer?.updateProductCardFavState === 'function';

    arr.forEach(product => {
      const id = product.name;
      if (!id) return;

      const isFav = this.shop.favorites.isFavorite(id);
      // Используем renderer для применения избранного
      if (useRendererMethod) {
        try {
          this.shop.renderer.updateProductCardFavState(this.root, id, isFav);
        } catch (e) {
          console.warn('[CatalogView] renderer.updateProductCardFavState threw', id, e);
        }
      }

      // Fallback: изменяем состояние на карточке
      const card = this.root.querySelector(`[data-product-id="${id}"]`);
      if (!card) return;

      card.dataset.isFav = isFav ? '1' : '0';

      const favSelectors = [
        '[data-fav-btn]',
        '.fav-btn',
        '.product-fav',
        '.favorite-button',
        '[aria-pressed][data-action="fav"]'
      ];
      const favBtn = favSelectors.map(s => card.querySelector(s)).find(btn => btn);
      if (favBtn) {
        favBtn.classList.toggle('is-favorite', isFav);
        favBtn.classList.toggle('active', isFav);
        favBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
        favBtn.dataset.fav = isFav ? '1' : '0';
      } else {
        card.classList.toggle('is-favorite', isFav);
      }
    });
  }

  // --- Пустое состояние ------------------------------------------------------

  renderNoResults(message = null) {
    if (!this.root) return;

    if (this.productsCountEl) this.productsCountEl.textContent = '0';

    const text = message || this._msg('CATALOG_NO_RESULTS', 'По текущим опциям нет товаров');
    const hint = this._msg('CATALOG_NO_RESULTS_HINT', 'Попробуйте изменить фильтры или сбросить поиск.');

    const wrap = document.createElement('div');
    wrap.className = 'catalog-empty';
    wrap.innerHTML = `
      <div class="catalog-empty__icon" style="opacity:.6">
        <svg width="48" height="48" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M3 6h18v2H3zm0 5h12v2H3zm0 5h6v2H3z"/>
        </svg>
      </div>
      <p class="catalog-empty__text">${text}</p>
      <div class="catalog-empty__hint">${hint}</div>
    `;

    this.root.innerHTML = '';
    this.root.appendChild(wrap);

    try { this.shop._syncAllCardsControls?.(); } catch {}
  }

  clearNoResults() {
    this.root?.querySelector('.catalog-empty')?.remove();
  }
}
