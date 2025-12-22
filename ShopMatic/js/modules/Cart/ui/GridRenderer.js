/**
 * GridRenderer
 * @author Calista Verner
 *
 * Fix:
 *  - Never treat inner elements (title/img/etc) as rows when hiding duplicates.
 *  - Always operate on real row nodes only.
 */
export class GridRenderer {
  constructor(ctx) {
    this.ctx = ctx;
  }

  _idKey(it) {
    return String(it?.name ?? it?.id ?? it?.productId ?? '').trim();
  }

  _cssEscape(s) {
    try {
      // native
      if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(s));
    } catch {}
    // minimal fallback
    return String(s).replace(/"/g, '\\"');
  }

  /**
   * IMPORTANT: find ONLY row elements, not nested nodes.
   * We intentionally query for typical row classes first.
   */
  _findGridRowsById(id) {
    const c = this.ctx;
    const grid = c?.cartGrid;
    const key = String(id ?? '').trim();
    if (!grid || !key) return [];

    const esc = this._cssEscape(key);

    const selectors = [
      `.cart-item[data-product-id="${esc}"]`,
      `.cart-item[data-id="${esc}"]`,
      `.cart-row[data-product-id="${esc}"]`,
      `.cart-row[data-id="${esc}"]`,
      `.cart__row[data-product-id="${esc}"]`,
      `.cart__row[data-id="${esc}"]`,
      // fallback if markup does not use classes but row uses attribute
      `[data-product-id="${esc}"].cart-item, [data-id="${esc}"].cart-item`,
      `[data-product-id="${esc}"].cart-row, [data-id="${esc}"].cart-row`,
      `[data-product-id="${esc}"].cart__row, [data-id="${esc}"].cart__row`,
    ];

    for (const sel of selectors) {
      try {
        const nodes = Array.from(grid.querySelectorAll(sel));
        if (nodes.length) return nodes;
      } catch {}
    }

    // last resort: use RowSync but normalize to row via closest()
    try {
      const raw = c.rowSync?.findAllRowsByIdInGrid?.(key) || [];
      const out = [];
      const seen = new Set();
      for (const n of raw) {
        const row = c.rowSync?.findRowFromElement?.(n) || null;
        const pick = row || n;
        if (pick && !seen.has(pick)) {
          seen.add(pick);
          out.push(pick);
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  async renderItemsToTemp(items) {
    const c = this.ctx;
    const tmp = document.createElement('div');
    await c.shopMatic.card.renderCardList(items, tmp, 'HORIZONTAL');
    return tmp;
  }

  async renderFullGrid() {
    const c = this.ctx;
    const arr = Array.isArray(c.getCart?.()) ? c.getCart() : (Array.isArray(c.cart) ? c.cart : []);

    await c.shopMatic.card.renderCardList(arr, c.cartGrid, 'HORIZONTAL');

    try {
      for (const it of arr) {
        const id = this._idKey(it);
        if (!id) continue;

        const rows = this._findGridRowsById(id);
        for (const r of rows) {
          try { c.rowSync.restoreRow(r); } catch {}
          try { c.rowSync.syncRowControls(r, it); } catch {}
          try { c.totals.updateFavButtonState?.(r, id); } catch {}
        }
      }
    } catch (e) {
      c._logError?.('renderFullGrid post-sync failed', e);
    }
  }

  _findRowFromElement(el) {
    return this.ctx.rowSync.findRowFromElement(el);
  }

  _stampRowIdAttrs(node, id) {
    if (!node || !id) return;
    try { node.setAttribute?.('data-id', String(id)); } catch {}
    try { node.setAttribute?.('data-product-id', String(id)); } catch {}
  }

  _replaceOrAppendProduced(produced, existingNodes) {
    const c = this.ctx;
    if (!c?.cartGrid || !produced) return;

    const existing = Array.isArray(existingNodes) ? existingNodes : [];

    if (existing.length === 0) {
      try { c.cartGrid.appendChild(produced); } catch {}
      return;
    }

    const first = existing[0];
    if (first && first.parentNode) {
      try { first.parentNode.replaceChild(produced, first); }
      catch { try { c.cartGrid.appendChild(produced); } catch {} }
    } else {
      try { c.cartGrid.appendChild(produced); } catch {}
    }

    // IMPORTANT: hide ONLY real row duplicates (not title/img nodes)
    for (let i = 1; i < existing.length; i++) {
      try { c.rowSync.markRemoved(existing[i]); } catch {}
    }
  }

  async updateGridSingle(overrideIdKey) {
    const c = this.ctx;
    const id = String(overrideIdKey ?? '').trim();
    if (!id) return;

    try { c._pendingChangedIds?.delete(id); } catch {}

    const item = c._getCartItemById?.(id);

    if (!item) {
      const rows = this._findGridRowsById(id);
      for (const r of rows) {
        try { c.rowSync.markRemoved(r); } catch {}
      }
      if ((c.getCart?.()?.length || 0) === 0) await this.renderFullGrid();
      return;
    }

    let producedRow = null;
    try {
      const tmp = await this.renderItemsToTemp([item]);
      producedRow = tmp.querySelector('.cart-item') || tmp.querySelector('.cart-row') || tmp.firstElementChild;
    } catch (err) {
      c._logError?.('renderer.render failed', err);
      producedRow = null;
    }

    if (!producedRow || typeof producedRow.cloneNode !== 'function') {
      await this.renderFullGrid();
      return;
    }

    const clone = producedRow.cloneNode(true);
    this._stampRowIdAttrs(clone, id);

    const existing = this._findGridRowsById(id);
    this._replaceOrAppendProduced(clone, existing);

    const mainRow = this._findRowFromElement(clone) || clone;
    try { c.rowSync.restoreRow(mainRow); } catch {}
    try { c.rowSync.syncRowControls(mainRow, item); } catch (e) { c._logError?.('syncRowControls failed', e); }
    try { c.totals.updateFavButtonState?.(mainRow, id); } catch (e) { c._logError?.('updateFavButtonState failed', e); }

    try { c._changeSourceMap?.delete(id); } catch {}
  }

  async updateGridPartial(changedIdsSnapshot) {
    const c = this.ctx;
    const changedIds = Array.isArray(changedIdsSnapshot) ? changedIdsSnapshot : [];
    if (changedIds.length === 0) { await this.renderFullGrid(); return; }

    const tasks = changedIds.map(async (id) => {
      const key = String(id ?? '').trim();
      const item = c._getCartItemById?.(key);
      if (!item) return { id: key, removed: true };
      try {
        const tmp = await this.renderItemsToTemp([item]);
        const produced = tmp.querySelector('.cart-item') || tmp.querySelector('.cart-row') || tmp.firstElementChild;
        return { id: key, produced, item };
      } catch (error) {
        return { id: key, error };
      }
    });

    const settled = await Promise.allSettled(tasks);
    const apply = [];
    let hadFailure = false;

    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        if (r.value.error) { hadFailure = true; c._logError?.('partial render error', r.value.error); }
        else apply.push(r.value);
      } else {
        hadFailure = true;
        c._logError?.('partial render promise rejected', r);
      }
    }

    await new Promise((res) => requestAnimationFrame(res));

    for (const entry of apply) {
      const id = String(entry.id ?? '').trim();
      if (!id) continue;

      if (entry.removed) {
        const rows = this._findGridRowsById(id);
        for (const rr of rows) {
          try { c.rowSync.markRemoved(rr); } catch {}
        }
        continue;
      }

      if (!entry.produced) { hadFailure = true; continue; }

      const produced = entry.produced.cloneNode(true);
      this._stampRowIdAttrs(produced, id);

      const existing = this._findGridRowsById(id);
      this._replaceOrAppendProduced(produced, existing);

      const mainRow = this._findRowFromElement(produced) || produced;
      try { c.rowSync.restoreRow(mainRow); } catch {}
      try { c.rowSync.syncRowControls(mainRow, entry.item); } catch (e) { c._logError?.('syncRowControls failed', e); }
      try { c.totals.updateFavButtonState?.(mainRow, id); } catch (e) { c._logError?.('updateFavButtonState failed', e); }
    }

    const cartArr = Array.isArray(c.getCart?.()) ? c.getCart() : (Array.isArray(c.cart) ? c.cart : []);
    if (hadFailure || cartArr.length === 0) {
      await this.renderFullGrid();
    }
  }

  finalSyncRows(changedIdsSnapshot) {
    const c = this.ctx;
    try {
      const ids = Array.isArray(changedIdsSnapshot) ? changedIdsSnapshot : [];
      if (!c?.cartGrid || ids.length === 0) return;

      for (const idRaw of ids) {
        const id = String(idRaw ?? '').trim();
        if (!id) continue;

        const rows = this._findGridRowsById(id);
        const item = c._getCartItemById?.(id);

        for (const r of rows) {
          if (item) {
            try { c.rowSync.restoreRow(r); } catch {}
            try { c.rowSync.syncRowControls(r, item); } catch (e) { c._logError?.('syncRowControls failed', e); }
          } else {
            try { c.rowSync.markRemoved(r); } catch {}
          }
          try { c.totals.updateFavButtonState?.(r, id); } catch (e) { c._logError?.('updateFavButtonState failed', e); }
        }
      }
    } catch (e) {
      c._logError?.('finalSyncRows failed', e);
    }
  }
}