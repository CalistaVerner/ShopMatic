/*
 * shopmatic/NotificationsOptimized.js
 *
 * Notifications manager for ShopMatic with CyberLife style and
 * built-in progress bar.
 *
 * Author: Calista Verner (OO-refactor by assistant)
 * Version: 2.0.0 (API-compatible with 1.4.0)
 * License: MIT
 */

const ICONS_BY_TYPE = Object.freeze({
  success: 'fa-solid fa-check',
  warning: 'fa-solid fa-triangle-exclamation',
  error:   'fa-solid fa-hexagon-exclamation',
  info:    'fa-solid fa-info'
});

/**
 * Один инстанс конкретного уведомления:
 * - создаёт DOM
 * - управляет таймером и прогресс-баром
 * - обрабатывает hover/keyboard
 * - анимирует появление/исчезновение
 */
class NotificationInstance {
  /**
   * @param {Notifications} manager
   * @param {string} id
   * @param {string|Node} message
   * @param {Object} cfg   итоговый конфиг (глобальный + локальный)
   * @param {HTMLElement} container
   */
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

    /** promise, который резолвится при закрытии уведомления */
    this.promise = new Promise((resolve) => {
      this._resolve = resolve;
    });

    this._buildNode();
    this._wireInteractions();
    this._mount();
  }

  /* =============== ПУБЛИЧНОЕ API ИНСТАНСА =============== */

  /**
   * Программно закрыть уведомление.
   * @param {string} reason
   */
  dismiss(reason = this.manager._msg('REASON_MANUAL')) {
    if (this.dismissed) return;
    this.dismissed = true;
    this._clearTimer();
    this._animateOut(reason);
  }

  /* ===================== ВНУТРЕННЕЕ ====================== */

  _buildNode() {
    const { cfg, manager, id } = this;

    const note = document.createElement('div');
    note.className =
      `${cfg.notificationClass} ${cfg.notificationClass}--${cfg.type || 'info'}`.trim();
    note.dataset.notificationId = id;
    note.tabIndex = 0;
    note.style.pointerEvents = 'auto';

    const isAssertive = cfg.type === 'error' || cfg.ariaLive === 'assertive';
    note.setAttribute('role', isAssertive ? 'alert' : 'status');
    note.setAttribute('aria-live', cfg.ariaLive);
    note.setAttribute('aria-atomic', 'true');

    // Иконка
    const typeKey   = (cfg.type && String(cfg.type)) ? String(cfg.type) : 'info';
    const iconClass = ICONS_BY_TYPE[typeKey] || ICONS_BY_TYPE.info;
    const iconEl    = document.createElement('i');
    iconEl.className =
      `${iconClass} ${cfg.notificationClass}__icon notif-icon notif-icon--${typeKey}`;
    iconEl.setAttribute('aria-hidden', 'true');

    // Контент
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

    // Кнопка закрытия
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

    // Прогресс-бар
    if (cfg.showProgressBar) {
      const progress = document.createElement('div');
      progress.className = `${cfg.notificationClass}__progress`;
      note.appendChild(progress);
      this.progressEl = progress;
    }

    this.node = note;
  }

  _wireInteractions() {
    const { node, cfg, manager } = this;
    if (!node) return;

    // Hover pause / resume
    if (cfg.pauseOnHover) {
      node.addEventListener('mouseenter', () => this._pauseTimer());
      node.addEventListener('mouseleave', () => this._resumeTimer());
    }

    // Escape для закрытия
    node.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' || ev.key === 'Esc') {
        ev.preventDefault();
        this.dismiss(manager._msg('REASON_KEYBOARD'));
      }
    });
  }

  _mount() {
    const { node, container } = this;
    if (!node || !container) return;

    node.classList.add('is-entering');
    container.appendChild(node);

    // Запуск enter-анимации + прогресс-бара
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
    this.startTs   = Date.now();
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
    if (!this.cfg.pauseOnHover || !this.timeoutId) return;
    const elapsed = Date.now() - this.startTs;
    this.remainingMs = Math.max(0, this.remainingMs - elapsed);
    this._clearTimer();

    // "заморозить" прогресс-бар
    if (this.progressEl) {
      const parent = this.progressEl.parentElement;
      const parentWidth = parent ? parent.clientWidth : 0;
      const currentWidth = this.progressEl.getBoundingClientRect().width;
      const pct = parentWidth ? (currentWidth / parentWidth) * 100 : 0;
      this.progressEl.style.transition = 'none';
      this.progressEl.style.width = `${pct}%`;
    }
  }

  _resumeTimer() {
    if (!this.cfg.pauseOnHover || this.remainingMs <= 0) return;
    this._startTimer(this.remainingMs);

    // продолжить анимацию прогресс-бара
    if (this.progressEl) {
      // возможно контейнер изменился
      const parent = this.progressEl.parentElement;
      const _parentWidth = parent ? parent.clientWidth : 0;
      this.progressEl.style.transition = `width ${this.remainingMs}ms linear`;
      this.progressEl.style.width = '0%';
    }
  }

  _startProgressBar() {
    if (!this.progressEl) return;
    const bar = this.progressEl;
    // стартуем c 100% без анимации, затем анимируем до 0
    bar.style.transition = 'none';
    bar.style.width = '100%';
    requestAnimationFrame(() => {
      bar.style.transition = `width ${this.remainingMs}ms linear`;
      bar.style.width = '0%';
    });
  }

  _animateOut(reason) {
    const node = this.node;
    if (!node) return this._finalize(reason);

    node.classList.remove('is-visible');
    node.classList.add('is-leaving');

    const REMOVE_DELAY = 320;
    setTimeout(() => {
      if (node.parentNode) {
        try { node.parentNode.removeChild(node); } catch {}
      }
      this._finalize(reason);
    }, REMOVE_DELAY);
  }

  _finalize(reason) {
    // уведомить manager
    try {
      this._resolve?.({ id: this.id, reason });
    } catch {}
    this.manager._onInstanceClosed(this, reason);
  }
}

