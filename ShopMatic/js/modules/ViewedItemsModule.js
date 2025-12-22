/**
 * ViewedItemsModule
 * @author Calista Verner
 *
 * This module is responsible for loading and rendering a list of recently viewed
 * products into the DOM. It leverages the provided StorageService to fetch
 * stored items from localStorage and, if possible, enriches them with
 * availability information via productService.fetchById.
 * 
 * Date: 2025-11-01
 * License: MIT
 */

export class ViewedItemsModule {
  constructor({ storageService, renderer = null, container, opts = {} }) {
    if (!storageService) throw new Error('ViewedItemsModule requires a storageService.');

    this._storage = storageService;
    this._renderer = renderer;
    this._container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!this._container) {
      throw new Error('ViewedItemsModule: container element not found.');
    }

    const defaults = {
      maxItems: Number.isFinite(Number(storageService?.maxViewedItems))
        ? Number(storageService.maxViewedItems)
        : 20,
      concurrency: Number.isFinite(Number(storageService?.defaultConcurrency))
        ? Number(storageService.defaultConcurrency)
        : 6,
      noItemsMessage: 'Нет просмотренных товаров.'
    };

    this._opts = { ...defaults, ...opts };
  }

  async load() {
    this._container.innerHTML = '';

    let raw;
    try {
      raw = this._storage.loadViewed?.() || [];
    } catch (e) {
      console.warn('ViewedItemsModule: failed to load viewed items', e);
      raw = [];
    }

    if (!Array.isArray(raw) || raw.length === 0) {
      this._renderEmpty();
      return;
    }

    const itemsToLoad = raw
      .slice()
      .sort((a, b) => (b.viewedAt || 0) - (a.viewedAt || 0))
      .slice(0, this._opts.maxItems);

    let enriched = itemsToLoad;
    try {
      if (typeof this._storage._loadWithAvailability === 'function') {
        enriched = await this._storage._loadWithAvailability(itemsToLoad, {
          concurrency: this._opts.concurrency
        });
      }
    } catch (e) {
      console.warn('ViewedItemsModule: _loadWithAvailability failed', e);
    }

    await this._render(enriched);
  }

  async _render(items) {
    if (!this._container) return;

    try {
      if (this._renderer && typeof this._renderer.renderCards === 'function') {
        const tmp = document.createElement('div');
        const res = this._renderer.renderCards(tmp, items, this._renderer.foxEngine);
        if (res && typeof res.then === 'function') {
          await res;
        }
        this._container.innerHTML = '';
        this._container.appendChild(tmp);
        return;
      }
    } catch (e) {
      console.warn('ViewedItemsModule: renderer.renderCards failed', e);
    }

    this._renderFallback(items);
  }

  _renderFallback(items) {
    const ul = document.createElement('ul');
    ul.className = 'viewed-items-list';

    for (const it of items) {
      const li = document.createElement('li');
      li.className = 'viewed-item';

      const content = document.createElement('div');
      content.className = 'viewed-item__content';

      const pictureUrl = this._getFirstPicture(it.picture);
      if (pictureUrl) {
        const img = document.createElement('img');
        img.src = pictureUrl;
        img.loading = 'lazy';
        img.width = 80;
        img.height = 80;
        img.className = 'viewed-item__image';
        content.appendChild(img);
      }

      const link = document.createElement('a');
      link.href = `#product/${encodeURIComponent(it.name || '')}`;
      link.textContent = String(it.fullname || it.name || '');
      link.className = 'viewed-item__link';
      content.appendChild(link);

      const available = this._isAvailable(it);
      const status = document.createElement('span');
      status.className = 'viewed-item__status';
      status.textContent = available ? 'В наличии' : 'Нет в наличии';
      status.style.marginLeft = '8px';
      content.appendChild(status);

      li.appendChild(content);

      const viewButton = document.createElement('button');
      viewButton.className = 'viewed-item__button';
      viewButton.textContent = 'Посмотреть';
      viewButton.onclick = () => { window.location.href = link.href; };
      li.appendChild(viewButton);

      ul.appendChild(li);
    }

    this._container.innerHTML = '';
    this._container.appendChild(ul);
    this._addClearHistoryButton();
  }

  _addClearHistoryButton() {
    const wrapper = document.createElement('div');
    wrapper.className = 'clearViewed';

    const link = document.createElement('a');
    link.href = 'javascript:void(0)';
    link.textContent = 'Очистить историю';
    link.onclick = () => {
      try {
        this._storage.clearViewed?.();
        this._container.innerHTML = '';
        this._renderEmpty();
      } catch (e) {
        console.warn('ViewedItemsModule: clearViewed failed', e);
      }
    };

    wrapper.appendChild(link);
    this._container.appendChild(wrapper);
  }

  _renderEmpty() {
    this._container.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'viewed-items-empty';
    p.textContent = String(this._opts.noItemsMessage);
    this._container.appendChild(p);
  }

  _getFirstPicture(picture) {
    if (!picture) return null;

    try {
      const val = typeof picture === 'string' ? JSON.parse(picture) : picture;
      if (Array.isArray(val) && val.length) return String(val[0]);
      if (typeof val === 'string') return val;
    } catch (_) {
      if (typeof picture === 'string') return picture;
    }

    return null;
  }

  _isAvailable(item) {
    try {
      return !!this._storage?.shopMatic?.cart?.isAvailable?.(item);
    } catch (_) {
      return false;
    }
  }

  async sync() {
    return this.load();
  }
}
