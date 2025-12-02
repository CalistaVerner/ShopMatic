// Catalog/FilterController.js
import { debounce } from '../utils.js';

/**
 * FilterField — единица фильтра.
 * Инкапсулирует:
 *  - работу с DOM-элементом (el)
 *  - события (events)
 *  - геттер/сеттер значения
 *  - дефолтное значение
 *  - навешивание / снятие обработчиков
 */
class FilterField {
  /**
   * @param {Object} cfg
   * @param {string}           cfg.key
   * @param {HTMLElement|null} cfg.el
   * @param {string[]}         cfg.events
   * @param {Function}         cfg.getValue     (el) => any
   * @param {Function}         cfg.setValue     (el, value) => void
   * @param {any|Function}     cfg.defaultValue
   * @param {boolean}          [cfg.useDebounce=false]
   * @param {number}           [cfg.debounceMs=300]
   */
  constructor({
    key,
    el,
    events = ['change'],
    getValue,
    setValue,
    defaultValue = '',
    useDebounce = false,
    debounceMs = 300
  }) {
    this.key = key;
    this.el = el || null;
    this.events = Array.isArray(events) ? events : ['change'];
    this.getValue =
      typeof getValue === 'function' ? getValue : (element) => element?.value ?? '';
    this.setValue =
      typeof setValue === 'function'
        ? setValue
        : (element, value) => {
            if (!element) return;
            element.value = value ?? '';
          };

    this.defaultValue = defaultValue;
    this.useDebounce = !!useDebounce;
    this.debounceMs = debounceMs;

    /** @type {Function|null} */
    this._handler = null;
  }

  /** Текущее значение поля */
  read() {
    return this.getValue(this.el);
  }

  /** Установить значение в DOM */
  write(value) {
    this.setValue(this.el, value);
  }

  /** Дефолтное значение (может быть функцией) */
  getDefault() {
    return typeof this.defaultValue === 'function'
      ? this.defaultValue(this.el)
      : this.defaultValue ?? '';
  }

  /** Навесить события, используя общий handler контроллера */
  bind(baseHandler) {
    if (!this.el || !this.events?.length) return;

    const handler =
      this.useDebounce && this.debounceMs > 0
        ? debounce(baseHandler, this.debounceMs)
        : baseHandler;

    this._handler = handler;

    this.events.forEach((eventName) => {
      this.el.addEventListener(eventName, handler);
    });
  }

  /** Снять события */
  unbind() {
    if (!this.el || !this._handler || !this.events?.length) return;

    this.events.forEach((eventName) => {
      this.el.removeEventListener(eventName, this._handler);
    });

    this._handler = null;
  }
}

/**
 * FilterController:
 *  - регистрирует FilterField'ы
 *  - хранит и выдаёт состояние
 *  - уведомляет CatalogController об изменениях
 */
export class FilterController {
  /**
   * @param {Object} opts
   * @param {HTMLInputElement|null}  opts.searchEl
   * @param {HTMLSelectElement|null} opts.catFilterEl
   * @param {HTMLSelectElement|null} opts.brandFilterEl
   * @param {HTMLSelectElement|null} opts.sortEl
   * @param {HTMLButtonElement|null} opts.searchBtnEl
   * @param {HTMLButtonElement|null} opts.resetBtnEl
   * @param {HTMLElement|null}       opts.productsCountEl
   * @param {number}                 [opts.debounceMs=300]
   */
  constructor({
    searchEl,
    catFilterEl,
    brandFilterEl,
    sortEl,
    searchBtnEl,
    resetBtnEl,
    productsCountEl,
    debounceMs = 300
  } = {}) {
    this.productsCountEl = productsCountEl || null;
    this.resetBtnEl = resetBtnEl || null;
    this.searchBtnEl = searchBtnEl || null;

    this._debounceMs = debounceMs;
    /** @type {(state: object) => void|null} */
    this._onChange = null;

    /** @type {Map<string, FilterField>} */
    this._fields = new Map();

    // --- регистрация полей по ООП-подходу ---------------------------------
    if (searchEl) {
      this._registerField(
        new FilterField({
          key: 'search',
          el: searchEl,
          events: ['input'],
          useDebounce: true,
          debounceMs,
          getValue: (el) => (el?.value || '').trim(),
          setValue: (el, value) => {
            if (!el) return;
            el.value = value ?? '';
          },
          defaultValue: ''
        })
      );
    }

    if (catFilterEl) {
      this._registerField(
        new FilterField({
          key: 'category',
          el: catFilterEl,
          events: ['change'],
          getValue: (el) => el?.value || '',
          setValue: (el, value) => {
            if (!el) return;
            el.value = value ?? '';
          },
          defaultValue: ''
        })
      );
    }

    if (brandFilterEl) {
      this._registerField(
        new FilterField({
          key: 'brand',
          el: brandFilterEl,
          events: ['change'],
          getValue: (el) => el?.value || '',
          setValue: (el, value) => {
            if (!el) return;
            el.value = value ?? '';
          },
          defaultValue: ''
        })
      );
    }

    if (sortEl) {
      this._registerField(
        new FilterField({
          key: 'sort',
          el: sortEl,
          events: ['change'],
          getValue: (el) => el?.value || '',
          setValue: (el, value) => {
            if (!el) return;
            el.value = value ?? '';
          },
          // дефолт сортировки — первая option
          defaultValue: (el) => {
            if (!el) return '';
            const first = el.querySelector('option');
            return first ? first.value : '';
          }
        })
      );
    }

    // инициализируем state
    this._state = this._buildInitialState();

    this._boundHandleChange = this._handleChange.bind(this);
    this._boundReset = this._handleReset.bind(this);
    this._boundSearchBtn = this._handleSearchBtn.bind(this);
  }

