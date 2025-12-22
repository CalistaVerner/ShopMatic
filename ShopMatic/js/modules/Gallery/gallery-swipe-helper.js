// gallery-swipe-helper.js
export class GallerySwipeHelper {
  /**
   * @param {import('./gallery.js').Gallery} gallery
   */
  constructor(gallery) {
    this.gallery = gallery;
  }

  /** Привязка pointer/touch-свайпов к mainFrame */
  bindPointerSwipe() {
    const g = this.gallery;
    if (!g.mainFrame) return;

    const down = (e) => {
      if (e.button && e.button !== 0) return;
      if (g._animating) return;
      if (e.target.closest && e.target.closest('button, a, input, textarea, select')) return;

      g._drag.active = true;
      g._drag.pointerId = e.pointerId ?? 'touch';
      g._drag.startX = e.clientX;
      g._drag.startY = e.clientY;
      g._drag.lastDX = 0;
      g._drag.targetIndex = null;
      g._drag.direction = null;
      g._drag.moved = false;

      try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch {}
      document.body.style.userSelect = 'none';
    };

    const move = (e) => {
      if (!g._drag.active || (e.pointerId !== undefined && e.pointerId !== g._drag.pointerId)) return;

      const dx = e.clientX - g._drag.startX;
      const dy = e.clientY - g._drag.startY;

      if (!g._drag.moved && Math.abs(dx) > 6) g._drag.moved = true;
      if (!g._drag.direction && Math.abs(dx) > 6) {
        g._drag.direction = dx < 0 ? 'left' : 'right';
      }

      g._drag.lastDX = dx;

      const width = g.mainFrame.clientWidth || g.mainImg?.clientWidth || (window.innerWidth / 2);
      const sign  = dx < 0 ? -1 : 1;
      const targetIdx = g._clampIndex(g.current + (sign < 0 ? 1 : -1));

      if (g.images.length <= 1 || targetIdx === g.current) {
        const damp = dx * 0.35;
        this.applyDragTransforms(damp, null, width);
        return;
      }

      if (g._drag.targetIndex !== targetIdx || !g._tmpImage) {
        if (g._tmpImage?.parentNode) {
          try { g._tmpImage.parentNode.removeChild(g._tmpImage); } catch {}
        }
        const tmp = document.createElement('img');
        g._tmpImage = tmp;
        tmp.decoding = 'async';
        tmp.loading = 'eager';
        tmp.draggable = false;
        Object.assign(tmp.style, {
          position: 'absolute',
          top: '0',
          left: '0',
          width: '100%',
          height: '100%',
          objectFit: g.mainImg?.style.objectFit || 'contain',
          transition: 'none',
          zIndex: '2',
          willChange: 'transform, opacity'
        });
        const initialOffset = sign < 0 ? width : -width;
        tmp.style.transform = `translateX(${initialOffset}px)`;
        g.mainFrame.appendChild(tmp);
        const candidate = g.images[targetIdx];
        if (candidate?.src) tmp.src = candidate.src;
        g._drag.targetIndex = targetIdx;
      }

      this.applyDragTransforms(dx, g._tmpImage, width);
      if (Math.abs(dx) > 8) e.preventDefault?.();
    };

    const up = (e) => {
      if (!g._drag.active || (e && e.pointerId !== undefined && e.pointerId !== g._drag.pointerId)) return;

      const dx = g._drag.lastDX;
      const abs = Math.abs(dx);
      const width = g.mainFrame.clientWidth || g.mainImg?.clientWidth || (window.innerWidth / 2);

      try { e.currentTarget?.releasePointerCapture?.(e.pointerId); } catch {}
      document.body.style.userSelect = '';

      if (g._drag.moved) {
        g._suppressClick = true;
        clearTimeout(g._suppressClickTimer);
        g._suppressClickTimer = setTimeout(() => {
          g._suppressClick = false;
          g._suppressClickTimer = null;
        }, g._clickSuppressMs);
      }

      const sign      = dx < 0 ? -1 : 1;
      const targetIdx = g._drag.targetIndex != null ? g._drag.targetIndex : g._clampIndex(g.current + (sign < 0 ? 1 : -1));
      const threshold = Math.min(g.options.swipeThreshold, Math.round(width * 0.18));

      if (g.images.length > 1 && abs > threshold && targetIdx !== g.current) {
        this.animateDragToComplete(sign, targetIdx, dx, width);
      } else {
        this.animateDragRollback();
      }

      g._drag.active = false;
      g._drag.pointerId   = null;
      g._drag.lastDX      = 0;
      g._drag.targetIndex = null;
      g._drag.direction   = null;
      g._drag.moved       = false;
    };

    const cancel = (e) => {
      if (!g._drag.active) return;
      try { e.currentTarget?.releasePointerCapture?.(e.pointerId); } catch {}
      document.body.style.userSelect = '';
      g._drag.active      = false;
      g._drag.pointerId   = null;
      g._drag.direction   = null;
      g._drag.targetIndex = null;
      g._drag.moved       = false;
      this.animateDragRollback();
    };

    g._pointerHandlers.down   = down;
    g._pointerHandlers.move   = move;
    g._pointerHandlers.up     = up;
    g._pointerHandlers.cancel = cancel;

    g._addListener(g.mainFrame, 'pointerdown', down);
    g._addListener(g.mainFrame, 'pointermove', move);
    g._addListener(g.mainFrame, 'pointerup', up);
    g._addListener(g.mainFrame, 'pointercancel', cancel);

    // touch fallback
    const touchStart = (e) => {
      const t = e.touches?.[0];
      if (!t) return;
      down({
        pointerId: 'touch',
        clientX: t.clientX,
        clientY: t.clientY,
        currentTarget: g.mainFrame,
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
        currentTarget: g.mainFrame,
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
        currentTarget: g.mainFrame,
        target: e.target
      });
    };

    g._addListener(g.mainFrame, 'touchstart', touchStart, { passive: true });
    g._addListener(g.mainFrame, 'touchmove',  touchMove,  { passive: false });
    g._addListener(g.mainFrame, 'touchend',   touchEnd,   { passive: true });
  }

