/*
 * shopmatic/NotificationsOptimized.js
 *
 * Notifications manager for ShopMatic with CyberLife style and
 * built-in progress bar.
 *
 * Author: Calista Verner (OO-refactor by assistant)
 * Version: 2.1.0 (API-compatible with 1.4.0)
 * License: MIT
 */

const ICONS_BY_TYPE = Object.freeze({
  success: 'fa-solid fa-check',
  warning: 'fa-solid fa-triangle-exclamation',
  error:   'fa-solid fa-hexagon-exclamation',
  info:    'fa-solid fa-info'
});

class NotificationInstance {
  constructor(manager, id, message, cfg, container) {
    this.manager   = manager;
    this.id        = id;
    this.cfg       = cfg;
    this.container = container;
    this.message   = message;

    this.node        = null;
    this.progressEl  = null;
    this.timeoutId   = null;
    this.remainingMs = Math.max(0, Number(cfg.duration) || 0);
    this.startTs     = 0;
    this.dismissed   = false;
    this.createdAt   = Date.now();

    this._swipe = {
      active: false,
      pointerId: null,
      startX: 0,
      lastX: 0,
      dragging: false,
      axis: null
    };

    this.promise = new Promise((resolve) => {
      this._resolve = resolve;
    });

    this._buildNode();
    this._wireInteractions();
    this._mount();
  }

  dismiss(reason = this.manager._msg('REASON_MANUAL')) {
    if (this.dismissed) return;
    this.dismissed = true;
    this._clearTimer();
    this._animateOut(reason);
  }

  _buildNode() {
    const { cfg, manager, id } = this;

    const note = document.createElement('div');
    note.className =
      `${cfg.notificationClass} ${cfg.notificationClass}--${cfg.type || 'info'}`.trim();
    note.dataset.notificationId = id;
    note.tabIndex = 0;
    note.style.pointerEvents = 'auto';
    note.style.touchAction = cfg.swipeToDismiss ? 'pan-y' : '';

    const typeKey   = cfg.type || 'info';
    const iconClass = ICONS_BY_TYPE[typeKey] || ICONS_BY_TYPE.info;

    const iconEl = document.createElement('i');
    iconEl.className =
      `${iconClass} ${cfg.notificationClass}__icon notif-icon notif-icon--${typeKey}`;
    iconEl.setAttribute('aria-hidden', 'true');

    const content = document.createElement('div');
    content.className = `${cfg.notificationClass}__content`;

    if (this.message instanceof Node) {
      content.appendChild(this.message);
    } else if (cfg.allowHtml) {
      content.innerHTML = String(this.message);
    } else {
      content.textContent = String(this.message);
    }

    note.appendChild(iconEl);
    note.appendChild(content);

    if (cfg.dismissible) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `${cfg.notificationClass}__close`;
      btn.setAttribute('aria-label', manager._msg('CLOSE_BUTTON_LABEL'));
      btn.innerHTML = '&times;';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismiss(manager._msg('REASON_MANUAL'));
      });
      note.appendChild(btn);
    }

    if (cfg.showProgressBar) {
      const progress = document.createElement('div');
      progress.className = `${cfg.notificationClass}__progress`;
      note.appendChild(progress);
      this.progressEl = progress;
    }

    this.node = note;
  }

  _wireInteractions() {
    const { node, cfg } = this;
    if (!node) return;

    if (cfg.pauseOnHover) {
      node.addEventListener('mouseenter', () => this._pauseTimer());
      node.addEventListener('mouseleave', () => this._resumeTimer());
    }

    node.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.dismiss(this.manager._msg('REASON_KEYBOARD'));
      }
    });

    if (cfg.swipeToDismiss) this._wireSwipe();
  }

  _wireSwipe() {
    const node = this.node;
    const threshold = this.cfg.swipeThresholdPx || 64;

    const reset = () => {
      node.style.transition = '';
      node.style.transform = '';
      node.style.opacity = '';
    };

    node.addEventListener('pointerdown', (ev) => {
      if (this.dismissed || !this.cfg.dismissible) return;
      if (ev.pointerType === 'mouse' && !this.cfg.swipeAllowMouse) return;

      this._swipe.active = true;
      this._swipe.pointerId = ev.pointerId;
      this._swipe.startX = ev.clientX;
      this._swipe.lastX = ev.clientX;
      this._swipe.dragging = false;
      this._swipe.axis = null;

      try { node.setPointerCapture(ev.pointerId); } catch {}
    });

    node.addEventListener('pointermove', (ev) => {
      if (!this._swipe.active || ev.pointerId !== this._swipe.pointerId) return;

      const dx = ev.clientX - this._swipe.startX;
      this._swipe.lastX = ev.clientX;

      if (!this._swipe.axis) {
        this._swipe.axis = 'x';
        this._pauseTimer();
      }

      this._swipe.dragging = true;

      node.style.transition = 'none';
      node.style.transform = `translateX(${dx}px)`;
      node.style.opacity = String(Math.max(0.4, 1 - Math.abs(dx) / 200));

      ev.preventDefault();
    });

    const finish = (ev) => {
      if (!this._swipe.active || ev.pointerId !== this._swipe.pointerId) return;

      const dx = this._swipe.lastX - this._swipe.startX;
      const abs = Math.abs(dx);

      this._swipe.active = false;
      try { node.releasePointerCapture(ev.pointerId); } catch {}

      if (!this._swipe.dragging) {
        this._resumeTimer();
        return;
      }

      if (abs >= threshold) {
        const dir = dx >= 0 ? 1 : -1;
        node.style.transition = 'transform 180ms ease, opacity 180ms ease';
        node.style.transform = `translateX(${dir * (window.innerWidth || 600)}px)`;
        node.style.opacity = '0';

        setTimeout(() => {
          this.dismiss(this.manager._msg('REASON_SWIPE'));
        }, 180);

        return;
      }

      node.style.transition = 'transform 180ms ease, opacity 180ms ease';
      node.style.transform = 'translateX(0)';
      node.style.opacity = '1';

      setTimeout(reset, 200);
      this._resumeTimer();
    };

    node.addEventListener('pointerup', finish);
    node.addEventListener('pointercancel', finish);
  }

  _mount() {
    const { node, container } = this;
    node.classList.add('is-entering');
    container.appendChild(node);

    requestAnimationFrame(() => {
      node.classList.remove('is-entering');
      node.classList.add('is-visible');

      if (this.progressEl && this.remainingMs > 0) {
        this._startProgressBar();
      }
    });

    if (this.remainingMs > 0) {
      this._startTimer(this.remainingMs);
    }
  }

  _startTimer(duration) {
    this._clearTimer();
    if (duration <= 0) return;
    this.startTs = Date.now();
    this.remainingMs = duration;
    this.timeoutId = setTimeout(() => {
      this.dismiss(this.manager._msg('REASON_TIMEOUT'));
    }, duration);
  }

  _clearTimer() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  _pauseTimer() {
    if (!this.timeoutId) return;
    const elapsed = Date.now() - this.startTs;
    this.remainingMs = Math.max(0, this.remainingMs - elapsed);
    this._clearTimer();
  }

  _resumeTimer() {
    if (this.remainingMs > 0) {
      this._startTimer(this.remainingMs);
    }
  }

  _startProgressBar() {
    const bar = this.progressEl;
    bar.style.transition = 'none';
    bar.style.width = '100%';
    requestAnimationFrame(() => {
      bar.style.transition = `width ${this.remainingMs}ms linear`;
      bar.style.width = '0%';
    });
  }

  _animateOut(reason) {
    const node = this.node;

    node.style.transition = '';
    node.style.transform = '';
    node.style.opacity = '';

    node.classList.remove('is-visible');
    node.classList.add('is-leaving');

    setTimeout(() => {
      if (node.parentNode) {
        try { node.parentNode.removeChild(node); } catch {}
      }
      this._finalize(reason);
    }, 300);
  }

  _finalize(reason) {
    try { this._resolve?.({ id: this.id, reason }); } catch {}
    this.manager._onInstanceClosed(this, reason);
  }
}

