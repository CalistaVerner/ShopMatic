// Catalog/FilterController.js
import { debounce } from '../utils.js';

/**
 * Универсальный OOP-фильтр
 *
 * Цели:
 *  - единый интерфейс для всех типов полей (input/select/checkbox/range/другие)
 *  - возможность регистрировать кастомные Field-типы
 *  - декларативное описание полей (как раньше) — обратно совместимо
 *  - централизованная логика биндинга/отвязывания, чтения/применения состояния
 *
 * Принцип:
 *  - FieldBase определяет API: bind(handler), unbind(), read(), write(value), reset()
 *  - есть стандартные реализации: TextField, SelectField, CheckboxField, GenericField
 *  - FilterController автоматически выбирает подходящий класс по конфигу (.type) или по элементу (tagName/type)
 *  - можно регистрировать дополнительные классы через FilterController.registerFieldType(name, ctor)
 *
 * Примечание: сохранил публичный API FilterController (bind/unbind/getState/setState/reset/setCount)
 */

class FieldBase {
  /**
   * @param {Object} cfg
   *  - key {string}
   *  - el {HTMLElement|null}
   *  - events {string[]}
   *  - useDebounce {boolean}
   *  - defaultValue {*}
   *  - debounceMs {number}
   *  - getValue {Function|null}  optional override
   *  - setValue {Function|null}  optional override
   */
  constructor(cfg = {}) {
    this.key = cfg.key;
    this.el = cfg.el || null;
    this.events = Array.isArray(cfg.events) ? cfg.events.slice() : [];
    this.useDebounce = Boolean(cfg.useDebounce);
    this.defaultValue = typeof cfg.defaultValue === 'function' ? cfg.defaultValue() : (cfg.defaultValue ?? '');
    this._getValue = typeof cfg.getValue === 'function' ? cfg.getValue : null;
    this._setValue = typeof cfg.setValue === 'function' ? cfg.setValue : null;
    this._debounceMs = cfg.debounceMs || 300;

    this._boundHandler = null;
    this._listeners = [];
  }

  bind(handler) {
    if (!this.el || !handler) return;
    let fn = handler.bind(this);
    if (this.useDebounce) {
      fn = debounce(fn, this._debounceMs);
    }
    this._boundHandler = fn;

    for (const ev of this.events) {
      this.el.addEventListener(ev, this._boundHandler);
      this._listeners.push({ ev, fn: this._boundHandler });
    }
  }

  unbind() {
    if (!this.el) return;
    for (const { ev, fn } of this._listeners) {
      try { this.el.removeEventListener(ev, fn); } catch (_) {}
    }
    this._listeners = [];
    this._boundHandler = null;
  }

  read() {
    // default implementation uses provided getter or fallback
    if (this._getValue) return this._getValue(this.el);
    return this._defaultRead();
  }

  write(value) {
    if (this._setValue) {
      this._setValue(this.el, value);
      return;
    }
    this._defaultWrite(value);
  }

  reset() {
    this.write(this.defaultValue);
  }

  _defaultRead() {
    // generic fallback: if element has .value use it, else dataset.value or textContent
    if (!this.el) return '';
    if ('value' in this.el) return this.el.value;
    if (this.el.dataset && this.el.dataset.value !== undefined) return this.el.dataset.value;
    return this.el.textContent ?? '';
  }

  _defaultWrite(value) {
    if (!this.el) return;
    if ('value' in this.el) this.el.value = value ?? '';
    else if (this.el.dataset) this.el.dataset.value = String(value ?? '');
    else this.el.textContent = String(value ?? '');
  }
}

/* Стандартные реализации полей */

class TextField extends FieldBase {
  constructor(cfg = {}) {
    super(Object.assign({
      events: ['input'],
      useDebounce: true,
      debounceMs: cfg.debounceMs
    }, cfg));
  }

  _defaultRead() {
    if (!this.el) return '';
    return String(this.el.value || '').trim();
  }

  _defaultWrite(value) {
    if (!this.el) return;
    this.el.value = value ?? '';
  }
}

class SelectField extends FieldBase {
  constructor(cfg = {}) {
    super(Object.assign({
      events: ['change'],
      useDebounce: false,
      debounceMs: cfg.debounceMs
    }, cfg));
  }

