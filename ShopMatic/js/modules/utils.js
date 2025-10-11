// shopmatic/utils.js
export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function debounce(fn, ms = 200) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

export function formatPrice(n) {
  return Number(n || 0).toLocaleString('ru-RU') + ' ₽';
}

export function computeDiscountPercent(p) {
  if (!p || typeof p.oldPrice !== 'number') return 0;
  if (p.oldPrice <= p.price) return 0;
  const percent = Math.round(((p.oldPrice - p.price) / p.oldPrice) * 100);
  return Math.max(0, percent);
}

/**
 * makeSpecHtmlPreview: принимает JSON-строку или объект и возвращает безопасный HTML
 * @param {string|object} specs
 * @returns {string}
 */
export function makeSpecHtmlPreview(specs) {
  if (arguments.length === 0 || specs == null) return '';

  let data = specs;
  if (typeof specs === 'string') {
    specs = specs.trim();
    if (!specs) return '';
    try {
      data = JSON.parse(specs);
    } catch {
      return '';
    }
  }
  if (typeof data !== 'object' || Array.isArray(data) || !Object.keys(data).length) {
    return '';
  }
  let html = '<strong>Основные характеристики:</strong><ul>';
  for (const [key, value] of Object.entries(data)) {
    html += `<li>${escapeHtml(key)}: ${escapeHtml(value)}</li>`;
  }
  html += '</ul>';
  return html;
}
