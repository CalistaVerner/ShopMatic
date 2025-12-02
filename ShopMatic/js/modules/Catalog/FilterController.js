// Catalog/FilterController-v3.js
import { debounce } from '../utils.js';

/**
 * Универсальный ООП-фильтр:
 *  - единообразная регистрация любых типов DOM-контролов
 *  - декларативный список полей
 *  - автоматическая привязка событий
 *  - синхронизация DOM <-> state
 *  - поддержка reset, setState, debounce, кнопки поиска/сброса
 *
 * Каждый фильтр описывается объектом:
 * {
 *   key: 'search',
 *   el: HTMLElement,
 *   events: ['input', 'change'],
 *   getValue(el) { ... },
 *   setValue(el, v) { ... },
 *   defaultValue: '' | (() => ...)
 * }
 *
 * Файл полностью совместим с CatalogController.
 */
export class FilterController {

  /**
   * @param {Object} opts
   * @param {HTMLElement|null} opts.searchEl
   * @param {HTMLElement|null} opts.catFilterEl
   * @param {HTMLElement|null} opts.brandFilterEl
   * @param {HTMLElement|null} opts.sortEl
   * @param {HTMLElement|null} opts.searchBtnEl
   * @param {HTMLElement|null} opts.resetBtnEl
   * @param {HTMLElement|null} opts.productsCountEl
   * @param {number} [opts.debounceMs=300]
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
    this.searchBtnEl = searchBtnEl || null;
    this.resetBtnEl = resetBtnEl || null;

    this._onChange = null;
    this._debounceMs = debounceMs;

    /**
     * Универсальный декларативный список контролов.
     */
    this._fieldsConfig = [
      this._makeTextField('search', searchEl),
      this._makeSelectField('category', catFilterEl),
      this._makeSelectField('brand', brandFilterEl),
      this._makeSelectField('sort', sortEl)
    ].filter(Boolean);

    /** текущее состояние */
    this._state = this._buildInitialState();

    this._fieldHandlers = new Map();

    this._boundReset = this._handleReset.bind(this);
    this._boundSearchBtn = this._handleSearchBtn.bind(this);
  }

  /* ----------------------------------------------------------------------- */
  /* Factories (универсальные создатели типов контролов)                     */
  /* ----------------------------------------------------------------------- */

  _makeTextField(key, el) {
    if (!el) return null;
    return {
      key,
      el,
      events: ['input'],
      useDebounce: true,
      getValue: (el) => (el.value || '').trim(),
      setValue: (el, v) => { el.value = v ?? ''; },
      defaultValue: ''
    };
  }

  _makeSelectField(key, el) {
    if (!el) return null;
    return {
      key,
      el,
      events: ['change'],
      useDebounce: false,
      getValue: (el) => el.value ?? '',
      setValue: (el, v) => { el.value = v ?? ''; },
      defaultValue: ''
    };
  }

  /* ----------------------------------------------------------------------- */
  /* Public API                                                              */
  /* ----------------------------------------------------------------------- */

  /**
   * @param {(state: object) => void} onChange
   */
  bind(onChange) {
    this._onChange = typeof onChange === 'function' ? onChange : null;

    const baseHandler = this._handleChange.bind(this);

    this._fieldsConfig.forEach(cfg => {
      const { key, el, events, useDebounce } = cfg;
      if (!el) return;

      const handler = useDebounce
        ? debounce(baseHandler, this._debounceMs)
        : baseHandler;

      this._fieldHandlers.set(key, handler);

      events.forEach(evt => el.addEventListener(evt, handler));
    });

    if (this.searchBtnEl) {
      this.searchBtnEl.addEventListener('click', this._boundSearchBtn);
    }
    if (this.resetBtnEl) {
      this.resetBtnEl.addEventListener('click', this._boundReset);
    }
  }

  unbind() {
    this._fieldsConfig.forEach(cfg => {
      const { key, el, events } = cfg;
      const handler = this._fieldHandlers.get(key);
      if (!el || !handler) return;

      events.forEach(evt => el.removeEventListener(evt, handler));
    });

    this._fieldHandlers.clear();

    if (this.searchBtnEl) {
      this.searchBtnEl.removeEventListener('click', this._boundSearchBtn);
    }
    if (this.resetBtnEl) {
      this.resetBtnEl.removeEventListener('click', this._boundReset);
    }

    this._onChange = null;
  }

  /** Получить state */
  getState() {
    this._syncFromControls();
    return { ...this._state };
  }

  /**
   * @param {Object} partial
   * @param {Object} [options]
   * @param {boolean} [options.silent=false]
   */
  setState(partial = {}, { silent = false } = {}) {
    this._state = { ...this._state, ...partial };
    this._syncToControls();
    if (!silent) this._emitChange();
  }

  reset({ silent = false } = {}) {
    const sortCfg = this._fieldsConfig.find(f => f.key === 'sort');
    if (sortCfg?.el) {
      const first = sortCfg.el.querySelector('option');
      sortCfg.defaultValue = first ? first.value : '';
    }

    this._state = this._buildInitialState();
    this._syncToControls();

    if (!silent) this._emitChange();
  }

  /** Счётчик товаров */
  setCount(count) {
    if (this.productsCountEl) {
      this.productsCountEl.textContent = String(count ?? 0);
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Internal                                                                */
  /* ----------------------------------------------------------------------- */

  _buildInitialState() {
    const s = {};
    this._fieldsConfig.forEach(cfg => {
      const def = cfg.defaultValue;
      s[cfg.key] = typeof def === 'function' ? def() : def ?? '';
    });
    return s;
  }

  _emitChange() {
    if (this._onChange) {
      this._onChange(this.getState());
    }
  }

  _syncFromControls() {
    this._fieldsConfig.forEach(cfg => {
      const { key, el, getValue } = cfg;
      if (el && getValue) {
        this._state[key] = getValue(el);
      }
    });
  }

  _syncToControls() {
    this._fieldsConfig.forEach(cfg => {
      const { key, el, setValue } = cfg;
      if (el && setValue) {
        setValue(el, this._state[key]);
      }
    });
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
