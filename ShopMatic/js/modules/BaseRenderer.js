// Renderer/BaseRenderer.js
import { escapeHtml as _escapeHtml, makeSpecHtmlPreview, formatPrice } from './utils.js';

/**
 * BaseRenderer
 * Базовый класс с общими хелперами и доступом к движку/сервисам
 */
export class BaseRenderer {
  /**
   * @param {Object} options
   * @param {Object|null} options.shopMatic
   * @param {Object|null} options.productService
   * @param {Object|null} options.favorites
   */
  constructor({ shopMatic }) {
    this.shopMatic = shopMatic;
    this.foxEngine = shopMatic.foxEngine;
    this.templateRenderer = this.foxEngine.templateRenderer;
  }

  // -----------------------
  // Helpers
  // -----------------------

  /**
   * Безопасный JSON.parse с fallback'ом
   * @param {string|any} value
   * @param {any} fallback
   * @returns {any}
   */
  safeParseJSON(value, fallback = []) {
    if (value == null) return fallback;
    if (typeof value !== 'string') return value;
    try {
      const parsed = JSON.parse(value);
      return parsed === null ? fallback : parsed;
    } catch (_) {
      return fallback;
    }
  }

  /**
   * Нормализованное представление списка картинок.
   * Принимает строку или массив и возвращает массив строк.
   * @param {string|Array} picture
   * @returns {Array<string>}
   */
  _getImageArray(picture) {
    const arr = this.safeParseJSON(picture, []);
    return Array.isArray(arr) ? arr.map(String) : [];
  }

  /**
   * Возвращает первую картинку из поля picture или дефолт
   * @param {string|Array} picture
   * @returns {string}
   */
  getFirstImage(picture) {
    const arr = this._getImageArray(picture);
    return Array.isArray(arr) && arr.length ? String(arr[0]) : '/assets/no-image.png';
  }

  /**
   * Унифицированное форматирование цены
   * @param {number|string|null} value
   * @returns {string}
   */
  _formatPrice(value) {
    try {
      if (typeof formatPrice === 'function') return formatPrice(value ?? 0);
      const num = Number(value ?? 0);
      return Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB'
      }).format(num);
    } catch (_) {
      return String(value ?? '');
    }
  }

  /**
   * Безопасное экранирование для селектора / data-атрибутов
   * @param {string} val
   * @returns {string}
   */
  escapeForAttribute(val) {
    try {
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(String(val));
      }
    } catch (_) { /* ignore */ }
    return String(val).replace(/"/g, '\\"');
  }

  /**
   * Логгер, безопасный при отсутствии foxEngine
   * @param {string} msg
   * @param {string} level
   */
  _log(msg, level = 'INFO') {
    try {
      this.foxEngine?.log?.(`Renderer: ${msg}`, level);
    } catch (_) { /* noop */ }
  }

  // -----------------------
  // Template rendering
  // -----------------------

  /**
   * Унифицированный рендер via foxEngine template cache.
   * @param {string} tplName
   * @param {Object} data
   * @returns {Promise<string>}
   */
  async renderTemplate(tplName, data = {}) {
    if (!this.templateRenderer?.renderTemplate) return '';
    try {
      return await this.templateRenderer.renderTemplate(tplName, data);
    } catch (e) {
      this._log(`renderTemplate error (${tplName}): ${e}`, 'WARN');
      return '';
    }
  }

  /**
   * Создаёт элемент DOM из HTML строки (возвращает первый элемент)
   * @param {string} html
   * @returns {Element}
   */
  createElementFromHTML(html = '') {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = String(html).trim();
    return wrapper.firstElementChild || wrapper;
  }

  /**
   * Вынесенные общие утилиты для других классов
   */
  get htmlEscape() {
    return _escapeHtml;
  }

  get makeSpecHtmlPreview() {
    return makeSpecHtmlPreview;
  }
}
