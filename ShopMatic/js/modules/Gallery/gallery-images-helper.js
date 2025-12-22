// gallery-images-helper.js
export class GalleryImagesHelper {
  /**
   * @param {import('./gallery.js').Gallery} gallery
   */
  constructor(gallery) {
    this.gallery = gallery;
  }

  /**
   * Извлекает все http/https URL из строки.
   */
  extractUrlsFromString(str) {
    const s = String(str || '').trim();
    if (!s) return [];
    // Попробуем JSON сначала
    if (s[0] === '[' || s[0] === '{') {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          return parsed
            .map((v) => (typeof v === 'string' ? v.trim() : ''))
            .filter(Boolean);
        }
      } catch {
        // игнорируем, дальше regex
      }
    }
    const matches = s.match(/https?:\/\/[^"\s,]+/g);
    return Array.isArray(matches) ? matches : [];
  }

  /**
   * Рекурсивно вытаскивает src из произвольного значения.
   */
  extractSrc(val) {
    if (val == null) return '';
    if (typeof val === 'string') {
      const s = val.trim();
      if (!s) return '';
      const urls = this.extractUrlsFromString(s);
      if (urls.length) return urls[0];

      if (s[0] === '[' || s[0] === '{') {
        try {
          return this.extractSrc(JSON.parse(s));
        } catch {
          return s;
        }
      }
      return s;
    }

    if (Array.isArray(val)) {
      for (const v of val) {
        const c = this.extractSrc(v);
        if (c) return c;
      }
      return '';
    }

    if (typeof val === 'object') {
      const fields = ['src', 'url', 'path', 'file', 'location', 'thumb', 'thumbnail'];
      for (const f of fields) {
        if (val[f]) {
          const c = this.extractSrc(val[f]);
          if (c) return c;
        }
      }
      const numeric = Object.keys(val).sort((a, b) => Number(a) - Number(b));
      for (const k of numeric) {
        if (!isNaN(Number(k))) {
          const c = this.extractSrc(val[k]);
          if (c) return c;
        }
      }
      return '';
    }

    return '';
  }

  /**
   * Нормализация одного элемента в {id, src, thumb, alt}.
   */
  normalizeImageItem(item, idx = 0) {
    if (item == null && item !== 0) return null;

    if (typeof item === 'string') {
      const urls = this.extractUrlsFromString(item);
      const first = urls[0] || item.trim();
      if (!first) return null;
      return { id: null, src: first, thumb: first, alt: '' };
    }

    if (Array.isArray(item)) {
      for (const it of item) {
        const n = this.normalizeImageItem(it, idx);
        if (n && n.src) return n;
      }
      return null;
    }

    if (typeof item === 'object') {
      const srcFields = ['src', 'url', 'path', 'file', 'location', 'image'];
      const thumbFields = ['thumb', 'thumbnail', 'preview'];
      let src = '';
      for (const f of srcFields) {
        if (item[f]) {
          src = this.extractSrc(item[f]);
          if (src) break;
        }
      }
      if (!src) {
        const numericKeys = Object.keys(item)
          .filter((k) => String(Number(k)) === k)
          .sort((a, b) => Number(a) - Number(b));
        for (const k of numericKeys) {
          const c = this.extractSrc(item[k]);
          if (c) {
            src = c;
            break;
          }
        }
      }

      let thumb = '';
      for (const f of thumbFields) {
        if (item[f]) {
          thumb = this.extractSrc(item[f]);
          if (thumb) break;
        }
      }

      if (!thumb) thumb = src || '';
      if (!src) return null;

      const alt = item.alt || item.title || item.name || '';
      const id  = item.id ?? item.key ?? null;

      return { id, src, thumb, alt };
    }

    return null;
  }

  /**
   * Нормализация входного списка картинок в массив.
   */
  normalizeImages(images) {
    if (images == null) return [];

    // строка: одна, массив, JSON, список урлов
    if (typeof images === 'string') {
      const s = images.trim();
      if (!s) return [];
      const urls = this.extractUrlsFromString(s);
      if (urls.length) {
        return urls.map((u) => ({ id: null, src: u, thumb: u, alt: '' }));
      }
      return this.normalizeImages([s]);
    }

    // объект с полями images/gallery/files и т.п.
    if (!Array.isArray(images) && typeof images === 'object') {
      if (Array.isArray(images.images)) return this.normalizeImages(images.images);
      const maybeKeys = ['gallery', 'files', 'pictures', 'photos'];
      for (const k of maybeKeys) {
        if (Array.isArray(images[k])) return this.normalizeImages(images[k]);
      }
      const single = this.extractSrc(images);
      return single ? [{ id: null, src: single, thumb: single, alt: '' }] : [];
    }

    if (Array.isArray(images)) {
      const out = [];
      images.forEach((item, i) => {
        const norm = this.normalizeImageItem(item, i);
        if (norm && norm.src) out.push(norm);
      });
      // дедуп по src
      const seen = new Set();
      const unique = [];
      for (const it of out) {
        if (!seen.has(it.src)) {
          seen.add(it.src);
          unique.push(it);
        }
      }
      return unique;
    }

    return [];
  }

  /**
   * Прелоад соседних картинок.
   */
  preload(index) {
    const n = this.gallery.images.length;
    const opts = this.gallery.options;
    if (!n || opts.preloadAdjacent <= 0) return;
    for (let d = 1; d <= opts.preloadAdjacent; d++) {
      [index + d, index - d].forEach((i) => {
        const j = this.gallery._clampIndex(i);
        const src = this.gallery.images[j]?.src;
        if (src) {
          const img = new Image();
          img.src = src;
        }
      });
    }
  }
}