  /** Применить трансформации при перетаскивании */
  applyDragTransforms(dx, tmpEl, width) {
    const g = this.gallery;
    if (!g.mainImg) return;
    const maxOffset = width * 0.6;
    const limited   = Math.abs(dx) > maxOffset ? maxOffset * Math.sign(dx) : dx;

    g.mainImg.style.transition = 'none';
    g.mainImg.style.transform  = `translateX(${limited}px)`;
    g.mainImg.style.opacity    = String(
      Math.max(0.35, 1 - Math.abs(limited) / (width * 1.2))
    );

    if (!tmpEl) return;

    tmpEl.style.transition = 'none';
    const sign       = limited < 0 ? 1 : -1;
    const baseOffset = sign > 0 ? width : -width;
    tmpEl.style.transform = `translateX(${baseOffset + limited}px)`;
    tmpEl.style.opacity   = '1';
  }

  /** Откат анимации свайпа назад */
  animateDragRollback() {
    const g = this.gallery;
    if (!g.mainImg) return;

    const dur   = Math.round(g._animDuration / 1.5);
    const opDur = Math.round(g._animDuration / 2);

    g.mainImg.style.transition = `transform ${dur}ms ease, opacity ${opDur}ms ease`;
    g.mainImg.style.transform  = 'translateX(0)';
    g.mainImg.style.opacity    = '1';

    const tmp = g._tmpImage;
    if (!tmp) return;

    const width = this.getFrameWidth();
    const cur   = this.getTranslateXValue(tmp);
    const sign  = cur >= 0 ? 1 : -1;
    const final = sign > 0 ? width : -width;

    tmp.style.transition = `transform ${dur}ms ease, opacity ${opDur}ms ease`;
    tmp.style.transform  = `translateX(${final}px)`;
    tmp.style.opacity    = '0';

    const cleanup = () => {
      this.cleanupTmpImage();
      this.resetMainImg();
    };

    const onEnd = () => {
      tmp.removeEventListener('transitionend', onEnd);
      cleanup();
    };

    tmp.addEventListener('transitionend', onEnd);
    setTimeout(cleanup, dur + 120);
  }

