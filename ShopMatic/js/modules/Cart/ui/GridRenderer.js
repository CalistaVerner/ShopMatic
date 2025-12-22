export class GridRenderer {
  constructor(ctx) {
    this.ctx = ctx;
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

    // IMPORTANT: render via Card (it mounts + delegation)
    await c.shopMatic.card.renderCardList(arr, c.cartGrid, 'HORIZONTAL');

    // After full render: sync controls & included UI defensively
    try {
      for (const it of arr) {
        const id = String(it?.name ?? it?.id ?? '').trim();
        if (!id) continue;
        const rows = c.rowSync.findAllRowsByIdInGrid(id) || [];
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

  _safeQuery(selector, root) {
    try { return (root || this.ctx.cartGrid)?.querySelector(selector) ?? null; } catch { return null; }
  }

  _findRowFromElement(el) {
    return this.ctx.rowSync.findRowFromElement(el);
  }

  _replaceOrAppendProduced(produced, existingNodes) {
    const c = this.ctx;
    if (!c?.cartGrid || !produced) return;

    if (!Array.isArray(existingNodes) || existingNodes.length === 0) {
      try { c.cartGrid.appendChild(produced); } catch {}
      return;
    }

    const first = existingNodes[0];
    if (first && first.parentNode) {
      try { first.parentNode.replaceChild(produced, first); }
      catch { try { c.cartGrid.appendChild(produced); } catch {} }
    } else {
      try { c.cartGrid.appendChild(produced); } catch {}
    }

    // IMPORTANT: no DOM deletions; just hide duplicates
    for (let i = 1; i < existingNodes.length; i++) {
      try { c.rowSync.markRemoved(existingNodes[i]); } catch {}
    }
  }

  async updateGridSingle(overrideIdKey) {
    const c = this.ctx;
    const id = String(overrideIdKey ?? '').trim();
    if (!id) return;

    try { c._pendingChangedIds?.delete(id); } catch {}

    const item = c._getCartItemById?.(id);

    // If item removed from DATA: hide rows, do NOT delete
    if (!item) {
      const rows = c.rowSync.findAllRowsByIdInGrid(id) || [];
      for (const r of rows) {
        try { c.rowSync.markRemoved(r); } catch {}
      }
      // If cart empty — can render empty state via full render
      if ((c.getCart?.()?.length || 0) === 0) await this.renderFullGrid();
      return;
    }

    // Otherwise: produce fresh row and replace first, hide duplicates
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
    try { clone.setAttribute?.('data-id', id); } catch {}

    const existing = c.rowSync.findAllRowsByIdInGrid(id) || [];
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
        const produced = tmp.querySelector('.cart-item') || tmp.firstElementChild;
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
        const rows = c.rowSync.findAllRowsByIdInGrid(id) || [];
        for (const rr of rows) {
          try { c.rowSync.markRemoved(rr); } catch {}
        }
        continue;
      }

      if (!entry.produced) { hadFailure = true; continue; }

      const produced = entry.produced.cloneNode(true);
      try { produced.setAttribute?.('data-id', id); } catch {}

      const existing = c.rowSync.findAllRowsByIdInGrid(id) || [];
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

        const rows = c.rowSync.findAllRowsByIdInGrid(id) || [];
        const item = c._getCartItemById?.(id);

        for (const r of rows) {
          if (item) {
            try { c.rowSync.restoreRow(r); } catch {}
            try { c.rowSync.syncRowControls(r, item); } catch (e) { c._logError?.('syncRowControls failed', e); }
          } else {
            // removed from DATA => hide
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
