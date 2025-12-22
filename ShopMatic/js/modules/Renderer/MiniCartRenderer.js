// Renderer/MiniCartRenderer.js
import { BaseRenderer } from '../BaseRenderer.js';

/**
 * MiniCartRenderer
 * Рендер элементов мини-корзины (дропдаун, offcanvas и т.п.)
 */
export class MiniCartRenderer extends BaseRenderer {
  /**
   * Создать HTML одного элемента мини-корзины
   * @param {Object} item
   * @param {Object|null} foxEngineOverride
   * @returns {Promise<string>}
   */
  async createMiniCartItemHTML(item = {}, foxEngineOverride = null) {
    const foxEngine = foxEngineOverride || this.foxEngine;

    const title = String(item.fullname ?? item.title ?? item.name ?? 'Товар');
    const price = this._formatPrice(item.price ?? 0);
    const qty = Number.isFinite(Number(item.qty)) ? Number(item.qty) : 0;
    const imageArray = this._getImageArray(item.picture);
    const img = String(
      imageArray.at
        ? imageArray.at(0) ?? '/assets/no-image.png'
        : imageArray[0] ?? '/assets/no-image.png'
    );
    const id = String(item.name ?? item.id ?? '');

    if (foxEngine?.templateCache?.miniCartItem && foxEngine.replaceTextInTemplate) {
      try {
        return await foxEngine.replaceTextInTemplate(
          foxEngine.templateCache.miniCartItem,
          { id, img, title, qty, price }
        );
      } catch (e) {
        this._log(`createMiniCartItemHTML template error: ${e}`, 'WARN');
      }
    }

    const esc = (v) => this.htmlEscape(String(v));

    return `
      <li class="cart-item" data-id="${esc(id)}">
        <div class="mc-thumb">
          <img src="${esc(img)}" alt="${esc(title)}" loading="lazy"/>
        </div>
        <div class="mc-body">
          <div class="mc-name">${esc(title)}</div>
          <div class="mc-meta">${esc(String(qty))} × ${esc(price)}</div>
        </div>
      </li>`;
  }
}
