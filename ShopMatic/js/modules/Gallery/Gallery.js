// gallery.js
import { GalleryImagesHelper } from './gallery-images-helper.js';
import { GalleryThumbsHelper } from './gallery-thumbs-helper.js';
import { GallerySwipeHelper }  from './gallery-swipe-helper.js';

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

    this.mainImg    = this.root.querySelector(this.options.mainSelector) || null;
    this.mainFrame  = this.root.querySelector(this.options.mainFrameSelector) || null;
    this.modal      = document.getElementById(this.options.modalId) || null;
    this.modalImg   = this.modal ? this.modal.querySelector('.gallery-main-img') : null;
    this._thumbContainer = this.root.querySelector(this.options.thumbContainerSelector) || null;
    this._thumbs    = [];

    this.images     = [];
    this.current    = 0;
    this._prevIndex = -1;
    this._animating = false;
    this._animDuration = Math.max(40, Number(this.options.transitionMs) || 180);
    this._tmpImage  = null;

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

    this._listeners = new Map();
    this._listenerId = 0;

    this._focusables = null;
    this._modalKeyHandler = null;
    this._lastFocused = null;

    this._bound = {
      onMainClick: (e) => this._onMainClick(e),
      onRootKey:   (e) => this._onRootKey(e)
    };

    // помощники
    this._imagesHelper  = new GalleryImagesHelper(this);
    this._thumbsHelper  = new GalleryThumbsHelper(this);
    this._swipeHelper   = new GallerySwipeHelper(this);

    this._prepareMainFrame();
    this._prepareMainImg();
    this._bindCoreHandlers();

    if (images != null) {
      this.setImages(images, { showFirst: true, renderThumbs: this.options.renderThumbs });
    }
  }

  /* ================== НОРМАЛИЗАЦИЯ / ДЕЛЕГАЦИЯ ================== */

  _extractUrlsFromString(str) {
    return this._imagesHelper.extractUrlsFromString(str);
  }

  _extractSrc(val) {
    return this._imagesHelper.extractSrc(val);
  }

  _normalizeImageItem(item, idx = 0) {
    return this._imagesHelper.normalizeImageItem(item, idx);
  }

  _normalizeImages(images) {
    return this._imagesHelper.normalizeImages(images);
  }

  _preload(index) {
    this._imagesHelper.preload(index);
  }

  /* ================== ПОДГОТОВКА DOM ================== */

  _prepareMainFrame() {
    if (!this.mainFrame) return;
    const csPos = window.getComputedStyle(this.mainFrame).position;
    if (csPos === 'static' || !csPos) {
      this.mainFrame.style.position = 'relative';
    }
    this.mainFrame.style.overflow = 'hidden';
    if (!this.mainFrame.style.zIndex) {
      this.mainFrame.style.zIndex = '0';
    }
    try {
      this.mainFrame.style.touchAction = this.mainFrame.style.touchAction || 'pan-y';
    } catch {}
  }

  _prepareMainImg() {
    if (!this.mainImg) return;
    const objFit = this.mainImg.style.objectFit || 'contain';
    this.mainImg.style.objectFit = objFit;
    this.mainImg.style.transition =
      `transform ${this._animDuration}ms ease, opacity ${Math.floor(this._animDuration / 2)}ms ease`;
    this.mainImg.style.transform = 'translateX(0)';
    this.mainImg.style.zIndex = '1';
    this.mainImg.draggable = false;
    this.mainImg.style.willChange = 'transform, opacity';
  }

  _bindCoreHandlers() {
    if (this.mainFrame) {
      this._addListener(this.mainFrame, 'click', this._bound.onMainClick);
    }
    this._addListener(this.root, 'keydown', (e) => this._onRootKey(e));
    if (!this.root.hasAttribute('tabindex')) {
      this.root.setAttribute('tabindex', '0');
    }

    if (this.modal) {
      const closeBtn = this.modal.querySelector('.gallery-close');
      const overlay  = this.modal.querySelector('.gallery-modal-overlay');
      if (closeBtn) this._addListener(closeBtn, 'click', () => this.closeModal());
      if (overlay)  this._addListener(overlay,  'click', () => this.closeModal());
      this._addListener(this.modal, 'keydown', (e) => {
        if (this.modal.hidden) return;
        if (e.key === 'Escape') this.closeModal();
        if (e.key === 'ArrowRight') this.next();
        if (e.key === 'ArrowLeft')  this.prev();
      });
    }

    if (this.mainFrame) {
      this._bindPointerSwipe();
    }
  }

  /* ================== ПУБЛИЧНЫЙ API ================== */

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

  next() {
    this.show(this._clampIndex(this.current + 1));
  }

  prev() {
    this.show(this._clampIndex(this.current - 1));
  }

  show(indexOrThumb, options = {}) {
    if (!this.images.length) return;

    let index;
    if (typeof indexOrThumb === 'number') {
      index = this._clampIndex(indexOrThumb);
    } else if (indexOrThumb?.dataset?.index) {
      const di = Number(indexOrThumb.dataset.index);
      index = Number.isFinite(di)
        ? this._clampIndex(di)
        : this._clampIndex(this._thumbs.indexOf(indexOrThumb));
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
    this.current    = index;

    this._thumbs.forEach((t, i) => {
      const isActive = i === index;
      t.classList.toggle('active', isActive);
      if (isActive) t.setAttribute('aria-current', 'true');
      else t.removeAttribute('aria-current');
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

    if (
      !this.mainImg ||
      !this.mainFrame ||
      direction === 'none' ||
      this.options.animation !== 'slide'
    ) {
      this._simpleSwap(src, index, item);
      return;
    }

    if (this._animating) {
      if (this._tmpImage?.parentNode) {
        this._tmpImage.parentNode.removeChild(this._tmpImage);
      }
      this._animating = false;
      this._tmpImage  = null;
      try {
        this.mainImg.style.transform = 'translateX(0)';
        this.mainImg.style.opacity   = '1';
      } catch {}
    }

    this._doAnimatedSwap(index, direction);
  }

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

  renderThumbs() {
    this._thumbsHelper.renderThumbs();
  }

  destroy() {
    this._removeAllListeners();

    if (this._thumbScrollBtn) {
      try { this._thumbScrollBtn.remove(); } catch {}
      this._thumbScrollBtn = null;
    }
    if (this._thumbScrollObserver) {
      try { this._thumbScrollObserver.disconnect(); } catch {}
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
      try { this._tmpImage.parentNode.removeChild(this._tmpImage); } catch {}
    }
    this._tmpImage = null;

    this._thumbs = [];
    this.images  = [];
    this.mainImg   = null;
    this.mainFrame = null;
    this.modal     = null;
    this.modalImg  = null;
  }

  /* ================== THUMBS: делегаты ================== */

  _collectThumbs() {
    this._thumbsHelper.collectThumbs();
  }

  _normalizeThumbSrcs() {
    this._thumbsHelper.normalizeThumbSrcs();
  }

  _bindThumbHandlers() {
    this._thumbsHelper.bindThumbHandlers();
  }

  _unbindThumbHandlers() {
    this._thumbsHelper.unbindThumbHandlers();
  }

  _markActive(index) {
    this._thumbsHelper.markActive(index);
  }

  _ensureThumbVisible(index) {
    this._thumbsHelper.ensureThumbVisible(index);
  }

  _ensureThumbScroll() {
    this._thumbsHelper.ensureThumbScroll();
  }

  /* ================== SWIPE: делегаты ================== */

  _bindPointerSwipe() {
    this._swipeHelper.bindPointerSwipe();
  }

  _applyDragTransforms(dx, tmpEl, width) {
    this._swipeHelper.applyDragTransforms(dx, tmpEl, width);
  }

  _animateDragRollback() {
    this._swipeHelper.animateDragRollback();
  }

  _animateDragToComplete(sign, targetIdx, dx, width) {
    this._swipeHelper.animateDragToComplete(sign, targetIdx, dx, width);
  }

  _getTranslateXValue(el) {
    return this._swipeHelper.getTranslateXValue(el);
  }

  /* ================== ПРОЧЕЕ (анимации, модалка, события) ================== */

  _simpleSwap(src, index, item) {
    if (!this.mainImg) return;
    this.mainImg.classList.add('is-loading');
    const onLoad = () => {
      this.mainImg.classList.remove('is-loading');
      this._emit('gallery:loaded', { index, src });
    };
    const onError = () => {
      this.mainImg.classList.remove('is-loading');
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
    tmp.decoding  = 'async';
    tmp.loading   = 'eager';
    tmp.alt       = item.alt || '';
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
    this.mainImg.style.transition =
      `transform ${this._animDuration}ms ease, opacity ${Math.floor(this._animDuration / 2)}ms ease`;
    this.mainImg.style.transform = 'translateX(0)';
    this.mainImg.style.opacity   = '1';

    this.mainFrame.appendChild(tmp);

    const cleanup = () => {
      if (tmp.parentNode) tmp.parentNode.removeChild(tmp);
      this.mainImg.style.transition = '';
      this.mainImg.style.transform  = 'translateX(0)';
      this.mainImg.style.opacity    = '1';
      this.mainImg.src = src;
      this.mainImg.dataset.index = String(index);
      this.mainImg.alt = item.alt || '';
      this.mainImg.classList.remove('is-loading');
      this._emit('gallery:loaded', { index, src });
      this._animating = false;
      this._tmpImage  = null;
    };

    const handleLoad = () => {
      tmp.removeEventListener('load', handleLoad);
      tmp.offsetHeight;
      requestAnimationFrame(() => {
        const mainTarget = direction === 'right' ? -100 : 100;
        this.mainImg.style.transform = `translateX(${mainTarget}%)`;
        this.mainImg.style.opacity   = '0';
        tmp.style.transform          = 'translateX(0%)';
      });
      const onTransEnd = (e) => {
        if (e && e.target !== tmp) return;
        tmp.removeEventListener('transitionend', onTransEnd);
        cleanup();
      };
      tmp.addEventListener('transitionend', onTransEnd);
      setTimeout(() => {
        if (!this._animating) return;
        try { tmp.removeEventListener('transitionend', onTransEnd); } catch {}
        cleanup();
      }, this._animDuration + 70);
    };

    const handleError = () => {
      if (tmp.parentNode) tmp.parentNode.removeChild(tmp);
      this.mainImg.classList.remove('is-loading');
      if (this.options.placeholder) this.mainImg.src = this.options.placeholder;
      this._emit('gallery:error', { index, src });
      this._animating = false;
      this._tmpImage  = null;
    };

    tmp.addEventListener('load', handleLoad, { once: true });
    tmp.addEventListener('error', handleError, { once: true });
    tmp.src = src;
  }

  _getDirection(prev, index) {
    const n = this.images.length;
    if (!Number.isFinite(prev) || prev < 0 || prev === index || n <= 1) return 'none';
    if (!this.options.circular) return index > prev ? 'right' : 'left';
    const forward  = (index - prev + n) % n;
    const backward = (prev - index + n) % n;
    return forward <= backward ? 'right' : 'left';
  }

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

      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = this.options.navPrevClass;
      prevBtn.setAttribute('aria-label', 'Предыдущее изображение');
      prevBtn.innerHTML = '<i class="fa fa-chevron-left" aria-hidden="true"></i>';

      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = this.options.navNextClass;
      nextBtn.setAttribute('aria-label', 'Следующее изображение');
      nextBtn.innerHTML = '<i class="fa fa-chevron-right" aria-hidden="true"></i>';

      wrap.appendChild(prevBtn);
      wrap.appendChild(nextBtn);
      modalContent.appendChild(wrap);

      this._navWrap = wrap;
      this._navPrev = prevBtn;
      this._navNext = nextBtn;

      this._addListener(prevBtn, 'click', (e) => { e.preventDefault(); this.prev(); });
      this._addListener(nextBtn, 'click', (e) => { e.preventDefault(); this.next(); });
      this._addListener(prevBtn, 'keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.prev(); }
      });
      this._addListener(nextBtn, 'keydown', (e) => {
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
    if (e.key === 'ArrowLeft')  this.prev();
  }

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
    try { rec.el.removeEventListener(rec.evt, rec.fn, rec.opts); } catch {}
    this._listeners.delete(id);
  }

  _removeAllListeners() {
    for (const id of this._listeners.keys()) {
      this._removeListener(id);
    }
  }

  _emit(name, detail = {}) {
    try {
      this.root.dispatchEvent(new CustomEvent(name, { detail }));
    } catch {}
  }

  _clampIndex(idx) {
    const n = this.images.length;
    if (!n) return 0;
    if (this.options.circular) return ((idx % n) + n) % n;
    return Math.max(0, Math.min(idx, n - 1));
  }
}