  _defaultRead() {
    if (!this.el) return '';
    return String(this.el.value || '');
  }

  _defaultWrite(value) {
    if (!this.el) return;
    // try set value, fallback to select option by index/text
    try {
      this.el.value = value ?? '';
    } catch (_) {
      // nothing
    }
  }
}

class CheckboxField extends FieldBase {
  constructor(cfg = {}) {
    super(Object.assign({
      events: ['change'],
      useDebounce: false,
      debounceMs: cfg.debounceMs
    }, cfg));
  }

  _defaultRead() {
    if (!this.el) return false;
    return Boolean(this.el.checked);
  }

  _defaultWrite(value) {
    if (!this.el) return;
    this.el.checked = !!value;
  }
}

class GenericField extends FieldBase {
  // keeps base behavior
}

/* Registry для типов полей */
const DEFAULT_TYPE_MAP = {
  text: TextField,
  search: TextField,
  select: SelectField,
  checkbox: CheckboxField,
  generic: GenericField
};

class FieldFactory {
  constructor() {
    this._map = Object.assign({}, DEFAULT_TYPE_MAP);
  }

  register(typeName, ctor) {
    if (typeof typeName !== 'string' || typeof ctor !== 'function') {
      throw new Error('Invalid arguments for register(typeName, ctor)');
    }
    this._map[typeName] = ctor;
  }

  create(cfg = {}) {
    const { type, el } = cfg;
    let usedType = type;
    if (!usedType && el) {
      // infer by element
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'select') usedType = 'select';
      else if (tag === 'input') {
        const t = (el.type || '').toLowerCase();
        if (t === 'checkbox' || t === 'radio') usedType = 'checkbox';
        else usedType = 'text';
      } else if (tag === 'textarea') usedType = 'text';
      else usedType = 'generic';
    }
    const ctor = this._map[usedType] || GenericField;
    return new ctor(Object.assign({ debounceMs: cfg.debounceMs }, cfg));
  }
}

/* Singleton factory (можно расширять извне) */
const fieldFactory = new FieldFactory();

/* Экспорт регистратора типов (при необходимости проект может расширять) */
export function registerFilterFieldType(name, ctor) {
  fieldFactory.register(name, ctor);
}

/* ===========================
   FilterController
   =========================== */

export class FilterController {
  /**
   * @param {Object} opts
   *  - searchEl, catFilterEl, brandFilterEl, sortEl, searchBtnEl, resetBtnEl
   *  - productsCountEl
   *  - debounceMs
   *  - fieldsConfig (optional) — если необходимо передать кастомные поля/параметры
   */
  constructor({
    searchEl = null,
    catFilterEl = null,
    brandFilterEl = null,
    sortEl = null,
    searchBtnEl = null,
    resetBtnEl = null,
    productsCountEl = null,
    debounceMs = 300,
    fieldsConfig = null
  } = {}) {
    this.productsCountEl = productsCountEl || null;
    this.resetBtnEl = resetBtnEl || null;
    this.searchBtnEl = searchBtnEl || null;

    this._onChange = null;
    this._debounceMs = debounceMs;

    // Если передан fieldsConfig — используем его, иначе строим стандартный конфиг
    const baseConfig = fieldsConfig ?? [
      { key: 'search', el: searchEl, type: 'search', events: ['input'], useDebounce: true, defaultValue: '' },
      { key: 'category', el: catFilterEl, type: 'select', events: ['change'], useDebounce: false, defaultValue: '' },
      { key: 'brand', el: brandFilterEl, type: 'select', events: ['change'], useDebounce: false, defaultValue: '' },
      { key: 'sort', el: sortEl, type: 'select', events: ['change'], useDebounce: false, defaultValue: '' }
    ];

    // Создаём Field-объекты
    this._fields = baseConfig.map(cfg => {
      const merged = Object.assign({ debounceMs: this._debounceMs }, cfg);
      // if cfg provides getValue/setValue/defaultValue functions, they will be used by the field
      return fieldFactory.create(merged);
    });

    // map по ключам для быстрого доступа
    this._fieldsMap = new Map();
    this._fields.forEach(f => {
      if (f && f.key) this._fieldsMap.set(f.key, f);
    });

    // bound handlers
    this._boundReset = this._handleReset.bind(this);
    this._boundSearchBtn = this._handleSearchBtn.bind(this);
    this._baseChangeHandler = this._handleChange.bind(this);
  }

