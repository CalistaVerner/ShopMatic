// StorageService/AvailabilityLoader.js

export class AvailabilityLoader {
  /**
   * @param {Object} options
   * @param {Object} options.productService - ожидается fetchById(id)
   * @param {number} [options.defaultConcurrency]
   */
  constructor({ productService, defaultConcurrency = 6 }) {
    this.productService = productService;
    this.defaultConcurrency = Math.max(1, Number(defaultConcurrency || 6));
  }

  _getKeyFromItem(it) {
    if (!it) return '';
    if (typeof it === 'string') return String(it).trim();
    return String(it.name ?? it.id ?? it.productId ?? it._missingId ?? '').trim();
  }

  /**
   * Batch-process generic items: fetch product data by key and augment items with
   * { available, missing, stock, fullname?, price? }.
   *
   * @param {Array} items - массив нормализованных объектов (но может быть и строками)
   * @param {Object} options - { concurrency }
   * @param {Function} onMissingCallback - optional (key) => void
   */
  async loadWithAvailability(items, options = {}, onMissingCallback) {
    try {
      if (!Array.isArray(items) || items.length === 0) return items || [];

      const ps = this.productService;
      const concurrency = Math.max(
        1,
        Number(options.concurrency ?? this.defaultConcurrency)
      );

      // если нет productService — просто проставляем available по stock
      if (!ps || typeof ps.fetchById !== 'function') {
        return items.map((item) => {
          const key = this._getKeyFromItem(item);
          const stock = Number((item && item.stock) ?? 0);
          return Object.assign(
            {},
            typeof item === 'string' ? { name: item } : item,
            {
              available: stock > 0,
              missing: !key,
              stock
            }
          );
        });
      }

      const results = [];
      for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);

        const promises = batch.map(async (rawItem) => {
          const out = Object.assign(
            {},
            typeof rawItem === 'string' ? { name: rawItem } : rawItem
          );
          const key = this._getKeyFromItem(rawItem);

          if (!key) {
            out.available = false;
            out.missing = true;
            out.stock = 0;
            return out;
          }

          try {
            const product = await ps.fetchById(key);

            if (!product) {
              console.warn(`AvailabilityLoader: no product for id="${key}"`);
              if (typeof onMissingCallback === 'function') {
                try {
                  onMissingCallback(key);
                } catch (e) {
                  console.warn(
                    'AvailabilityLoader: onMissingCallback failed for',
                    key,
                    e
                  );
                }
              }
              out.available = false;
              out.missing = true;
              out.stock = 0;
              return out;
            }

            const prodStock = Number(
              product.stock ?? product._stock ?? product.count ?? product.qty ?? 0
            );

            out.stock = Number(out.stock || prodStock || 0);
            out.available = prodStock > 0;
            out.missing = false;

            if (!out.fullname && (product.fullname || product.title || product.name)) {
              out.fullname = product.fullname ?? product.title ?? product.name;
            }
            if ((!out.price || out.price === 0) && product.price != null) {
              out.price = Number(product.price);
            }

            return out;
          } catch (e) {
            console.warn(
              `AvailabilityLoader: fetchById failed for id="${key}"`,
              e
            );
            out.available = false;
            out.missing = true;
            out.stock = 0;
            return out;
          }
        });

        const settled = await Promise.allSettled(promises);
        for (const s of settled) {
          if (s.status === 'fulfilled') {
            results.push(s.value);
          } else {
            results.push({ available: false, missing: true, stock: 0 });
          }
        }
      }

      return results;
    } catch (e) {
      console.warn('AvailabilityLoader.loadWithAvailability error', e);
      return items || [];
    }
  }
}
