// ProductPage/ProductPage.js
import { ProductPageContext } from './ProductPageContext.js';
import { ProductPageView } from './ProductPageView.js';
import { ProductPageController } from './ProductPageController.js';

export class ProductPage {
  constructor(shop, opts = {}) {
    this._ctx = new ProductPageContext(shop, opts);
    this._view = new ProductPageView(this._ctx);
    this._controller = new ProductPageController(this._ctx, this._view);
  }

  async render(productId, container = this._ctx.foxEngine.replaceData.contentBlock) {
    return this._controller.render(productId, container);
  }

  destroy() {
    this._controller.destroy();
  }
}