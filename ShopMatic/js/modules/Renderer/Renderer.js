// Renderer/Renderer.js
import { BaseRenderer } from '../BaseRenderer.js';
import { MiniCartRenderer } from './MiniCartRenderer.js';

export class Renderer extends BaseRenderer {
  constructor(options = {}) {
    super(options);
    this.miniCartRenderer = new MiniCartRenderer(options);
  }

  // -----------------------
  // Mini cart item
  // -----------------------

  /**
   * Создать HTML мини-элемента корзины
   * (старое название: _createMiniCartItemHTML)
   * @param {Object} item
   * @param {Object|null} foxEngine
   * @returns {Promise<string>}
   */
  async _createMiniCartItemHTML(item = {}, foxEngine = null) {
    return this.miniCartRenderer.createMiniCartItemHTML(item, foxEngine);
  }
}
