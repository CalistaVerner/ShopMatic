// Catalog/FilterController-v3.js
import { debounce } from '../utils.js';
import { UrlState } from '../Utils/UrlState.js';

/**
 * FilterController — universal, declarative filter controller (prod-ready).
 * @author Calista Verner
 */
export class FilterController {
  constructor({
    searchEl,
    catFilterEl,
    brandFilterEl,
    sortEl,
    searchBtnEl,
    resetBtnEl,
    productsCountEl,
    debounceMs = 300,
    urlSync = true,
    urlPrefix = 'sm',
    urlUseHash = false
  } = {}) {
    this.productsCountEl = productsCountEl || null;
    this.searchBtnEl = searchBtnEl || null;
    this.resetBtnEl = resetBtnEl || null;

    this._onChange = null;
    this._debounceMs = debounceMs;

    this._urlSync = !!urlSync;
    this._urlPrefix = urlPrefix || 'sm';
    this._urlUseHash = !!urlUseHash;

    this._fieldsConfig = [
      this._makeTextField('search', searchEl),
      this._makeSelectField('category', catFilterEl),
      this._makeSelectField('brand', brandFilterEl),
      this._makeSelectField('sort', sortEl)
    ].filter(Boolean);

    this._state = this._buildInitialState();
    this._applyUrlStateIfAny();
    this._fieldHandlers = new Map();

    this._boundReset = this._handleReset.bind(this);
    this._boundSearchBtn = this._handleSearchBtn.bind(this);
  }

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

  bind(onChange) {
    this._onChange = typeof onChange === 'function' ? onChange : null;

    const baseHandler = this._handleChange.bind(this);

    this._fieldsConfig.forEach(cfg => {
      const { key, el, events, useDebounce } = cfg;
      if (!el) return;

      const handler = useDebounce ? debounce(baseHandler, this._debounceMs) : baseHandler;

      this._fieldHandlers.set(key, handler);
      events.forEach(evt => el.addEventListener(evt, handler));
    });

    if (this.searchBtnEl) this.searchBtnEl.addEventListener('click', this._boundSearchBtn);
    if (this.resetBtnEl) this.resetBtnEl.addEventListener('click', this._boundReset);
  }

  unbind() {
    this._fieldsConfig.forEach(cfg => {
      const { key, el, events } = cfg;
      const handler = this._fieldHandlers.get(key);
      if (!el || !handler) return;
      events.forEach(evt => el.removeEventListener(evt, handler));
    });

    this._fieldHandlers.clear();

    if (this.searchBtnEl) this.searchBtnEl.removeEventListener('click', this._boundSearchBtn);
    if (this.resetBtnEl) this.resetBtnEl.removeEventListener('click', this._boundReset);

    this._onChange = null;
  }

  getState() {
    this._syncFromControls();
    return { ...this._state };
  }

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

  setCount(count) {
    if (this.productsCountEl) this.productsCountEl.textContent = String(count ?? 0);
  }

  _buildInitialState() {
    const s = {};
    this._fieldsConfig.forEach(cfg => {
      const def = cfg.defaultValue;
      s[cfg.key] = typeof def === 'function' ? def() : def ?? '';
    });
    return s;
  }

  _emitChange() {
    if (this._urlSync) {
      UrlState.write(this._state, { prefix: this._urlPrefix, useHash: this._urlUseHash });
    }
    if (this._onChange) this._onChange(this.getState());
  }

  _applyUrlStateIfAny() {
    if (!this._urlSync) return;
    const fromUrl = UrlState.read({ prefix: this._urlPrefix, useHash: this._urlUseHash });
    if (!fromUrl || !Object.keys(fromUrl).length) return;
    // Only known keys
    const safe = {};
    for (const cfg of this._fieldsConfig) {
      const k = cfg.key;
      if (Object.prototype.hasOwnProperty.call(fromUrl, k)) safe[k] = fromUrl[k];
    }
    this._state = { ...this._state, ...safe };
  }

  _syncFromControls() {
    this._fieldsConfig.forEach(cfg => {
      const { key, el, getValue } = cfg;
      if (el && getValue) this._state[key] = getValue(el);
    });
  }

  _syncToControls() {
    this._fieldsConfig.forEach(cfg => {
      const { key, el, setValue } = cfg;
      if (el && setValue) setValue(el, this._state[key]);
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
