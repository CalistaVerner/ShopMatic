// gallery-thumbs-helper.js
export class GalleryThumbsHelper {
  /**
   * @param {import('./gallery.js').Gallery} gallery
   */
  constructor(gallery) {
    this.gallery = gallery;
  }

  /** Собрать список миниатюр в gallery._thumbs */
  collectThumbs() {
    const g = this.gallery;
    if (g._thumbContainer) {
      g._thumbs = Array.from(g._thumbContainer.querySelectorAll('.gallery-thumb'));
      if (!g._thumbs.length) {
        g._thumbs = Array.from(g.root.querySelectorAll(g.options.thumbSelector));
      }
    } else {
      g._thumbs = Array.from(g.root.querySelectorAll(g.options.thumbSelector));
    }
  }

  /** Обновить src/alt уже существующих миниатюр без полного ререндера */
  normalizeThumbSrcs() {
    const g = this.gallery;
    const placeholder = g.options.placeholder || '';
    g._thumbs.forEach((t, i) => {
      const imgData = g.images[i];
      if (!imgData) return;
      const expected = imgData.thumb || imgData.src || placeholder;
      let img = t.querySelector('img');
      t.dataset.index = String(i);
      if (img) {
        if (!img.src || img.src !== expected) img.src = expected;
        if (!img.alt) img.alt = imgData.alt || '';
      } else {
        img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = expected;
        img.alt = imgData.alt || '';
        t.appendChild(img);
      }
    });
  }

  /** Рендер миниатюр с нуля */
  renderThumbs() {
    const g = this.gallery;
    const container = g._thumbContainer;
    if (!container) return;

    this.unbindThumbHandlers();
    container.innerHTML = '';

    const frag = document.createDocumentFragment();
    const placeholder = g.options.placeholder || '';

    g.images.forEach((it, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gallery-thumb';
      btn.setAttribute('aria-label', it.alt || `Изображение ${i + 1}`);
      btn.dataset.index = String(i);
      btn.setAttribute('role', 'button');
      btn.tabIndex = 0;

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = it.thumb || it.src || placeholder;
      img.alt = it.alt || '';

      btn.appendChild(img);
      frag.appendChild(btn);
    });

    container.appendChild(frag);
    this.collectThumbs();
    this.bindThumbHandlers();
    if (g.images.length) this.markActive(g.current);
    this.ensureThumbScroll();
  }

  /** Проставить active/aria-current на миниатюры */
  markActive(index) {
    const g = this.gallery;
    if (!g._thumbs?.length) return;
    g._thumbs.forEach((t, i) => {
      const isActive = i === index;
      t.classList.toggle('active', isActive);
      if (isActive) t.setAttribute('aria-current', 'true');
      else t.removeAttribute('aria-current');
    });
  }

  /** Обеспечить видимость активной миниатюры */
  ensureThumbVisible(index) {
    const g = this.gallery;
    if (!g._thumbContainer || !g._thumbs?.[index]) return;
    const el        = g._thumbs[index];
    const container = g._thumbContainer;
    const elTop     = el.offsetTop;
    const elBottom  = elTop + el.offsetHeight;
    const viewTop   = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    if (elTop < viewTop) {
      container.scrollTo({ top: elTop - 8, behavior: 'smooth' });
    } else if (elBottom > viewBottom) {
      container.scrollTo({ top: elBottom - container.clientHeight + 8, behavior: 'smooth' });
    }
  }

  /** Навесить обработчики на контейнер миниатюр (делегирование) */
  bindThumbHandlers() {
    const g = this.gallery;
    if (g._thumbHandlersBound || !g._thumbContainer) return;

    const clickHandler = (e) => {
      const btn = e.target.closest('.gallery-thumb');
      if (!btn) return;
      e.preventDefault();
      g.show(btn);
      btn.focus();
    };

    const keyHandler = (e) => {
      const btn = e.target.closest('.gallery-thumb');
      if (!btn) return;
      const idx = Number(btn.dataset.index);
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        g.show(btn);
        return;
      }
      if (!g._thumbs.length) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = g._thumbs[(idx + 1) % g._thumbs.length];
        if (next) next.focus();
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = g._thumbs[(idx - 1 + g._thumbs.length) % g._thumbs.length];
        if (prev) prev.focus();
      }
    };

    g._thumbClickListenerId = g._addListener(g._thumbContainer, 'click', clickHandler);
    g._thumbKeyListenerId   = g._addListener(g._thumbContainer, 'keydown', keyHandler);
    g._thumbHandlersBound   = true;

    g._thumbs.forEach((thumb) => {
      if (!thumb.hasAttribute('role')) thumb.setAttribute('role', 'button');
      if (!thumb.hasAttribute('tabindex')) thumb.tabIndex = 0;
    });
  }

  /** Снять обработчики миниатюр */
  unbindThumbHandlers() {
    const g = this.gallery;
    if (!g._thumbHandlersBound) return;
    if (g._thumbClickListenerId) g._removeListener(g._thumbClickListenerId);
    if (g._thumbKeyListenerId)   g._removeListener(g._thumbKeyListenerId);
    g._thumbClickListenerId = null;
    g._thumbKeyListenerId   = null;
    g._thumbHandlersBound   = false;
  }

  /** Инициализировать кнопку скролла миниатюр и обсервер */
  ensureThumbScroll() {
    const g = this.gallery;
    if (!g._thumbContainer) return;

    if (!g._thumbScrollBtn) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = g.options.thumbScrollClass;
      btn.setAttribute('aria-label', 'Прокрутить миниатюры вниз');
      btn.innerHTML = `<i class="${g.options.thumbScrollIconClass}" aria-hidden="true"></i>`;
      g._thumbContainer.appendChild(btn);
      g._thumbScrollBtn = btn;

      g._thumbScrollHandler = (e) => {
        e.preventDefault();
        const scrollAmount = Math.max(g._thumbContainer.clientHeight * 0.85, 120);
        g._thumbContainer.scrollBy({ top: scrollAmount, behavior: 'smooth' });
      };
      g._addListener(btn, 'click', g._thumbScrollHandler);
    }

    if (!g._thumbScrollAttached) {
      g._addListener(g._thumbContainer, 'scroll', () => this.scheduleThumbScrollUpdate());
      g._addListener(window, 'resize', () => this.scheduleThumbScrollUpdate());
      g._thumbScrollAttached = true;
    }

    if (g._thumbScrollObserver) {
      g._thumbScrollObserver.disconnect();
    }
    g._thumbScrollObserver = new MutationObserver(() => this.scheduleThumbScrollUpdate());
    g._thumbScrollObserver.observe(g._thumbContainer, { childList: true, subtree: true });
    this.scheduleThumbScrollUpdate();
  }

  scheduleThumbScrollUpdate() {
    const g = this.gallery;
    if (g._thumbScrollRAF) cancelAnimationFrame(g._thumbScrollRAF);
    g._thumbScrollRAF = requestAnimationFrame(() => this.updateThumbScrollState());
  }

  updateThumbScrollState() {
    const g = this.gallery;
    if (!g._thumbContainer || !g._thumbScrollBtn) return;
    const needsScroll = g._thumbContainer.scrollHeight > g._thumbContainer.clientHeight + 1;
    if (!needsScroll) {
      g._thumbScrollBtn.hidden = true;
      return;
    }
    const atBottom = g._thumbContainer.scrollTop + g._thumbContainer.clientHeight >= g._thumbContainer.scrollHeight - 2;
    g._thumbScrollBtn.hidden = atBottom;
  }
}
