export class GridRenderer {
  constructor(ctx) {
    this.ctx = ctx;
  }

  hasGridRenderer() {
    const c = this.ctx;
    return !!(c?.cartGrid && c?.renderer);
  }

  async renderItemsToTemp(items) {
    const c = this.ctx;
    const tmp = document.createElement('div');
    if (typeof c?.renderer?.renderCards === 'function') {
      await c.renderer.renderCards(tmp, items, c.renderer.foxEngine);
    } else if (typeof c?.renderer?._renderCartHorizontal === 'function') {
      await c.renderer._renderCartHorizontal(tmp, items);
    } else {
      throw new Error('renderer API missing render function');
    }
    return tmp;
  }

  async renderFullGrid() {
    const c = this.ctx;
    if (!this.hasGridRenderer()) return;
    if (typeof c?.renderer?._renderCartHorizontal !== 'function') return;
    await c.renderer._renderCartHorizontal(c.cartGrid, c.cart);
    try { c.listeners.attachGridListeners(); } catch (e) { c._logError?.('attachGridListeners failed', e); }
  }

  _safeQuery(selector, root) {
    try { return (root || this.ctx.cartGrid)?.querySelector(selector) ?? null; } catch (_) { return null; }
  }

  _findRowFromElement(el) {
    return this.ctx.rowSync.findRowFromElement(el);
  }

  _getIdFromRow(row) {
    return this.ctx.rowSync.getIdFromRow(row);
  }

  _replaceOrAppendProduced(produced, existingNodes) {
    const c = this.ctx;
    if (!c?.cartGrid || !produced) return;

    if (!Array.isArray(existingNodes) || existingNodes.length === 0) {
      try { c.cartGrid.appendChild(produced); } catch (_) {}
      return;
    }

    const first = existingNodes[0];
    if (first && first.parentNode) {
      try { first.parentNode.replaceChild(produced, first); } catch (e) { try { c.cartGrid.appendChild(produced); } catch (_) {} }
    } else {
      try { c.cartGrid.appendChild(produced); } catch (_) {}
    }

    for (let i = 1; i < existingNodes.length; i++) {
      const node = existingNodes[i];
      try { if (node && node.parentNode) node.parentNode.removeChild(node); } catch (_) {}
    }
  }

  async updateGridSingle(overrideIdKey) {
    const c = this.ctx;
    const id = String(overrideIdKey);
    try { c._pendingChangedIds?.delete(id); } catch (_) {}

    const esc = c._cssEscape ? c._cssEscape(String(id)) : String(id);
    const targetRow = this._safeQuery(`[data-id="${esc}"]`) || null;
    const resolvedTarget = this._findRowFromElement(targetRow) || targetRow;
    const item = c._getCartItemById(id);

    if (!item) {
      const rows = c.rowSync.findAllRowsByIdInGrid(id) || [];
      for (const r of rows) try { if (r.parentNode) r.parentNode.removeChild(r); } catch (_) {}
      if ((c.cart?.length || 0) === 0) await this.renderFullGrid();
      else try { c.listeners.attachGridListeners(); } catch (e) { c._logError?.('attachGridListeners failed', e); }
      return;
    }

    let producedRow = null;
    try {
      const tmp = await this.renderItemsToTemp([item]);
      producedRow = tmp.querySelector('.cart-item') || tmp.firstElementChild;
    } catch (err) {
      c._logError?.('renderer.render failed', err);
      producedRow = null;
    }

    if (!producedRow || typeof producedRow.cloneNode !== 'function') {
      await this.renderFullGrid();
      return;
    }

    const clone = producedRow.cloneNode(true);
    if (clone.setAttribute) clone.setAttribute('data-id', String(id));

    if (resolvedTarget && resolvedTarget.parentNode) {
      try { resolvedTarget.parentNode.replaceChild(clone, resolvedTarget); } catch (e) { try { resolvedTarget.parentNode.appendChild(clone); } catch (_) { try { c.cartGrid.appendChild(clone); } catch (_) {} } }
    } else {
      const rows = c.rowSync.findAllRowsByIdInGrid(id) || [];
      if (rows.length > 0) {
        try { rows[0].parentNode.replaceChild(clone, rows[0]); } catch (e) { try { c.cartGrid.appendChild(clone); } catch (_) {} }
        for (let i = 1; i < rows.length; i++) try { if (rows[i].parentNode) rows[i].parentNode.removeChild(rows[i]); } catch (_) {}
      } else {
        try { c.cartGrid.appendChild(clone); } catch (_) {}
      }
    }

    const mainRow = this._findRowFromElement(clone) || clone;
    try { if (mainRow && item) c.rowSync.syncRowControls(mainRow, item); } catch (e) { c._logError?.('syncRowControls failed', e); }
    try { if (mainRow) c.totals.updateFavButtonState?.(mainRow, id); } catch (e) { c._logError?.('updateFavButtonState failed', e); }

    try {
      const src = c._changeSourceMap?.get(id);
      if (src instanceof Element) {
        const q = mainRow.querySelector && mainRow.querySelector('.qty-input');
        if (q) q.focus();
      }
    } catch (_) {}
    try { c._changeSourceMap?.delete(id); } catch (_) {}

    try { c.listeners.attachGridListeners(); } catch (e) { c._logError?.('attachGridListeners failed', e); }
  }