  /** Завершение свайпа переходом к следующей/предыдущей картинке */
  animateDragToComplete(sign, targetIdx, dx, width) {
    const g = this.gallery;
    if (!g.mainImg || g._animating) return;

    g._animating = true;
    const tmp = g._tmpImage;
    const dur   = Math.round(g._animDuration * 0.9);
    const opDur = Math.round(dur / 2);

    g.mainImg.style.transition =
      `transform ${dur}ms cubic-bezier(.2,.9,.2,1), opacity ${opDur}ms ease`;
    const frameWidth = this.getFrameWidth();
    g.mainImg.style.transform  = `translateX(${sign < 0 ? -frameWidth : frameWidth}px)`;
    g.mainImg.style.opacity    = '0';

    if (tmp) {
      tmp.style.transition =
        `transform ${dur}ms cubic-bezier(.2,.9,.2,1), opacity ${opDur}ms ease`;
      tmp.style.transform  = 'translateX(0px)';
      tmp.style.opacity    = '1';
    }

    const finish = () => {
      this.cleanupTmpImage();
      const item = g.images[targetIdx];
      if (item?.src) {
        g.mainImg.src = item.src;
        g.mainImg.dataset.index = String(targetIdx);
        g.mainImg.alt = item.alt || '';
      }
      this.resetMainImg();

      g._prevIndex = g.current;
      g.current    = targetIdx;
      g._animating = false;

      g._emit('gallery:change', {
        index: g.current,
        src: g.mainImg.src,
        item: g.images[g.current]
      });
      g._emit('gallery:loaded', {
        index: g.current,
        src: g.mainImg.src
      });

      g._thumbsHelper.markActive(g.current);
      g._thumbsHelper.ensureThumbVisible(g.current);
    };

    let handled = false;
    const onEnd = () => {
      if (handled) return;
      handled = true;
      g.mainImg.removeEventListener('transitionend', onEnd);
      finish();
    };

    g.mainImg.addEventListener('transitionend', onEnd);
    setTimeout(() => {
      if (handled) return;
      handled = true;
      try { g.mainImg.removeEventListener('transitionend', onEnd); } catch {}
      finish();
    }, dur + 150);
  }

  /** Ширина фрейма для анимаций */
  getFrameWidth() {
    const g = this.gallery;
    return g.mainFrame?.clientWidth || g.mainImg?.clientWidth || window.innerWidth || 0;
  }

  /** Получить translateX из transform */
  getTranslateXValue(el) {
    try {
      const s = getComputedStyle(el).transform;
      if (!s || s === 'none') return 0;
      const m = s.match(/matrix\(([^\)]+)\)/);
      if (m) {
        const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
        return parts[4] || 0;
      }
      const m3 = s.match(/matrix3d\(([^\)]+)\)/);
      if (m3) {
        const parts = m3[1].split(',').map((p) => parseFloat(p.trim()));
        return parts[12] || 0;
      }
    } catch {
      // ignore
    }
    return 0;
  }

  /** Удалить временную картинку */
  cleanupTmpImage() {
    const g = this.gallery;
    if (g._tmpImage?.parentNode) {
      try { g._tmpImage.parentNode.removeChild(g._tmpImage); } catch {}
    }
    g._tmpImage = null;
  }

  /** Сброс стилей mainImg после анимации */
  resetMainImg() {
    const g = this.gallery;
    if (!g.mainImg) return;
    g.mainImg.style.transition = '';
    g.mainImg.style.transform  = 'translateX(0)';
    g.mainImg.style.opacity    = '1';
  }
}
