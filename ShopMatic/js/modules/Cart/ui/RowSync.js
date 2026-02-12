/**
 * @author Calista Verner
 */

import { IdUtils } from '../../Utils/IdUtils.js';
import { DomUtils } from '../../Utils/DomUtils.js';

/**
 * RowSync — UI-only helpers for cart rows.
 * Rules:
 *  - NEVER removes DOM nodes (only hide/show)
 *  - NO business decisions (no stock logic, no cart mutations)
 */
export class RowSync {
  /**
   * @param {any} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
  }

  /**
   * @param {Element|null} el
   * @returns {Element|null}
   */
  findRowFromElement(el) {
    if (!el) return null;
    return DomUtils.closest(el, '[data-product-id], [data-id], .cart-row, .cart__row') || null;
  }

  /**
   * @param {Element|null} row
   * @returns {string}
   */
  getIdFromRow(row) {
    if (!row) return '';
    const raw =
      row.dataset?.productId ??
      row.dataset?.id ??
      row.getAttribute?.('data-product-id') ??
      row.getAttribute?.('data-id') ??
      '';
    return IdUtils.key(raw);
  }

  /**
   * @param {string} id
   * @returns {Element[]}
   */
  findAllRowsByIdInGrid(id) {
    const key = IdUtils.key(id);
    if (!key) return [];
    const grid = this.ctx?.cartGrid;
    if (!grid) return [];

    const esc = IdUtils.cssEscape(key);
    const selectors = [
      `[data-product-id="${esc}"]`,
      `[data-id="${esc}"]`,
      `[data-product-id="${key}"]`,
      `[data-id="${key}"]`
    ];

    for (const sel of selectors) {
      try {
        const nodes = Array.from(grid.querySelectorAll(sel));
        if (nodes.length) return nodes;
      } catch {}
    }
    return [];
  }

  /**
   * Mark row as removed without deleting DOM.
   * @param {Element|null} row
   */
  markRemoved(row) {
    if (!row) return;
    row.setAttribute('data-removed', '1');

    // Premium UX: fade + collapse, then hide.
    // This keeps DOM stable during re-render and feels "market-grade".
    DomUtils.fadeOutAndHide(row, { duration: 220, collapse: true, remove: false });
  }

  /**
   * Restore row visibility.
   * @param {Element|null} row
   */
  restoreRow(row) {
    if (!row) return;
    row.removeAttribute('data-removed');

    // Restore visibility.
    try { row.hidden = false; } catch {}
    DomUtils.setVisible(row, true);

    // Clean possible fade/collapse artifacts.
    try { if (row.dataset) delete row.dataset.smRemoving; } catch {}
    try { row.classList.remove('sm-row-removing'); } catch {}
    try {
      row.style.opacity = '';
      row.style.transform = '';
      row.style.maxHeight = '';
      row.style.overflow = '';
      row.style.transition = '';
      row.style.willChange = '';
      row.style.paddingTop = '';
      row.style.paddingBottom = '';
      row.style.marginTop = '';
      row.style.marginBottom = '';
    } catch {}
  }

  /**
   * Pure UI sync (visibility + qty text/value).
   * Caller decides WHAT qty means; this function only reflects qty in DOM.
   * @param {Element} row
   * @param {any} item
   */
  syncRowControls(row, item) {
    if (!row || !item) return;

    const qty = Number(item?.qty ?? 0);

    const buyNow = DomUtils.qs(row, '[data-action="buy-now"], .btn-buy-now, .buy-now, .buyNow');
    const qtyBar = DomUtils.qs(row, '[data-role="qty-bar"], .qty-bar, .qtyBar, .quantity-bar, .card__qty');

    // UI visibility only (no stock logic)
    if (qty <= 0) {
      DomUtils.setVisible(qtyBar, false);
      DomUtils.setVisible(buyNow, true);
    } else {
      DomUtils.setVisible(buyNow, false);
      DomUtils.setVisible(qtyBar, true);
    }

    const qtyValueEl =
      DomUtils.qs(row, '[data-role="qty-value"]') ||
      DomUtils.qs(row, '.qty-value') ||
      DomUtils.qs(row, '.qty__value') ||
      DomUtils.qs(row, 'input.qty, input[name="qty"]');

    if (qtyValueEl) {
      try {
        if ('value' in qtyValueEl) qtyValueEl.value = String(Math.max(0, qty));
        else qtyValueEl.textContent = String(Math.max(0, qty));
      } catch {}
    }

    // Never disable minus/plus here (UI-only, and user requirement: minus never blocks)
    const minusBtn = DomUtils.qs(row, '[data-action="qty-"], .qty-minus, .qty__minus, .btn-qty-minus');
    const plusBtn = DomUtils.qs(row, '[data-action="qty+"], .qty-plus, .qty__plus, .btn-qty-plus');
    DomUtils.setDisabled(minusBtn, false);
    DomUtils.setDisabled(plusBtn, false);
  }
}