  /* ----------------------------------------------------------------------- */
  /* Public API                                                              */
  /* ----------------------------------------------------------------------- */

  /**
   * Подписать контроллер на изменения фильтров
   * @param {(state: object) => void} onChange
   */
  bind(onChange) {
    this._onChange = typeof onChange === 'function' ? onChange : null;

    // навешиваем события на каждый зарегистрированный фильтр
    for (const field of this._fields.values()) {
      field.bind(this._boundHandleChange);
    }

    // кнопка поиска — принудительно триггерит пересчёт
    if (this.searchBtnEl) {
      this.searchBtnEl.addEventListener('click', this._boundSearchBtn);
    }

    // сброс всех фильтров
    if (this.resetBtnEl) {
      this.resetBtnEl.addEventListener('click', this._boundReset);
    }
  }

  unbind() {
    // снимаем обработчики с фильтров
    for (const field of this._fields.values()) {
      field.unbind();
    }

    if (this.searchBtnEl) {
      this.searchBtnEl.removeEventListener('click', this._boundSearchBtn);
    }
    if (this.resetBtnEl) {
      this.resetBtnEl.removeEventListener('click', this._boundReset);
    }

    this._onChange = null;
  }

  /** Текущее состояние фильтров */
  getState() {
    this._syncFromControls();
    return { ...this._state };
  }

  /**
   * Применить состояние к контролам
   * @param {Object} partial
   * @param {boolean} [options.silent=false]
   */
  setState(partial = {}, { silent = false } = {}) {
    this._state = { ...this._state, ...partial };
    this._syncToControls();
    if (!silent) this._emitChange();
  }

  /** Сброс фильтров к дефолтному состоянию */
  reset({ silent = false } = {}) {
    this._state = this._buildInitialState();
    this._syncToControls();

    if (!silent) this._emitChange();
  }

  /** Обновить визуальный счётчик товаров */
  setCount(count) {
    if (this.productsCountEl) {
      this.productsCountEl.textContent = String(count ?? 0);
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Internal                                                                */
  /* ----------------------------------------------------------------------- */

  _registerField(fieldInstance) {
    if (!fieldInstance || !fieldInstance.key) return;
    this._fields.set(fieldInstance.key, fieldInstance);
  }

  _buildInitialState() {
    const state = {};
    for (const [key, field] of this._fields.entries()) {
      state[key] = field.getDefault();
    }
    return state;
  }

  _emitChange() {
    if (!this._onChange) return;
    this._onChange(this.getState());
  }

  _syncFromControls() {
    for (const [key, field] of this._fields.entries()) {
      this._state[key] = field.read();
    }
  }

  _syncToControls() {
    for (const [key, field] of this._fields.entries()) {
      field.write(this._state[key]);
    }
  }

  _handleChange() {
    this._syncFromControls();
    this._emitChange();
  }

  _handleSearchBtn() {
    this._handleChange();
  }

  _handleReset() {
    this.reset();
  }
}
