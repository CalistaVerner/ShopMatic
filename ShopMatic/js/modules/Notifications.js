// shopmatic/Notifications.js
import { escapeHtml } from './utils.js';

/**
 * Удобный и безопасный менеджер уведомлений.
 * - поддерживает типы: 'info' | 'success' | 'error' | 'warning'
 * - по умолчанию блокирует HTML (opts.allowHtml = false) — используйте allowHtml=true только для доверенного HTML
 * - пауза таймера при наведении, клик для закрытия, кнопка закрытия
 * - возвращает объект { id, dismiss, promise }
 */
export class Notifications {
  constructor(opts = {}) {
    this.opts = Object.assign({
      duration: 3000,
      position: { right: 20, bottom: 20 }, // px
      maxVisible: 5,
      pauseOnHover: true,
      dismissible: true,
      allowHtml: false,
      containerClass: 'shop-notifications',
      notificationClass: 'shop-notification',
      ariaLive: 'polite' // or 'assertive' for critical messages
    }, opts);

    this._container = null;
    this._idCounter = 1;
    this._timers = new Map(); // id -> timeoutId
    this._resolvers = new Map(); // id -> resolver (for promise)
    this._injectBaseStyles();
  }

  /* ===== Public API ===== */

  /**
   * Show notification.
   * message: string | Node (if allowHtml true you can pass HTML string, otherwise will be escaped / treated as text)
   * opts: { duration, type, allowHtml, dismissible, onClose, ariaLive, className }
   * Returns { id, dismiss: fn, promise }
   */
  show(message, opts = {}) {
    if (!message) return null;
    const cfg = Object.assign({}, this.opts, opts);
    const id = `notif_${this._idCounter++}`;

    const container = this._ensureContainer(cfg);
    // enforce maxVisible
    this._enforceMaxVisible(container, cfg.maxVisible);

    // create node
    const note = document.createElement('div');
    note.className = `${cfg.notificationClass} ${cfg.notificationClass}--${cfg.type || 'info'}`.trim();
    note.setAttribute('data-notification-id', id);
    note.tabIndex = 0; // make focusable for accessibility
    note.style.pointerEvents = 'auto';
    note.setAttribute('role', (cfg.type === 'error' || cfg.ariaLive === 'assertive') ? 'alert' : 'status');
    note.setAttribute('aria-live', opts.ariaLive ?? cfg.ariaLive);
    note.setAttribute('aria-atomic', 'true');

    // ICON: mapping by type
    const ICONS = {
      success: 'fa-solid fa-check success',
      warning: 'fa-solid fa-triangle-exclamation warning',
      error: 'fa-solid fa-hexagon-exclamation error',
      info: 'fa-solid fa-info info'
    };
    const typeKey = (cfg.type && String(cfg.type)) ? String(cfg.type) : 'info';
    const iconClass = ICONS[typeKey] || ICONS.info;
    const iconEl = document.createElement('i');
    iconEl.className = `${iconClass} ${cfg.notificationClass}__icon notif-icon notif-icon--${typeKey}`;
    iconEl.setAttribute('aria-hidden', 'true');

    // content wrapper (safe insertion)
    const content = document.createElement('div');
    content.className = `${cfg.notificationClass}__content`;

    if (message instanceof Node) {
      content.appendChild(message);
    } else {
      // If allowHtml flagged — we accept provided HTML (trustworthy), otherwise insert as textContent
      if (cfg.allowHtml || opts.allowHtml) {
        // trusted HTML path
        content.innerHTML = String(message);
      } else {
        // safe text path
        content.textContent = String(message);
      }
    }

    // assemble note: icon + content
    note.appendChild(iconEl);
    note.appendChild(content);

    // close button
    if (cfg.dismissible) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `${cfg.notificationClass}__close`;
      btn.setAttribute('aria-label', 'Закрыть уведомление');
      btn.innerHTML = '&times;';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismiss();
      });
      note.appendChild(btn);
    }

    // mouse hover pause/resume
    let remainingDuration = Number(cfg.duration) || 0;
    let startTs = Date.now();
    let timeoutId = null;
    const clearTimer = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (this._timers.has(id)) this._timers.delete(id);
    };
    const startTimer = (dur) => {
      clearTimer();
      if (dur <= 0) return;
      startTs = Date.now();
      timeoutId = setTimeout(() => {
        performRemove();
      }, dur);
      this._timers.set(id, timeoutId);
    };

    const pauseTimer = () => {
      if (!cfg.pauseOnHover) return;
      if (!timeoutId) return;
      const elapsed = Date.now() - startTs;
      remainingDuration = Math.max(0, remainingDuration - elapsed);
      clearTimer();
    };

    const resumeTimer = () => {
      if (!cfg.pauseOnHover) return;
      startTimer(remainingDuration);
    };

    // animations: show
    note.classList.add('is-entering');
    container.appendChild(note);
    // force reflow then remove entering class to play CSS transition
    requestAnimationFrame(() => {
      note.classList.remove('is-entering');
      note.classList.add('is-visible');
    });

    // perform remove with animation
    const performRemove = (reason = 'timeout') => {
      if (!note.parentNode) return resolveAndCleanup();
      // animate out
      note.classList.remove('is-visible');
      note.classList.add('is-leaving');
      // clear timer map
      clearTimer();
      setTimeout(() => {
        if (note && note.parentNode) note.parentNode.removeChild(note);
        resolveAndCleanup(reason);
      }, 320); // matches CSS transition
    };

    const resolveAndCleanup = (reason = 'dismissed') => {
      const resolver = this._resolvers.get(id);
      if (resolver) {
        try { resolver({ id, reason }); } catch (e) {}
      }
      this._resolvers.delete(id);
      const t = this._timers.get(id);
      if (t) { clearTimeout(t); this._timers.delete(id); }
      // user-provided onClose
      if (typeof cfg.onClose === 'function') {
        try { cfg.onClose({ id, reason }); } catch (e) {}
      }
    };

    // expose dismiss() and promise
    const promise = new Promise((resolve) => {
      this._resolvers.set(id, resolve);
    });

    const dismiss = (reason = 'manual') => performRemove(reason);

    // mouse interactions
    if (cfg.pauseOnHover) {
      note.addEventListener('mouseenter', pauseTimer);
      note.addEventListener('mouseleave', resumeTimer);
    }
    // keyboard: Enter or Escape to dismiss
    note.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' || ev.key === 'Esc') {
        ev.preventDefault();
        dismiss('keyboard');
      } else if (ev.key === 'Enter') {
        // optional: Enter can also dismiss (disabled by default)
        // ev.preventDefault();
        // dismiss('keyboard');
      }
    });

    // initial timer start (unless duration <= 0 -> sticky)
    remainingDuration = Number(cfg.duration) || 0;
    if (remainingDuration > 0) startTimer(remainingDuration);

    // return control
    return { id, dismiss, promise };
  }

  /**
   * Clear all notifications immediately (animated).
   */
  clearAll() {
    if (!this._container) return;
    const notes = Array.from(this._container.querySelectorAll(`.${this.opts.notificationClass}`));
    notes.forEach(n => {
      const id = n.getAttribute('data-notification-id');
      // remove with same animation as dismiss
      n.classList.remove('is-visible');
      n.classList.add('is-leaving');
      setTimeout(() => { if (n.parentNode) n.parentNode.removeChild(n); }, 320);
      // resolve promises
      const resolver = this._resolvers.get(id);
      if (resolver) {
        try { resolver({ id, reason: 'cleared' }); } catch (e) {}
        this._resolvers.delete(id);
      }
      const t = this._timers.get(id);
      if (t) { clearTimeout(t); this._timers.delete(id); }
    });
  }

  /* ===== Internal helpers ===== */

  _ensureContainer(cfg = {}) {
    if (this._container) return this._container;
    const cont = document.createElement('div');
    cont.className = cfg.containerClass || this.opts.containerClass;
    document.body.appendChild(cont);
    this._container = cont;
    return cont;
  }

  _enforceMaxVisible(container, max) {
    try {
      const nodes = container.querySelectorAll(`.${this.opts.notificationClass}`);
      const overflow = nodes.length - (max - 1); // -1 because we're about to add new
      if (overflow > 0) {
        // remove oldest
        const toRemove = Array.from(nodes).slice(0, overflow);
        toRemove.forEach(n => {
          n.classList.remove('is-visible');
          n.classList.add('is-leaving');
          setTimeout(() => { if (n.parentNode) n.parentNode.removeChild(n); }, 320);
          const id = n.getAttribute('data-notification-id');
          const resolver = this._resolvers.get(id);
          if (resolver) { try { resolver({ id, reason: 'evicted' }); } catch (e) {} }
          this._resolvers.delete(id);
        });
      }
    } catch (e) { /* ignore */ }
  }

  _injectBaseStyles() {
    if (document.getElementById('shopmatic-notif-styles')) return;
    const css = `
      .${this.opts.notificationClass} {
        pointer-events: auto;
        background: #323232;
        color: white;
        padding: 12px 14px;
        border-radius: 10px;
        box-shadow: 0 8px 20px rgba(0,0,0,0.25);
        transform-origin: 100% 100%;
        transform: translateY(12px) scale(.995);
        opacity: 0;
        transition: transform .28s cubic-bezier(.2,.9,.2,1), opacity .28s ease;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 10px;
        line-height: 1.2;
        max-width: 100%;
      }
      .${this.opts.notificationClass}.is-visible { transform: translateY(0) scale(1); opacity: 1; }
      .${this.opts.notificationClass}.is-entering { transform: translateY(20px) scale(.98); opacity: 0; }
      .${this.opts.notificationClass}.is-leaving { transform: translateY(12px) scale(.98); opacity: 0; }

      /* icon + content layout */
      .${this.opts.notificationClass}__icon {
        flex: 0 0 auto;
        font-size: 18px;
        width: 22px;
        height: 22px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .${this.opts.notificationClass}__content {
		  color:#ffffff;
        flex: 1 1 auto;
        min-width: 0;
      }

      .${this.opts.notificationClass}__close {
        margin-left: 8px;
        background: transparent;
        border: 0;
        color: rgba(255,255,255,0.85);
        font-size: 18px;
        cursor: pointer;
        padding: 4px;
        line-height: 1;
        border-radius: 6px;
      }
      .${this.opts.notificationClass}__close:focus { outline: 2px solid rgba(255,255,255,0.14); }

      /* variants */
      .${this.opts.notificationClass}--success { background: linear-gradient(180deg,#2e7d32,#1b5e20); }
      .${this.opts.notificationClass}--error { background: linear-gradient(180deg,#c62828,#8e0000); }
      .${this.opts.notificationClass}--warning { background: linear-gradient(180deg,#ff9800,#f57c00); color: #111; }
      .${this.opts.notificationClass}--info { background: linear-gradient(180deg,#1976d2,#115293); }

      /* ensure container children can receive pointer events */
      .${this.opts.containerClass} > * { pointer-events: auto; }
    `;
    const style = document.createElement('style');
    style.id = 'shopmatic-notif-styles';
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }
}