/**
 * Менеджер уведомлений:
 * - управляет контейнером
 * - следит за maxVisible
 * - создаёт NotificationInstance
 * - даёт show()/clearAll()
 */
export class Notifications {
  static UI_MESSAGES = Object.freeze({
    CLOSE_BUTTON_LABEL: 'Закрыть уведомление',
    REASON_TIMEOUT:  'timeout',
    REASON_MANUAL:   'manual',
    REASON_KEYBOARD: 'keyboard',
    REASON_CLEARED:  'cleared',
    REASON_EVICTED:  'evicted'
  });

  _msg(key, vars = {}) {
    const pool = (this.constructor && this.constructor.UI_MESSAGES) || {};
    const tpl = pool[key] ?? '';
    return String(tpl).replace(/\{([^}]+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
    );
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
      showProgressBar: true
    }, opts);

    /** @type {HTMLElement|null} */
    this._container = null;
    this._idCounter = 1;

    /** @type {Map<string, NotificationInstance>} */
    this._instances = new Map();
  }

  /**
   * Показать уведомление.
   * @param {string|Node} message
   * @param {Object} opts
   * @returns {{id:string, dismiss:(reason?:string)=>void, promise:Promise<{id,reason}>}|null}
   */
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

  /**
   * Закрыть все активные уведомления.
   */
  clearAll() {
    const reason = this._msg('REASON_CLEARED');
    // делаем копию, чтобы не ломать итерацию
    const instances = Array.from(this._instances.values());
    instances.forEach(inst => inst.dismiss(reason));
  }

  /* ==================== ВНУТРЕННЕЕ API ==================== */

  /**
   * Колбек от NotificationInstance при полном завершении.
   * @param {NotificationInstance} instance
   * @param {string} reason
   * @internal
   */
  _onInstanceClosed(instance, reason) {
    this._instances.delete(instance.id);

    const cfg = instance.cfg;
    if (typeof cfg.onClose === 'function') {
      try {
        cfg.onClose({ id: instance.id, reason });
      } catch {}
    }
  }

  _ensureContainer(cfg = {}) {
    if (this._container) return this._container;

    const cont = document.createElement('div');
    cont.className = cfg.containerClass || this.opts.containerClass;

    // лёгкое использование position-настроек, если заданы числа
    const pos = cfg.position || this.opts.position;
    cont.style.position = cont.style.position || 'fixed';
    if (pos && typeof pos === 'object') {
      ['top', 'right', 'bottom', 'left'].forEach((side) => {
        if (pos[side] != null) {
          const val = typeof pos[side] === 'number' ? `${pos[side]}px` : String(pos[side]);
          cont.style[side] = val;
        }
      });
    }

    document.body.appendChild(cont);
    this._container = cont;
    return cont;
  }

  /**
   * Обеспечить maxVisible: самые старые инстансы аккуратно выселяются.
   */
  _enforceMaxVisible(maxVisible) {
    const max = Number(maxVisible) || 0;
    if (!max || this._instances.size < max) return;

    const reasonEvicted = this._msg('REASON_EVICTED');
    const instances = Array.from(this._instances.values())
      .sort((a, b) => a.createdAt - b.createdAt); // старые первыми

    const overflow = this._instances.size - (max - 1);
    if (overflow <= 0) return;

    const toEvict = instances.slice(0, overflow);
    toEvict.forEach(inst => inst.dismiss(reasonEvicted));
  }
}
