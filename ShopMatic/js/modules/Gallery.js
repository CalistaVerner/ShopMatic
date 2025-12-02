/**
 * Enhanced and optimized version of the Gallery class.
 * @author Calista Verner
 *
 * This implementation focuses on improving performance and reducing memory
 * overhead by adopting event delegation for thumbnail interaction and
 * guarding against multiple listener registrations. It also includes
 * minor fixes and quality of life improvements such as preventing
 * duplicate navigation bindings and more robust cleanup in destroy().
 */

/**
 * Optimized Gallery class.
 * Поддерживает:
 *  - свайпы
 *  - модальное окно
 *  - превью (thumbnails) с делегированием событий
 */
export class Gallery {
  constructor(rootEl, images = [], options = {}) {
    if (!rootEl) throw new Error('Gallery root element required');

    const defaults = {
      thumbContainerSelector: '.gallery-thumbs',
      thumbSelector: '[data-thumb]',
      mainSelector: '#product-main-image',
      mainFrameSelector: '.main-frame',
      modalId: 'galleryModal',
      circular: true,
      preloadAdjacent: 1,
      swipeThreshold: 40,
      transitionMs: 180,
      renderThumbs: true,
      placeholder: '',
      nav: true,
      navPrevClass: 'gallery-nav-prev',
      navNextClass: 'gallery-nav-next',
      navWrapperClass: 'gallery-nav',
      thumbScrollClass: 'gallery-thumb-scroll',
      thumbScrollIconClass: 'fa fa-chevron-down',
      animation: 'slide'
    };

    this.options = Object.assign({}, defaults, options);
    this.root = rootEl;

    this.mainImg   = this.root.querySelector(this.options.mainSelector);
    this.mainFrame = this.root.querySelector(this.options.mainFrameSelector);

    this.modal    = document.getElementById(this.options.modalId) || null;
    this.modalImg = this.modal ? this.modal.querySelector('.gallery-main-img') : null;

    this._listeners      = new Map();
    this._listenerId     = 0;
    this._thumbContainer = this.root.querySelector(this.options.thumbContainerSelector) || null;
    this._thumbs         = [];
    this.images          = [];
    this.current         = 0;
    this._prevIndex      = -1;
    this._animating      = false;
    this._animDuration   = Math.max(40, Number(this.options.transitionMs) || 180);
    this._tmpImage       = null;

    this._thumbScrollBtn      = null;
    this._thumbScrollObserver = null;
    this._thumbScrollRAF      = null;
    this._thumbScrollAttached = false;

    this._drag = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      lastDX: 0,
      targetIndex: null,
      direction: null,
      moved: false
    };
    this._pointerHandlers = {};
    this._suppressClick = false;
    this._clickSuppressMs = 250;
    this._suppressClickTimer = null;

    this._navInitialized = false;
    this._thumbHandlersBound = false;

    // mainFrame базовая подготовка
    if (this.mainFrame) {
      const csPos = window.getComputedStyle(this.mainFrame).position;
      if (csPos === 'static' || !csPos) this.mainFrame.style.position = 'relative';
      this.mainFrame.style.overflow = 'hidden';
      if (!this.mainFrame.style.zIndex) this.mainFrame.style.zIndex = '0';
      try { this.mainFrame.style.touchAction = this.mainFrame.style.touchAction || 'pan-y'; } catch (e) {}
    }

    // mainImg базовые стили
    if (this.mainImg) {
      const objFit = this.mainImg.style.objectFit || 'contain';
      this.mainImg.style.objectFit = objFit;
      this.mainImg.style.transition = `transform ${this._animDuration}ms ease, opacity ${Math.floor(this._animDuration / 2)}ms ease`;
      this.mainImg.style.transform = 'translateX(0)';
      this.mainImg.style.zIndex = '1';
      this.mainImg.draggable = false;
      this.mainImg.style.willChange = 'transform, opacity';
    }

    this._bound = {
      _onMainClick: (e) => this._onMainClick(e),
      _onRootKey:   (e) => this._onRootKey(e)
    };

    this._bindHandlers();

