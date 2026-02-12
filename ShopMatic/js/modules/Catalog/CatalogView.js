/**
 * CatalogView — catalog view.
 * Contract: shop.card.renderSingleCard(item, type) MUST return a Node (Element).
 * @author Calista Verner
 */
export class CatalogView {
  constructor({ root, productsCountEl, shop, msg }) {
    this.root = root || null;
    this.productsCountEl = productsCountEl || null;
    this.shop = shop;
    this.card = shop?.card || null;

    this._msg =
      typeof msg === 'function'
        ? msg
        : (k, fallback = '') => fallback || k;

    this._cardById = new Map();
  }



showLoading(count = 8) {
  if (!this.root) return;
  // Lightweight skeletons (no layout jump)
  const n = Math.max(1, Math.min(24, Number(count) || 8));
  this.root.classList.add('sm-loading');
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'sm-skel sm-skel-card';
    el.innerHTML = `
      <div class="sm-skel__media"></div>
      <div class="sm-skel__body">
        <div class="sm-skel__line sm-skel__line--lg"></div>
        <div class="sm-skel__line"></div>
        <div class="sm-skel__line sm-skel__line--sm"></div>
        <div class="sm-skel__row">
          <div class="sm-skel__pill"></div>
          <div class="sm-skel__btn"></div>
        </div>
      </div>`;
    frag.appendChild(el);
  }
  this.root.innerHTML = '';
  this.root.appendChild(frag);
  if (this.productsCountEl) this.productsCountEl.textContent = '…';
}

hideLoading() {
  if (!this.root) return;
  this.root.classList.remove('sm-loading');
}

async renderEmpty({ message = null, hint = null } = {}) {
  // keep compatibility with controller: renderEmpty({message,hint})
  const msg = message || this._msg('CATALOG_NO_RESULTS', 'По текущим опциям нет товаров');
  this.renderNoResults(msg, hint);
}

  async render(list = []) {
    const arr = Array.isArray(list) ? list : [];
    if (!this.root) return;

    if (this.productsCountEl) this.productsCountEl.textContent = String(arr.length);

    if (arr.length === 0) {
      this.renderNoResults();
      return;
    }

    this.clearNoResults();

    if (this._canReorder(arr)) this._reorder(arr);
    else await this._fullRender(arr);
  }

  async _fullRender(arr) {
    try {
      await this.shop.card.renderCardList(arr, this.root, 'VERTICAL');
      this._rebuildCardIndex();
    } catch (e) {
      console.error('[CatalogView] render failed', e);
      if (this.root) this.root.innerHTML = '';
      this._cardById.clear();
    }
  }

  async updateCardByName(name, newProduct = null) {
    if (!this.root) return;
    const id = String(name ?? '').trim();
    if (!id) return;

    if (!this._cardById.size) this._rebuildCardIndex();
    const oldCard = this._cardById.get(id);
    if (!oldCard) return;

    let product = newProduct;
    if (!product) {
      const ctx = this.shop?.ctx || this.shop;
      product =
        ctx?.getProductSync?.(id) ||
        this.shop?.productService?.findById?.(id) ||
        null;
    }
    if (!product) return;

    try {
      const produced = await this.shop.card.renderSingleCard(product, 'VERTICAL');

      let newCard = null;
      if (produced instanceof Element) newCard = produced;
      else if (produced && typeof produced === 'object' && produced.nodeType === 1) newCard = produced;
      else if (typeof produced === 'string') {
        const tmp = document.createElement('div');
        tmp.innerHTML = produced;
        newCard = tmp.querySelector('[data-product-id]') || tmp.firstElementChild;
      }

      if (!newCard) {
        console.warn('[CatalogView] updateCardByName: renderer did not produce a card node');
        return;
      }

      oldCard.replaceWith(newCard);

      const newId = newCard.getAttribute?.('data-product-id') || id;
      this._cardById.set(String(newId), newCard);

      this._rebuildCardIndex();
    } catch (e) {
      console.error('[CatalogView] updateCardByName failed', e);
    }
  }

  _canReorder(arr) {
    if (!this.root || !arr.length) return false;
    if (!this._cardById.size) this._rebuildCardIndex();
    return arr.every((p) => p?.name != null && this._cardById.has(String(p.name)));
  }

  _reorder(arr) {
    if (!this.root) return;

    const frag = document.createDocumentFragment();
    for (const p of arr) {
      const node = this._cardById.get(String(p.name));
      if (node) frag.appendChild(node);
    }

    this.root.innerHTML = '';
    this.root.appendChild(frag);

    this._rebuildCardIndex();
  }

  renderNoResults(message = null, hint = null) {
    if (!this.root) return;

    this._cardById.clear();
    if (this.productsCountEl) this.productsCountEl.textContent = '0';

    const wrap = document.createElement('div');
    wrap.className = 'catalog-empty';

    const icon = document.createElement('div');
    icon.className = 'catalog-empty__icon';
    icon.style.opacity = '.6';
    icon.innerHTML = `
      <svg width="48" height="48" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M3 6h18v2H3zm0 5h12v2H3zm0 5h6v2H3z"/>
      </svg>`;

    const textEl = document.createElement('p');
    textEl.className = 'catalog-empty__text';
    textEl.textContent = message || this._msg('CATALOG_NO_RESULTS', 'По текущим опциям нет товаров');

    const hintEl = document.createElement('div');
    hintEl.className = 'catalog-empty__hint';
    hintEl.textContent = hint || this._msg('CATALOG_NO_RESULTS_HINT', 'Попробуйте изменить фильтры или сбросить поиск.');

    wrap.append(icon, textEl, hintEl);

    this.root.innerHTML = '';
    this.root.appendChild(wrap);

    try { this.shop?._syncAllCardsControls?.(); } catch {}
  }

  clearNoResults() {
    this.root?.querySelector?.('.catalog-empty')?.remove?.();
  }

  _rebuildCardIndex() {
    this._cardById.clear();
    if (!this.root) return;

    this.root.querySelectorAll('[data-product-id]').forEach((card) => {
      const id = card.getAttribute('data-product-id');
      if (id != null) this._cardById.set(String(id), card);
    });
  }
}