export class Notifications {
  static UI_MESSAGES = Object.freeze({
    CLOSE_BUTTON_LABEL: 'Закрыть уведомление',
    REASON_TIMEOUT:  'timeout',
    REASON_MANUAL:   'manual',
    REASON_KEYBOARD: 'keyboard',
    REASON_CLEARED:  'cleared',
    REASON_EVICTED:  'evicted',
    REASON_SWIPE:    'swipe'
  });

  _msg(key) {
    return this.constructor.UI_MESSAGES[key] || '';
  }

  constructor(opts = {}) {
    this.opts = Object.assign({
      duration: 3000,
      position: { right: 20, bottom: 20 },
      maxVisible: 5,
      pauseOnHover: true,
      dismissible: true,
      allowHtml: false,
      containerClass: 'shop-notifications',
      notificationClass: 'shop-notification',
      ariaLive: 'polite',
      showProgressBar: true,
      swipeToDismiss: true,
      swipeThresholdPx: 64,
      swipeAllowMouse: false
    }, opts);

    this._container = null;
    this._idCounter = 1;
    this._instances = new Map();
  }

  show(message, opts = {}) {
    if (!message && message !== 0) return null;

    const cfg = Object.assign({}, this.opts, opts);
    const id  = `notif_${this._idCounter++}`;
    const container = this._ensureContainer(cfg);

    this._enforceMaxVisible(cfg.maxVisible);

    const instance = new NotificationInstance(this, id, message, cfg, container);
    this._instances.set(id, instance);

    return {
      id,
      dismiss: (reason = this._msg('REASON_MANUAL')) => instance.dismiss(reason),
      promise: instance.promise
    };
  }

  clearAll() {
    const reason = this._msg('REASON_CLEARED');
    Array.from(this._instances.values())
      .forEach(inst => inst.dismiss(reason));
  }

  _onInstanceClosed(instance, reason) {
    this._instances.delete(instance.id);
    const cfg = instance.cfg;
    if (typeof cfg.onClose === 'function') {
      try { cfg.onClose({ id: instance.id, reason }); } catch {}
    }
  }

  _ensureContainer(cfg = {}) {
    if (this._container) return this._container;

    const cont = document.createElement('div');
    cont.className = cfg.containerClass || this.opts.containerClass;
    cont.style.position = 'fixed';

    const pos = cfg.position || this.opts.position;
    ['top', 'right', 'bottom', 'left'].forEach((side) => {
      if (pos[side] != null) {
        cont.style[side] =
          typeof pos[side] === 'number' ? `${pos[side]}px` : String(pos[side]);
      }
    });

    document.body.appendChild(cont);
    this._container = cont;
    return cont;
  }

  _enforceMaxVisible(maxVisible) {
    const max = Number(maxVisible) || 0;
    if (!max || this._instances.size < max) return;

    const reason = this._msg('REASON_EVICTED');
    const instances = Array.from(this._instances.values())
      .sort((a, b) => a.createdAt - b.createdAt);

    const overflow = this._instances.size - (max - 1);
    instances.slice(0, overflow)
      .forEach(inst => inst.dismiss(reason));
  }
}