    if (images != null) {
      this.setImages(images, {
        showFirst: true,
        renderThumbs: this.options.renderThumbs
      });
    }
  }

  // --- generic listener helpers -------------------------------------------

  _addListener(el, evt, fn, opts = {}) {
    if (!el || !fn) return null;
    const id = ++this._listenerId;
    el.addEventListener(evt, fn, opts);
    this._listeners.set(id, { el, evt, fn, opts });
    return id;
  }

  _removeListener(id) {
    const rec = this._listeners.get(id);
    if (!rec) return;
    try { rec.el.removeEventListener(rec.evt, rec.fn, rec.opts); } catch (e) {}
    this._listeners.delete(id);
  }

  _removeAllListeners() {
    for (const id of this._listeners.keys()) this._removeListener(id);
  }

  // --- images normalization ------------------------------------------------

  _normalizeImages(images) {
    if (images == null) return [];
    if (typeof images === 'string') {
      const s = images.trim();
      if (!s) return [];
      try { return this._normalizeImages(JSON.parse(s)); }
      catch (_) { return this._normalizeImages([s]); }
    }

    if (!Array.isArray(images) && typeof images === 'object') {
      if (Array.isArray(images.images)) return this._normalizeImages(images.images);
      const maybe = ['gallery', 'files', 'pictures', 'photos'];
      for (const k of maybe) {
        if (Array.isArray(images[k])) return this._normalizeImages(images[k]);
      }
      const single = this._extractSrc(images);
      return single ? [{ id: null, src: single, thumb: single, alt: '' }] : [];
    }

    if (Array.isArray(images)) {
      const out = [];
      for (let i = 0; i < images.length; i++) {
        const norm = this._normalizeImageItem(images[i], i);
        if (norm && norm.src) out.push(norm);
      }
      const seen = new Set();
      const unique = [];
      for (const it of out) {
        if (!seen.has(it.src)) {
          seen.add(it.src);
          unique.push(it);
        }
      }
      return unique;
    }

    return [];
  }

  _normalizeImageItem(item, idx = 0) {
    if (!item && item !== 0) return null;

    if (typeof item === 'string') {
      const s = item.trim();
      return s ? { id: null, src: s, thumb: s, alt: '' } : null;
    }

    if (Array.isArray(item)) {
      for (const it of item) {
        const n = this._normalizeImageItem(it, idx);
        if (n && n.src) return n;
      }
      return null;
    }

    if (typeof item === 'object') {
      const fields = ['src', 'url', 'path', 'file', 'location', 'image'];
      const thumbFields = ['thumb', 'thumbnail', 'preview'];

      let src = '';
      for (const f of fields) {
        if (item[f]) {
          src = this._extractSrc(item[f]);
          if (src) break;
        }
      }

      if (!src) {
        const numericKeys = Object.keys(item)
          .filter(k => String(Number(k)) === k)
          .sort((a, b) => Number(a) - Number(b));
        for (const k of numericKeys) {
          const c = this._extractSrc(item[k]);
          if (c) { src = c; break; }
        }
      }

      let thumb = '';
      for (const f of thumbFields) {
        if (item[f]) {
          thumb = this._extractSrc(item[f]);
          if (thumb) break;
        }
      }
      if (!thumb) thumb = src || '';

      if (!src) return null;

      const alt = item.alt || item.title || item.name || '';
      const id  = item.id ?? item.key ?? null;
      return { id, src, thumb, alt };
    }

    return null;
  }

  _extractSrc(val) {
    if (val == null) return '';
    if (typeof val === 'string') {
      const s = val.trim();
      if (!s) return '';
      if (s[0] === '[' || s[0] === '{') {
        try { return this._extractSrc(JSON.parse(s)); }
        catch (_) { return s; }
      }
      return s;
    }
    if (Array.isArray(val)) {
      for (const v of val) {
        const c = this._extractSrc(v);
        if (c) return c;
      }
      return '';
    }
    if (typeof val === 'object') {
      const fields = ['src', 'url', 'path', 'file', 'location', 'thumb', 'thumbnail'];
      for (const f of fields) {
        if (val[f]) {
          const c = this._extractSrc(val[f]);
          if (c) return c;
        }
      }
      const ks = Object.keys(val).sort((a, b) => Number(a) - Number(b));
      for (const k of ks) {
        if (!isNaN(Number(k))) {
          const c = this._extractSrc(val[k]);
          if (c) return c;
        }
      }
      return '';
    }
    return '';
  }

  // --- thumbnails ----------------------------------------------------------

  renderThumbs() {
    if (!this._thumbContainer) return;

    this._unbindThumbHandlers();
    this._thumbContainer.innerHTML = '';

    const frag = document.createDocumentFragment();
    const placeholder = this.options.placeholder || '';

    this.images.forEach((it, i) => {
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

    this._thumbContainer.appendChild(frag);
    this._collectThumbs();
    this._bindThumbHandlers();
    if (this.images.length) this._markActive(this.current);
    this._ensureThumbScroll();
  }

  _collectThumbs() {
    if (this._thumbContainer) {
      this._thumbs = Array.from(this._thumbContainer.querySelectorAll('.gallery-thumb'));
      if (!this._thumbs.length) {
        this._thumbs = Array.from(this.root.querySelectorAll(this.options.thumbSelector));
      }
    } else {
      this._thumbs = Array.from(this.root.querySelectorAll(this.options.thumbSelector));
    }
  }

  _normalizeThumbSrcs() {
    const placeholder = this.options.placeholder || '';
    this._thumbs.forEach((t, i) => {
      const imgData = this.images[i];
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

  setImages(images, { showFirst = true, renderThumbs = true } = {}) {
    this._unbindThumbHandlers();
    this.images = this._normalizeImages(images);

    if (renderThumbs && this._thumbContainer) {
      this.renderThumbs();
    } else {
      this._collectThumbs();
      this._normalizeThumbSrcs();
      this._bindThumbHandlers();
    }

    if (this.images.length && showFirst) {
      this.show(0, { emit: false });
    }
  }

  refresh() {
    this._unbindThumbHandlers();
    this._collectThumbs();
    this._normalizeThumbSrcs();
    this._bindThumbHandlers();
    this._ensureThumbScroll();
  }

  // --- navigation / show ---------------------------------------------------

  _getDirection(prev, index) {
    const n = this.images.length;
    if (!Number.isFinite(prev) || prev < 0 || prev === index || n <= 1) return 'none';
    if (!this.options.circular) return index > prev ? 'right' : 'left';

    const forward  = (index - prev + n) % n;
    const backward = (prev - index + n) % n;
    return forward <= backward ? 'right' : 'left';
  }

  show(indexOrThumb, options = {}) {
    if (!this.images.length) return;

    let index;
    if (typeof indexOrThumb === 'number') {
      index = this._clampIndex(indexOrThumb);
    } else if (indexOrThumb?.dataset?.index) {
      const di = Number(indexOrThumb.dataset.index);
      index = Number.isFinite(di) ? this._clampIndex(di) : this._clampIndex(this._thumbs.indexOf(indexOrThumb));
    } else {
      index = this._clampIndex(0);
    }

    const item = this.images[index];
    const src  = item?.src;
    if (!src) return;

    if (index === this.current && this.mainImg && this.mainImg.src === src) return;

    const prevIndex = this.current;
    const direction = this._getDirection(this._prevIndex >= 0 ? this._prevIndex : prevIndex, index);

    this._prevIndex = prevIndex;
    this.current = index;

    this._thumbs.forEach((t, i) => {
      const is = i === index;
      t.classList.toggle('active', is);
      if (is) t.setAttribute('aria-current', 'true');
      else    t.removeAttribute('aria-current');
      t.dataset.index = String(i);
    });

    if (this.modal && !this.modal.hidden && this.modalImg) {
      this.modalImg.src = src;
    }

    this._preload(index);
    if (options.emit !== false) {
      this._emit('gallery:change', { index, src, item });
    }

    this._markActive(index);
    this._ensureThumbVisible(index);

    if (!this.mainImg || !this.mainFrame || direction === 'none' || this.options.animation !== 'slide') {
      this._simpleSwap(src, index, item);
      return;
    }

    if (this._animating) {
      if (this._tmpImage?.parentNode) this._tmpImage.parentNode.removeChild(this._tmpImage);
      this._animating = false;
      this._tmpImage = null;
      try {
        this.mainImg.style.transform = 'translateX(0)';
        this.mainImg.style.opacity = '1';
      } catch (e) {}
    }

    this._doAnimatedSwap(index, direction);
  }

  _simpleSwap(src, index, item) {
    if (!this.mainImg) return;

    this.mainImg.classList.add('is-loading');

    const onLoad = () => {
      this.mainImg.classList.remove('is-loading');
      this.mainImg.removeEventListener('load', onLoad);
      this._emit('gallery:loaded', { index, src });
    };

    const onError = () => {
      this.mainImg.classList.remove('is-loading');
      this.mainImg.removeEventListener('error', onError);
      if (this.options.placeholder) this.mainImg.src = this.options.placeholder;
      this._emit('gallery:error', { index, src });
    };

    this.mainImg.addEventListener('load', onLoad, { once: true });
    this.mainImg.addEventListener('error', onError, { once: true });

    setTimeout(() => {
      this.mainImg.src = src;
      this.mainImg.dataset.index = String(index);
      this.mainImg.alt = item.alt || '';
      if (this.mainImg.complete) onLoad();
    }, this.options.transitionMs);
  }

  _doAnimatedSwap(index, direction) {
    const item = this.images[index];
    const src  = item?.src;
    if (!src || !this.mainImg || !this.mainFrame) return;

    this.mainImg.classList.add('is-loading');
    this._animating = true;

    const tmp = document.createElement('img');
    this._tmpImage = tmp;

    tmp.decoding = 'async';
    tmp.loading = 'eager';
    tmp.alt = item.alt || '';
    tmp.draggable = false;

    Object.assign(tmp.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      objectFit: this.mainImg.style.objectFit || 'contain',
      transition: `transform ${this._animDuration}ms ease, opacity ${Math.floor(this._animDuration / 2)}ms ease`,
      zIndex: '2',
      opacity: '1'
    });

    const fromPct = direction === 'right' ? 100 : -100;
    tmp.style.transform = `translateX(${fromPct}%)`;

    this.mainImg.style.zIndex = '1';
    this.mainImg.style.transition = `transform ${this._animDuration}ms ease, opacity ${Math.floor(this._animDuration / 2)}ms ease`;
    this.mainImg.style.transform = 'translateX(0)';
    this.mainImg.style.opacity = '1';

    this.mainFrame.appendChild(tmp);

    const cleanup = () => {
      if (tmp.parentNode) tmp.parentNode.removeChild(tmp);
      this.mainImg.style.transition = '';
      this.mainImg.style.transform = 'translateX(0)';
      this.mainImg.style.opacity = '1';
      this.mainImg.src = src;
      this.mainImg.dataset.index = String(index);
      this.mainImg.alt = item.alt || '';
      this.mainImg.classList.remove('is-loading');
      this._emit('gallery:loaded', { index, src });
      this._animating = false;
      this._tmpImage = null;
    };

    const handleLoad = () => {
      tmp.removeEventListener('load', handleLoad);
      tmp.offsetHeight; // reflow

      requestAnimationFrame(() => {
        const mainTarget = direction === 'right' ? -100 : 100;
        this.mainImg.style.transform = `translateX(${mainTarget}%)`;
        this.mainImg.style.opacity = '0';
        tmp.style.transform = 'translateX(0%)';
      });

      const onTransEnd = (e) => {
        if (e && e.target !== tmp) return;
        tmp.removeEventListener('transitionend', onTransEnd);
        cleanup();
      };

      tmp.addEventListener('transitionend', onTransEnd);
      setTimeout(() => {
        if (!this._animating) return;
        try { tmp.removeEventListener('transitionend', onTransEnd); } catch (e) {}
        cleanup();
      }, this._animDuration + 70);
    };

    const handleError = () => {
      if (tmp.parentNode) tmp.parentNode.removeChild(tmp);
      this.mainImg.classList.remove('is-loading');
      if (this.options.placeholder) this.mainImg.src = this.options.placeholder;
      this._emit('gallery:error', { index, src });
      this._animating = false;
      this._tmpImage = null;
    };

    tmp.addEventListener('load', handleLoad, { once: true });
    tmp.addEventListener('error', handleError, { once: true });
    tmp.src = src;
  }

  _ensureThumbVisible(index) {
    if (!this._thumbContainer || !this._thumbs?.[index]) return;

    const el        = this._thumbs[index];
    const container = this._thumbContainer;

    const elTop    = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    const viewTop  = container.scrollTop;
    const viewBot  = viewTop + container.clientHeight;

    if (elTop < viewTop) {
      container.scrollTo({ top: elTop - 8, behavior: 'smooth' });
    } else if (elBottom > viewBot) {
      container.scrollTo({ top: elBottom - container.clientHeight + 8, behavior: 'smooth' });
    }
  }

  next() { this.show(this._clampIndex(this.current + 1)); }
  prev() { this.show(this._clampIndex(this.current - 1)); }

  openModal() {
    if (!this.modal || !this.modalImg) return;

    const src = this.images[this.current]?.src || this.mainImg?.src;
    if (src) this.modalImg.src = src;

    this._lastFocused = document.activeElement;
    this.modal.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    this._trapFocus();
    this.modal.setAttribute('aria-hidden', 'false');
    this._emit('gallery:open', { index: this.current, src });

    if (this.options.nav) this._ensureNav();
  }

  closeModal() {
    if (!this.modal) return;

    this.modal.hidden = true;
    if (this.modalImg) this.modalImg.src = '';
    document.documentElement.style.overflow = '';
    this._releaseFocusTrap();

    if (this._lastFocused && typeof this._lastFocused.focus === 'function') {
      this._lastFocused.focus();
    }

    this.modal.setAttribute('aria-hidden', 'true');
    this._emit('gallery:close', { index: this.current });
  }

  destroy() {
    this._removeAllListeners();

    if (this._thumbScrollBtn) {
      try { this._thumbScrollBtn.remove(); } catch (e) {}
      this._thumbScrollBtn = null;
    }

    if (this._thumbScrollObserver) {
      try { this._thumbScrollObserver.disconnect(); } catch (e) {}
      this._thumbScrollObserver = null;
    }

    if (this._thumbScrollRAF) {
      cancelAnimationFrame(this._thumbScrollRAF);
      this._thumbScrollRAF = null;
    }

    if (this._suppressClickTimer) {
      clearTimeout(this._suppressClickTimer);
      this._suppressClickTimer = null;
    }

    if (this._tmpImage?.parentNode) {
      try { this._tmpImage.parentNode.removeChild(this._tmpImage); } catch (e) {}
    }

    this._tmpImage = null;
    this._thumbs = [];
    this.images = [];
    this.mainImg = null;
    this.mainFrame = null;
    this.modal = null;
    this.modalImg = null;
  }

  // --- root handlers / bindings -------------------------------------------

  _onMainClick(e) {
    if (this._suppressClick) {
      e.preventDefault();
      e.stopPropagation?.();
      return;
    }
    if (e.target.closest && e.target.closest('button, a, input')) return;
    this.openModal();
  }

  _onRootKey(e) {
    if (this.modal && !this.modal.hidden) return;
    if (e.key === 'ArrowRight') this.next();
    if (e.key === 'ArrowLeft') this.prev();
  }

  _bindHandlers() {
    if (this.mainFrame) {
      this._addListener(this.mainFrame, 'click', this._bound._onMainClick);
    }

    if (this.modal) {
      const closeBtn = this.modal.querySelector('.gallery-close');
      const overlay  = this.modal.querySelector('.gallery-modal-overlay');

      if (closeBtn) this._addListener(closeBtn, 'click', () => this.closeModal());
      if (overlay)  this._addListener(overlay, 'click', () => this.closeModal());

      this._addListener(this.modal, 'keydown', (e) => {
        if (this.modal.hidden) return;
        if (e.key === 'Escape') this.closeModal();
        if (e.key === 'ArrowRight') this.next();
        if (e.key === 'ArrowLeft') this.prev();
      });
    }

    if (this.mainFrame) this._bindPointerSwipe();

    this._addListener(this.root, 'keydown', (e) => this._onRootKey(e));
    if (!this.root.hasAttribute('tabindex')) this.root.setAttribute('tabindex', '0');
  }

  _bindThumbHandlers() {
    if (this._thumbHandlersBound || !this._thumbContainer) return;

    const clickHandler = (e) => {
      const btn = e.target.closest('.gallery-thumb');
      if (!btn) return;
      e.preventDefault();
      this.show(btn);
      btn.focus();
    };

    const keyHandler = (e) => {
      const btn = e.target.closest('.gallery-thumb');
      if (!btn) return;
      const i = Number(btn.dataset.index);

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.show(btn);
        return;
      }

      if (!this._thumbs.length) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = this._thumbs[(i + 1) % this._thumbs.length];
        next && next.focus();
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = this._thumbs[(i - 1 + this._thumbs.length) % this._thumbs.length];
        prev && prev.focus();
      }
    };

    this._thumbClickListenerId = this._addListener(this._thumbContainer, 'click', clickHandler);
    this._thumbKeyListenerId   = this._addListener(this._thumbContainer, 'keydown', keyHandler);
    this._thumbHandlersBound   = true;

    this._thumbs.forEach((thumb) => {
      if (!thumb.hasAttribute('role')) thumb.setAttribute('role', 'button');
      if (!thumb.hasAttribute('tabindex')) thumb.tabIndex = 0;
    });
  }

  _unbindThumbHandlers() {
    if (!this._thumbHandlersBound) return;

    if (this._thumbClickListenerId) this._removeListener(this._thumbClickListenerId);
    if (this._thumbKeyListenerId)   this._removeListener(this._thumbKeyListenerId);

    this._thumbClickListenerId = null;
    this._thumbKeyListenerId   = null;
    this._thumbHandlersBound   = false;
  }

  _bindPointerSwipe() {
    if (!this.mainFrame) return;

    const down = (e) => {
      if (e.button && e.button !== 0) return;
      if (this._animating) return;
      if (e.target.closest && e.target.closest('button, a, input, textarea, select')) return;

      this._drag.active = true;
      this._drag.pointerId = e.pointerId ?? 'touch';
      this._drag.startX = e.clientX;
      this._drag.startY = e.clientY;
      this._drag.lastDX = 0;
      this._drag.targetIndex = null;
      this._drag.direction = null;
      this._drag.moved = false;

      try {
        e.currentTarget?.setPointerCapture?.(e.pointerId);
      } catch (_) {}

      document.body.style.userSelect = 'none';
    };

    const move = (e) => {
      if (!this._drag.active || (e.pointerId !== undefined && e.pointerId !== this._drag.pointerId)) return;

      const dx = e.clientX - this._drag.startX;
      const dy = e.clientY - this._drag.startY;

      if (!this._drag.moved && Math.abs(dx) > 6) this._drag.moved = true;
      if (!this._drag.direction && Math.abs(dx) > 6) {
        this._drag.direction = dx < 0 ? 'left' : 'right';
      }

      this._drag.lastDX = dx;

      const width = this.mainFrame.clientWidth || this.mainImg?.clientWidth || (window.innerWidth / 2);
      const sign  = dx < 0 ? -1 : 1;
      const targetIdx = this._clampIndex(this.current + (sign < 0 ? 1 : -1));

      if (this.images.length <= 1 || targetIdx === this.current) {
        const damp = dx * 0.35;
        this._applyDragTransforms(damp, null, width);
        return;
      }

      if (this._drag.targetIndex !== targetIdx || !this._tmpImage) {
        if (this._tmpImage?.parentNode) {
          try { this._tmpImage.parentNode.removeChild(this._tmpImage); } catch (_) {}
        }

        const tmp = document.createElement('img');
        this._tmpImage = tmp;

        tmp.decoding = 'async';
        tmp.loading = 'eager';
        tmp.draggable = false;
        Object.assign(tmp.style, {
          position: 'absolute',
          top: '0',
          left: '0',
          width: '100%',
          height: '100%',
          objectFit: this.mainImg?.style.objectFit || 'contain',
          transition: 'none',
          zIndex: '2',
          willChange: 'transform, opacity'
        });

        const initialOffset = sign < 0 ? width : -width;
        tmp.style.transform = `translateX(${initialOffset}px)`;

        this.mainFrame.appendChild(tmp);
        const candidate = this.images[targetIdx];
        if (candidate?.src) tmp.src = candidate.src;

        this._drag.targetIndex = targetIdx;
      }

      this._applyDragTransforms(dx, this._tmpImage, width);
      if (Math.abs(dx) > 8) e.preventDefault?.();
    };

    const up = (e) => {
      if (!this._drag.active || (e && e.pointerId !== undefined && e.pointerId !== this._drag.pointerId)) return;

      const dx    = this._drag.lastDX;
      const abs   = Math.abs(dx);
      const width = this.mainFrame.clientWidth || this.mainImg?.clientWidth || (window.innerWidth / 2);

      try {
        e.currentTarget?.releasePointerCapture?.(e.pointerId);
      } catch (_) {}

      document.body.style.userSelect = '';

      if (this._drag.moved) {
        this._suppressClick = true;
        clearTimeout(this._suppressClickTimer);
        this._suppressClickTimer = setTimeout(() => {
          this._suppressClick = false;
          this._suppressClickTimer = null;
        }, this._clickSuppressMs);
      }

      const sign      = dx < 0 ? -1 : 1;
      const targetIdx = this._drag.targetIndex != null
        ? this._drag.targetIndex
        : this._clampIndex(this.current + (sign < 0 ? 1 : -1));

      const threshold = Math.min(this.options.swipeThreshold, Math.round(width * 0.18));

      if (this.images.length > 1 && abs > threshold && targetIdx !== this.current) {
        this._animateDragToComplete(sign, targetIdx, dx, width);
      } else {
        this._animateDragRollback();
      }

      this._drag.active      = false;
      this._drag.pointerId   = null;
      this._drag.lastDX      = 0;
      this._drag.targetIndex = null;
      this._drag.direction   = null;
      this._drag.moved       = false;
    };

    const cancel = (e) => {
      if (!this._drag.active) return;

      try {
        e.currentTarget?.releasePointerCapture?.(e.pointerId);
      } catch (_) {}

      document.body.style.userSelect = '';
      this._drag.active      = false;
      this._drag.pointerId   = null;
      this._drag.direction   = null;
      this._drag.targetIndex = null;
      this._drag.moved       = false;
      this._animateDragRollback();
    };

    this._pointerHandlers.down    = down;
    this._pointerHandlers.move    = move;
    this._pointerHandlers.up      = up;
    this._pointerHandlers.cancel  = cancel;

    this._addListener(this.mainFrame, 'pointerdown', down);
    this._addListener(this.mainFrame, 'pointermove', move);
    this._addListener(this.mainFrame, 'pointerup', up);
    this._addListener(this.mainFrame, 'pointercancel', cancel);

    const touchStart = (e) => {
      const t = e.touches?.[0];
      if (!t) return;
      down({
        pointerId: 'touch',
        clientX: t.clientX,
        clientY: t.clientY,
        currentTarget: this.mainFrame,
        target: e.target,
        button: 0
      });
    };

    const touchMove = (e) => {
      const t = e.touches?.[0];
      if (!t) return;
      move({
        pointerId: 'touch',
        clientX: t.clientX,
        clientY: t.clientY,
        currentTarget: this.mainFrame,
        target: e.target,
        preventDefault: () => e.preventDefault()
      });
    };

    const touchEnd = (e) => {
      const t = e.changedTouches?.[0] || null;
      up({
        pointerId: 'touch',
        clientX: t ? t.clientX : 0,
        clientY: t ? t.clientY : 0,
        currentTarget: this.mainFrame,
        target: e.target
      });
    };

    this._addListener(this.mainFrame, 'touchstart', touchStart, { passive: true });
    this._addListener(this.mainFrame, 'touchmove',  touchMove,  { passive: false });
    this._addListener(this.mainFrame, 'touchend',   touchEnd,   { passive: true });
  }

  _applyDragTransforms(dx, tmpEl, width) {
    if (!this.mainImg) return;

    const maxOffset = width * 0.6;
    const limited   = Math.abs(dx) > maxOffset ? maxOffset * Math.sign(dx) : dx;

    this.mainImg.style.transition = 'none';
    this.mainImg.style.transform  = `translateX(${limited}px)`;
    this.mainImg.style.opacity    = String(Math.max(0.35, 1 - Math.abs(limited) / (width * 1.2)));

    if (!tmpEl) return;

    tmpEl.style.transition = 'none';
    const sign       = limited < 0 ? 1 : -1;
    const baseOffset = sign > 0 ? width : -width;
    tmpEl.style.transform = `translateX(${baseOffset + limited}px)`;
    tmpEl.style.opacity   = '1';
  }

  _animateDragRollback() {
    if (!this.mainImg) return;

    const dur = Math.round(this._animDuration / 1.5);
    const opDur = Math.round(this._animDuration / 2);

    this.mainImg.style.transition = `transform ${dur}ms ease, opacity ${opDur}ms ease`;
    this.mainImg.style.transform  = 'translateX(0)';
    this.mainImg.style.opacity    = '1';

    if (!this._tmpImage) return;

    const tmp   = this._tmpImage;
    const width = this.mainFrame?.clientWidth || this.mainImg.clientWidth || (window.innerWidth / 2);
    const cur   = this._getTranslateXValue(tmp);
    const sign  = cur >= 0 ? 1 : -1;
    const final = sign > 0 ? width : -width;

    tmp.style.transition = `transform ${dur}ms ease, opacity ${opDur}ms ease`;
    tmp.style.transform  = `translateX(${final}px)`;
    tmp.style.opacity    = '0';

    const cleanup = () => {
      if (tmp.parentNode) {
        try { tmp.parentNode.removeChild(tmp); } catch (e) {}
      }
      if (this._tmpImage === tmp) this._tmpImage = null;
    };

    tmp.addEventListener('transitionend', function once() {
      tmp.removeEventListener('transitionend', once);
      cleanup();
    });

    setTimeout(cleanup, dur + 120);
  }

  _animateDragToComplete(sign, targetIdx, dx, width) {
    if (!this.mainImg || this._animating) return;

    this._animating = true;
    const tmp = this._tmpImage;
    const dur = Math.round(this._animDuration * 0.9);
    const opDur = Math.round(dur / 2);

    this.mainImg.style.transition = `transform ${dur}ms cubic-bezier(.2,.9,.2,1), opacity ${opDur}ms ease`;
    this.mainImg.style.transform  = `translateX(${sign < 0 ? -width : width}px)`;
    this.mainImg.style.opacity    = '0';

    if (tmp) {
      tmp.style.transition = `transform ${dur}ms cubic-bezier(.2,.9,.2,1), opacity ${opDur}ms ease`;
      tmp.style.transform  = 'translateX(0px)';
      tmp.style.opacity    = '1';
    }

    const finish = () => {
      if (tmp?.parentNode) {
        try { tmp.parentNode.removeChild(tmp); } catch (e) {}
      }
      this._tmpImage = null;

      const item = this.images[targetIdx];
      if (item?.src) {
        this.mainImg.src = item.src;
        this.mainImg.dataset.index = String(targetIdx);
        this.mainImg.alt = item.alt || '';
      }

      this.mainImg.style.transition = '';
      this.mainImg.style.transform  = 'translateX(0)';
      this.mainImg.style.opacity    = '1';

      this._prevIndex = this.current;
      this.current = targetIdx;
      this._animating = false;

      this._emit('gallery:change', { index: this.current, src: this.mainImg.src, item: this.images[this.current] });
      this._emit('gallery:loaded', { index: this.current, src: this.mainImg.src });
      this._markActive(this.current);
      this._ensureThumbVisible(this.current);
    };

    let handled = false;

    const onEnd = () => {
      if (handled) return;
      handled = true;
      this.mainImg.removeEventListener('transitionend', onEnd);
      finish();
    };

    this.mainImg.addEventListener('transitionend', onEnd);

    setTimeout(() => {
      if (handled) return;
      handled = true;
      try { this.mainImg.removeEventListener('transitionend', onEnd); } catch (e) {}
      finish();
    }, dur + 150);
  }

  _getTranslateXValue(el) {
    try {
      const s = getComputedStyle(el).transform;
      if (!s || s === 'none') return 0;

      const m = s.match(/matrix\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(',').map(p => parseFloat(p.trim()));
        return parts[4] || 0;
      }

      const m3 = s.match(/matrix3d\(([^)]+)\)/);
      if (m3) {
        const parts = m3[1].split(',').map(p => parseFloat(p.trim()));
        return parts[12] || 0;
      }
    } catch (e) {}

    return 0;
  }

  // --- focus / modal nav ---------------------------------------------------

  _trapFocus() {
    if (!this.modal) return;

    const focusables = this.modal.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    this._focusables = Array.from(focusables);
    if (!this._focusables.length) return;

    this._modalKeyHandler = (e) => {
      if (e.key !== 'Tab') return;
      const first = this._focusables[0];
      const last  = this._focusables[this._focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    this.modal.addEventListener('keydown', this._modalKeyHandler);
    this._focusables[0].focus();
  }

  _releaseFocusTrap() {
    if (!this.modal || !this._modalKeyHandler) return;
    this.modal.removeEventListener('keydown', this._modalKeyHandler);
    this._modalKeyHandler = null;
    this._focusables = null;
  }

  _ensureNav() {
    if (!this.modal || this._navInitialized) return;

    const modalContent = this.modal.querySelector('.gallery-modal-content') || this.modal;
    if (!modalContent) return;

    const existing = this.modal.querySelector(`.${this.options.navWrapperClass}`);

    if (!existing) {
      const wrap = document.createElement('div');
      wrap.className = this.options.navWrapperClass;

      const prev = document.createElement('button');
      prev.type = 'button';
      prev.className = this.options.navPrevClass;
      prev.setAttribute('aria-label', 'Предыдущее изображение');
      prev.innerHTML = '<i class="fa fa-chevron-left" aria-hidden="true"></i>';

      const next = document.createElement('button');
      next.type = 'button';
      next.className = this.options.navNextClass;
      next.setAttribute('aria-label', 'Следующее изображение');
      next.innerHTML = '<i class="fa fa-chevron-right" aria-hidden="true"></i>';

      wrap.appendChild(prev);
      wrap.appendChild(next);
      modalContent.appendChild(wrap);

      this._navWrap = wrap;
      this._navPrev = prev;
      this._navNext = next;

      this._addListener(prev, 'click', (e) => { e.preventDefault(); this.prev(); });
      this._addListener(next, 'click', (e) => { e.preventDefault(); this.next(); });
      this._addListener(prev, 'keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.prev(); }
      });
      this._addListener(next, 'keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.next(); }
      });
    } else {
      this._navWrap = existing;
      this._navPrev = this._navWrap.querySelector(`.${this.options.navPrevClass}`);
      this._navNext = this._navWrap.querySelector(`.${this.options.navNextClass}`);

      if (this._navPrev) {
        this._addListener(this._navPrev, 'click', (e) => { e.preventDefault(); this.prev(); });
      }
      if (this._navNext) {
        this._addListener(this._navNext, 'click', (e) => { e.preventDefault(); this.next(); });
      }
    }

    this._navInitialized = true;
  }

  // --- thumb scroll helper -------------------------------------------------

  _ensureThumbScroll() {
    if (!this._thumbContainer) return;

    if (!this._thumbScrollBtn) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = this.options.thumbScrollClass;
      btn.setAttribute('aria-label', 'Прокрутить миниатюры вниз');
      btn.innerHTML = `<i class="${this.options.thumbScrollIconClass}" aria-hidden="true"></i>`;

      this._thumbContainer.appendChild(btn);
      this._thumbScrollBtn = btn;

      this._thumbScrollHandler = (e) => {
        e.preventDefault();
        const scrollAmount = Math.max(this._thumbContainer.clientHeight * 0.85, 120);
        this._thumbContainer.scrollBy({ top: scrollAmount, behavior: 'smooth' });
      };
      this._addListener(btn, 'click', this._thumbScrollHandler);
    }

    if (!this._thumbScrollAttached) {
      this._addListener(this._thumbContainer, 'scroll', () => this._scheduleThumbScrollUpdate());
      this._addListener(window, 'resize', () => this._scheduleThumbScrollUpdate());
      this._thumbScrollAttached = true;
    }

    if (this._thumbScrollObserver) {
      this._thumbScrollObserver.disconnect();
    }

    this._thumbScrollObserver = new MutationObserver(() => this._scheduleThumbScrollUpdate());
    this._thumbScrollObserver.observe(this._thumbContainer, { childList: true, subtree: true });

    this._scheduleThumbScrollUpdate();
  }

  _scheduleThumbScrollUpdate() {
    if (this._thumbScrollRAF) cancelAnimationFrame(this._thumbScrollRAF);
    this._thumbScrollRAF = requestAnimationFrame(() => this._updateThumbScrollState());
  }

  _updateThumbScrollState() {
    if (!this._thumbContainer || !this._thumbScrollBtn) return;

    const needsScroll =
      this._thumbContainer.scrollHeight > this._thumbContainer.clientHeight + 1;

    if (!needsScroll) {
      this._thumbScrollBtn.hidden = true;
      return;
    }

    const atBottom =
      this._thumbContainer.scrollTop + this._thumbContainer.clientHeight >=
      this._thumbContainer.scrollHeight - 2;

    this._thumbScrollBtn.hidden = atBottom;
  }

  // --- misc helpers --------------------------------------------------------

  _markActive(index) {
    if (!this._thumbs?.length) return;
    this._thumbs.forEach((t, i) => {
      const is = i === index;
      t.classList.toggle('active', is);
      if (is) t.setAttribute('aria-current', 'true');
      else    t.removeAttribute('aria-current');
    });
  }

  _emit(name, detail = {}) {
    try {
      this.root.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (_) {}
  }

  _clampIndex(idx) {
    const n = this.images.length;
    if (!n) return 0;
    if (this.options.circular) return ((idx % n) + n) % n;
    return Math.max(0, Math.min(idx, n - 1));
  }

  _preload(index) {
    const n = this.images.length;
    if (!n || this.options.preloadAdjacent <= 0) return;

    for (let d = 1; d <= this.options.preloadAdjacent; d++) {
      [index + d, index - d].forEach(i => {
        const j   = this._clampIndex(i);
        const src = this.images[j]?.src;
        if (src) {
          const img = new Image();
          img.src = src;
        }
      });
    }
  }
}