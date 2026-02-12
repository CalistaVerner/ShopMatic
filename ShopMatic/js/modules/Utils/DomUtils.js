/**
 * @author Calista Verner
 */

export class DomUtils {
  /**
   * Safe querySelector.
   * @param {ParentNode|Element|null|undefined} root
   * @param {string} selector
   * @returns {Element|null}
   */
  static qs(root, selector) {
    try {
      return root?.querySelector?.(selector) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Safe closest.
   * @param {Element|null|undefined} el
   * @param {string} selector
   * @returns {Element|null}
   */
  static closest(el, selector) {
    try {
      return el?.closest?.(selector) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Toggle element visibility via display.
   * @param {Element|null} el
   * @param {boolean} visible
   */
  static setVisible(el, visible) {
    if (!el) return;
    el.style.display = visible ? '' : 'none';
  }

  /**
   * Set aria-disabled and disabled when supported.
   * @param {Element|null} el
   * @param {boolean} disabled
   */
  static setDisabled(el, disabled) {
    if (!el) return;
    try {
      if ('disabled' in el) el.disabled = !!disabled;
    } catch {}
    try {
      if (disabled) el.setAttribute('aria-disabled', 'true');
      else el.removeAttribute('aria-disabled');
    } catch {}
  }

  /**
   * Set textContent only if changed (avoids layout thrash).
   * @param {Element|null} el
   * @param {string} text
   */
  static setTextIfChanged(el, text) {
    if (!el) return;
    const next = String(text ?? '');
    if ((el.textContent ?? '') !== next) el.textContent = next;
  }

  /**
   * Toggle hidden/display in a consistent way.
   * @param {Element|null} el
   * @param {boolean} hidden
   */
  static setHidden(el, hidden) {
    if (!el) return;
    try { el.hidden = !!hidden; } catch {}
    DomUtils.setVisible(el, !hidden);
  }

  /**
   * Fade (and optionally collapse) an element, then hide it.
   * Idempotent: multiple calls won't stack transitions.
   *
   * @param {Element|null} el
   * @param {{duration?: number, collapse?: boolean, remove?: boolean}} opts
   */
  static fadeOutAndHide(el, opts = {}) {
    if (!el) return;
    const duration = Number.isFinite(Number(opts.duration)) ? Number(opts.duration) : 220;
    const collapse = opts.collapse !== false;
    const remove = !!opts.remove;

    try {
      if (el.dataset && el.dataset.smRemoving === '1') return;
      if (el.dataset) el.dataset.smRemoving = '1';
    } catch {}

    // Ensure measurable
    let h = 0;
    try { h = Math.max(0, el.getBoundingClientRect().height || 0); } catch { h = 0; }

    try { el.classList.add('sm-row-removing'); } catch {}
    try { el.style.willChange = 'opacity, transform, max-height'; } catch {}
    try { el.style.overflow = 'hidden'; } catch {}

    if (collapse) {
      try { el.style.maxHeight = (h ? `${h}px` : '999px'); } catch {}
      // keep margins/paddings until we animate
      try { el.style.marginTop = el.style.marginTop || ''; } catch {}
    }

    // Apply transition
    try {
      const t = [
        `opacity ${duration}ms ease`,
        `transform ${duration}ms ease`,
        collapse ? `max-height ${duration}ms ease` : null,
        collapse ? `margin ${duration}ms ease` : null,
        collapse ? `padding ${duration}ms ease` : null
      ].filter(Boolean).join(', ');
      el.style.transition = t;
    } catch {}

    // Next frame -> animate to final
    requestAnimationFrame(() => {
      try { el.style.opacity = '0'; } catch {}
      try { el.style.transform = 'translateY(-4px)'; } catch {}
      if (collapse) {
        try { el.style.maxHeight = '0px'; } catch {}
        try { el.style.paddingTop = '0px'; el.style.paddingBottom = '0px'; } catch {}
        try { el.style.marginTop = '0px'; el.style.marginBottom = '0px'; } catch {}
      }
    });

    const done = () => {
      try {
        if (remove && el.parentNode) el.parentNode.removeChild(el);
        else {
          try { el.hidden = true; } catch {}
          DomUtils.setVisible(el, false);
        }
      } catch {}
    };

    // transitionend can be flaky if element is replaced; timeout is the safety net
    let settled = false;
    const settle = () => { if (settled) return; settled = true; cleanup(); done(); };
    const onEnd = (e) => {
      // Wait for max-height/opacity; any transition end is fine as we guard with settled
      settle();
    };
    const cleanup = () => {
      try { el.removeEventListener('transitionend', onEnd); } catch {}
      try { if (el.dataset) delete el.dataset.smRemoving; } catch {}
      try { el.classList.remove('sm-row-removing'); } catch {}
      try { el.style.willChange = ''; } catch {}
      // keep transition/styles for hidden nodes; restoreRow() will clean them
    };

    try { el.addEventListener('transitionend', onEnd, { once: true }); } catch {}
    setTimeout(settle, duration + 60);
  }

}