  async updateGridPartial(changedIdsSnapshot) {
    const c = this.ctx;
    const changedIds = Array.isArray(changedIdsSnapshot) ? changedIdsSnapshot : [];
    if (changedIds.length === 0) { await this.renderFullGrid(); return; }

    const tasks = changedIds.map(async (id) => {
      const item = c._getCartItemById(id);
      if (!item) return { id, removed: true };
      try {
        const tmp = await this.renderItemsToTemp([item]);
        const produced = tmp.querySelector('.cart-item') || tmp.firstElementChild;
        return { id, produced, item };
      } catch (error) {
        return { id, error };
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
        hadFailure = true; c._logError?.('partial render promise rejected', r);
      }
    }

    await new Promise((res) => requestAnimationFrame(res));

    for (const entry of apply) {
      try {
        if (entry.removed) {
          const rows = c.rowSync.findAllRowsByIdInGrid(entry.id) || [];
          for (const rr of rows) try { if (rr.parentNode) rr.parentNode.removeChild(rr); } catch (_) {}
          continue;
        }

        if (!entry.produced) { hadFailure = true; continue; }

        const produced = entry.produced.cloneNode(true);
        if (produced.setAttribute) produced.setAttribute('data-id', String(entry.id));
        const existing = c.rowSync.findAllRowsByIdInGrid(entry.id) || [];
        this._replaceOrAppendProduced(produced, existing);

        const mainRow = this._findRowFromElement(produced) || produced;
        try { if (entry.item) c.rowSync.syncRowControls(mainRow, entry.item); } catch (e) { c._logError?.('syncRowControls failed', e); }
        try { c.totals.updateFavButtonState?.(mainRow, entry.id); } catch (e) { c._logError?.('updateFavButtonState failed', e); }
      } catch (e) { hadFailure = true; c._logError?.('apply partial failed', e); }
    }

    if (hadFailure || (c.cart?.length || 0) === 0) {
      await this.renderFullGrid();
    } else {
      try { c.listeners.attachGridListeners(); } catch (e) { c._logError?.('attachGridListeners failed', e); }
    }
  }

  finalSyncRows(changedIdsSnapshot) {
    const c = this.ctx;
    try {
      const ids = Array.isArray(changedIdsSnapshot) ? changedIdsSnapshot : [];
      if (!c?.cartGrid || ids.length === 0) return;

      for (const id of ids) {
        const esc = c._cssEscape ? c._cssEscape(String(id)) : String(id);
        const row = this._safeQuery(`[data-id="${esc}"]`) || null;
        const mainRow = this._findRowFromElement(row) || row;
        const item = c._getCartItemById(id);
        if (mainRow && item) {
          try { c.rowSync.syncRowControls(mainRow, item); } catch (e) { c._logError?.('syncRowControls failed', e); }
          try { c.totals.updateFavButtonState?.(mainRow, id); } catch (e) { c._logError?.('updateFavButtonState failed', e); }
        } else if (mainRow) {
          try { c.totals.updateFavButtonState?.(mainRow, id); } catch (e) { c._logError?.('updateFavButtonState failed', e); }
        }
      }
    } catch (e) { this.ctx._logError?.('finalSyncRows failed', e); }
  }
}
