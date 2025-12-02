export class RowSync {
  constructor(ctx) {
    this.ctx = ctx;
  }

  resolveStockAndQty(row, item, qtyInput) {
    const c = this.ctx;
    let stock = Number(item?.stock) || Number(row?.getAttribute?.('data-stock')) || Number(c._getCartItemById(item?.name)?.stock) || 0;
    let qty = Number(item?.qty) || Number(qtyInput?.value) || Number(c._getCartItemById(item?.name)?.qty) || 0;
    return { stock: stock > 0 ? stock : 0, qty: qty > 0 ? qty : 0 };
  }

  ensureStockWarning(row) {
    let w = row.querySelector?.('.stock-warning');
    if (!w) {
      w = document.createElement('div');
      w.className = 'stock-warning';
      w.style.cssText = 'color:#c62828;font-size:13px;margin-top:6px;display:none;';
      (row.querySelector('.cart-item__aside') || row).appendChild(w);
    }
    return w;
  }

  createRowCheckbox() {
    const wrapper = document.createElement('label');
    wrapper.className = 'y-checkbox cart-row-select';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'cart-item-checkbox';
    input.dataset.role = 'include';

    const box = document.createElement('span');
    box.className = 'y-box';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('y-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M10.003 19 2.503 11.5l1.498-1.501 6.001 6.061 9.5-9.564 1.5 1.5z');

    svg.appendChild(path);
    box.appendChild(svg);

    wrapper.appendChild(input);
    wrapper.appendChild(box);

    return { wrapper, input };
  }

  findRowFromElement(el) {
    let n = el;
    while (n && n !== document.documentElement) {
      if (n.classList?.contains('cart-item')) return n;
      n = n.parentElement;
    }
    return null;
  }

  getIdFromRow(row) {
    const c = this.ctx;
    if (!row) return '';
    try {
      let id = row.getAttribute?.('data-id') || row.getAttribute?.('data-cart-item');
      if (id) return c._normalizeIdKey(id);

      const via = [
        row.querySelector?.('.qty-controls[data-id]'),
        row.querySelector?.('.remove-btn[data-id]')
      ].find(Boolean);
      if (via) return c._normalizeIdKey(via.getAttribute('data-id'));

      const link = row.querySelector?.('a[href*="#product/"]');
      if (link) {
        const href = link.getAttribute('href');
        const m = href.match(/#product\/([^\/?#]+)/);
        if (m) return c._normalizeIdKey(m[1]);
      }

      const any = row.querySelector?.('[data-id],[data-product-id],[data-cart-id]');
      if (any) {
        return c._normalizeIdKey(
          any.getAttribute('data-id') ||
          any.getAttribute('data-product-id') ||
          any.getAttribute('data-cart-id')
        );
      }
    } catch (e) {
      c._logError('_getIdFromRow failed', e);
    }
    return '';
  }

  findAllRowsByIdInGrid(id) {
    const c = this.ctx;
    if (!c.cartGrid || !id) return [];
    const esc = c._cssEscape(String(id));
    const rows = [];

    try {
      const byAttr = c.cartGrid.querySelectorAll(`[data-id="${esc}"]`);
      if (byAttr?.length) {
        for (const n of byAttr) rows.push(this.findRowFromElement(n) || n);
      } else {
        for (const r of c.cartGrid.querySelectorAll('.cart-item')) {
          if (this.getIdFromRow(r) === c._normalizeIdKey(id)) rows.push(r);
        }
      }
    } catch {
      for (const r of c.cartGrid.querySelectorAll('.cart-item')) {
        if (this.getIdFromRow(r) === c._normalizeIdKey(id)) rows.push(r);
      }
    }

    return [...new Set(rows)];
  }

  async syncRowControls(row, item) {
    const c = this.ctx;
    if (!row || c._rowsSyncing.has(row)) return;

    try {
      c._rowsSyncing.add(row);

      const qtyInput = row.querySelector?.('.qty-input');
      const btnPlus = row.querySelector?.('.qty-btn.qty-incr') || row.querySelector?.('[data-action="qty-incr"]') || row.querySelector?.('[data-role="qty-plus"]');
      const btnMinus = row.querySelector?.('.qty-btn.qty-decr') || row.querySelector?.('[data-action="qty-decr"]') || row.querySelector?.('[data-role="qty-minus"]');

      const { stock, qty: rawQty } = this.resolveStockAndQty(row, item, qtyInput);
      let qty = rawQty;
      const warn = this.ensureStockWarning(row);

      if (qtyInput) {
        qtyInput.min = '1';
        qtyInput.max = String(stock);
        if (stock <= 0) {
          qtyInput.value = '0';
          qtyInput.disabled = true;
        } else {
          qty = Math.min(Math.max(1, qty), stock);
          qtyInput.value = String(qty);
          qtyInput.disabled = false;
        }
      }

      const disableMinus = stock <= 0 || qty <= 1;
      if (btnMinus) {
        btnMinus.disabled = disableMinus;
        btnMinus.classList.toggle('disabled', disableMinus);
      }

      const disablePlus = stock <= 0 || qty >= stock;
      if (btnPlus) {
        btnPlus.disabled = disablePlus;
        btnPlus.classList.toggle('disabled', disablePlus);
        if (stock > 0 && qty >= stock) c._showLimitMsg?.(row, c._msg('PRODUCT_LIMIT_REACHED'));
        else c._hideLimitMsg?.(row);
      } else c._hideLimitMsg?.(row);

      if (stock <= 0) {
        warn.textContent = c._msg('NO_STOCK_TEXT');
        warn.style.display = '';
        row.classList.add('out-of-stock');
        if (qtyInput) qtyInput.disabled = true;
      } else {
        warn.style.display = 'none';
        row.classList.remove('out-of-stock');
      }

      try {
        let include = row.querySelector(
          'input[data-role="include"], .include-checkbox input[type="checkbox"], .cart-item__include input[type="checkbox"], input[name="include"]'
        );

        if (!include) {
          const cb = this.createRowCheckbox();
          row.prepend(cb.wrapper);
          include = cb.input;
        }

        const included = c.included.ensureItemIncluded(item);
        include.checked = included;
        row.classList.toggle('excluded-from-total', !included);

        include.onchange = () => {
          const val = include.checked;
          if (item) item.included = val;
          row.classList.toggle('excluded-from-total', !val);
          try { c.included.toggleInclude(c._normalizeIdKey(item.name ?? item.id), val, { sourceRow: row }); } catch {}
          try { c.included.updateMasterSelectState(); } catch {}
          try { c.updateTotals?.(); } catch {}
        };
      } catch (e) {}

      c._refreshSingleProductForRow?.(row);
    } catch (e) {
      c._logError('_syncRowControls failed', e);
    } finally {
      c._rowsSyncing.delete(row);
    }
  }
}