  /* ----------------------------
     Публичный API (совместимый)
     ---------------------------- */

  bind(onChange) {
    this._onChange = typeof onChange === 'function' ? onChange : null;

    // навешиваем обработчики на поля
    for (const field of this._fields) {
      if (!field || !field.el) continue;
      // field.bind принимает handler, у нас — единый base handler
      field.bind(this._baseChangeHandler);
    }

    // search button
    if (this.searchBtnEl) {
      this.searchBtnEl.addEventListener('click', this._boundSearchBtn);
    }

    // reset button
    if (this.resetBtnEl) {
      this.resetBtnEl.addEventListener('click', this._boundReset);
    }
  }

  unbind() {
    for (const field of this._fields) {
      try { field.unbind(); } catch (_) {}
    }

    if (this.searchBtnEl) {
      this.searchBtnEl.removeEventListener('click', this._boundSearchBtn);
    }
    if (this.resetBtnEl) {
      this.resetBtnEl.removeEventListener('click', this._boundReset);
    }

    this._onChange = null;
  }

  getState() {
    // синхронизируем state из всех полей
    const state = {};
    for (const field of this._fields) {
      if (!field) continue;
      state[field.key] = field.read();
    }
    return state;
  }

  /**
   * Применить состояние к контролам
   * @param {Object} partial
   * @param {Object} options { silent: boolean }
   */
  setState(partial = {}, { silent = false } = {}) {
    // обновляем поля, если ключи совпадают
    for (const [k, v] of Object.entries(partial)) {
      const f = this._fieldsMap.get(k);
      if (f) f.write(v);
    }
    if (!silent) this._emitChange();
  }

  reset({ silent = false } = {}) {
    // особая логика: если есть select sort — дефолтное значение берем из первой option
    const sortField = this._fieldsMap.get('sort');
    if (sortField && sortField.el && typeof sortField.el.querySelector === 'function') {
      const first = sortField.el.querySelector('option');
      sortField.defaultValue = first ? first.value : '';
    }

    for (const field of this._fields) {
      if (!field) continue;
      field.reset();
    }

    if (!silent) this._emitChange();
  }

  setCount(count) {
    if (this.productsCountEl) {
      this.productsCountEl.textContent = String(count ?? 0);
    }
  }

  /* ----------------------------
     Internal
     ---------------------------- */

  _emitChange() {
    if (!this._onChange) return;
    try {
      this._onChange(this.getState());
    } catch (e) {
      console.error('FilterController: onChange handler threw', e);
    }
  }

  _handleChange() {
    // Все поля уже синхронизируются при read(), поэтому просто эмитим
    this._emitChange();
  }

  _handleSearchBtn() {
    this._handleChange();
  }

  _handleReset() {
    this.reset();
  }

  /**
   * Позволяет добавить поле динамически (например, после AJAX-рендера)
   * @param {Object} cfg - конфигурация как в конструкторе (key, el, type, events, useDebounce, ...)
   */
  addField(cfg = {}) {
    const merged = Object.assign({ debounceMs: this._debounceMs }, cfg);
    const field = fieldFactory.create(merged);
    if (field && field.key) {
      this._fields.push(field);
      this._fieldsMap.set(field.key, field);
      // если уже бинден — сразу навесим обработчики
      if (this._onChange) field.bind(this._baseChangeHandler);
    }
    return field;
  }

  /**
   * Удалить поле из контроллера (и отвязать события)
   * @param {string} key
   */
  removeField(key) {
    const f = this._fieldsMap.get(key);
    if (!f) return;
    try { f.unbind(); } catch (_) {}
    this._fieldsMap.delete(key);
    this._fields = this._fields.filter(x => x !== f);
  }
}

/* экспорт регистратора типов — если нужно расширить поведение (например, range, datepicker и т.д.) */
export { registerFilterFieldType };
