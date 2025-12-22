/**
 * WishlistModule (class)
 * @author Calista Verner
 * Version: 1.0.0
 */
export class FavoritesUI {
  constructor(opts = {}) {
    this.globalConfig = (typeof window !== 'undefined' && window.FAV_API_CONFIG) ? window.FAV_API_CONFIG : {};
    this.foxEngine = (typeof window !== 'undefined' && window.foxEngine) ? window.foxEngine : (opts.foxEngine || null);

    // merge config
    const cfg = Object.assign({}, this.globalConfig, opts);
    this.config = {
      storageKey: (this.foxEngine && this.foxEngine.shopMatic && this.foxEngine.shopMatic.FAV_KEY) || cfg.storageKey || 'gribkov_favs_v1',
      api: {
        enabled: cfg.enabled ?? (!!(cfg.baseUrl || (this.foxEngine && this.foxEngine.shopMatic && this.foxEngine.shopMatic.apiBase))),
        baseUrl: cfg.baseUrl ?? (this.foxEngine && this.foxEngine.shopMatic && this.foxEngine.shopMatic.apiBase) ?? '/api',
        endpoints: Object.assign({
          list: '/favorites',
          add: '/favorites',
          remove: '/favorites/{id}',
          clear: '/favorites/clear',
          product: '/products/{id}'
        }, (cfg.endpoints || {})),
        getHeaders: cfg.getHeaders || (() => {
          try {
            if (this.foxEngine && this.foxEngine.auth && this.foxEngine.auth.getToken) {
              const t = this.foxEngine.auth.getToken();
              if (t) return { 'Authorization': `Bearer ${t}` };
            }
            if (typeof this.globalConfig.getAuthToken === 'function') {
              const t = this.globalConfig.getAuthToken();
              if (t) return { [this.globalConfig.authHeader || 'Authorization']: t };
            }
          } catch(_) {}
          return { 'Content-Type': 'application/json' };
        }),
        fetchOptions: cfg.fetchOptions || { credentials: 'same-origin' },
        debug: cfg.debug ?? false,
        optimisticRemoveDelayMs: cfg.optimisticRemoveDelayMs ?? 180
      },
      selectors: {
        grid: '#wishlist-grid',
        count: '#fav-count',
        clearBtn: '#clear-wishlist',
        backBtn: '#back-to-shop'
      },
      ui: {
        loadingText: 'Загрузка...',
        emptyTitle: 'Список желаемого пуст',
        emptyBody: 'Добавьте товары в избранное на странице каталога — они появятся здесь.',
        removedError: 'Ошибка при удалении из избранного',
        removeFailedRefresh: 'Не удалось удалить из избранного — обновляю список',
        cleared: 'Список избранного очищен!',
        clearConfirm: 'Очистить список избранного?',
        clearCascadeDelay: 50
      },
      debounceMs: cfg.debounceMs ?? 120,
      availabilityDebounceMs: cfg.availabilityDebounceMs ?? 40
    };

    // DOM refs (resolved on init)
    this.grid = null;
    this.countEl = null;
    this.clearBtn = null;
    this.backBtn = null;

    // timers / handlers
    this._refreshTimer = null;
    this._cartUpdateTimer = null;
    this._storageHandler = this._onStorageEvent.bind(this);
    this._cartHandler = this._onCartUpdated.bind(this);
    this._clearHandler = null;
    this._backHandler = null;
    this._gridClickHandler = null;

    this._destroyed = false;
  }

  /* ---------- logging ---------- */
  _log(...args) { if (this.config.api.debug) console.info('[Wishlist]', ...args); }
  _error(...args) { if (this.config.api.debug) console.error('[Wishlist]', ...args); }

  /* ---------- helpers ---------- */
  _normalizeIdRaw(id) {
    if (id === undefined || id === null) return '';
    if (typeof id === 'object') return String(id.id ?? id.name ?? id.productId ?? id.cartId ?? id.itemId ?? '').trim();
    return String(id).trim();
  }
  _normalizeKey(id) { return String(this._normalizeIdRaw(id)); }

  notify(text, opts = {}) {
    try {
      if (this.foxEngine && this.foxEngine.notifications && typeof this.foxEngine.notifications.show === 'function') {
        return this.foxEngine.notifications.show(text, opts);
      }
      if (this.foxEngine && this.foxEngine.shopMatic && this.foxEngine.shopMatic.notifications && typeof this.foxEngine.shopMatic.notifications.show === 'function') {
        return this.foxEngine.shopMatic.notifications.show(text, opts);
      }
    } catch (e) { this._error('notify hook failed', e); }
    if (opts.type === 'error') alert(text);
  }

  async _apiFetch(path, init = {}) {
    const base = (this.config.api.baseUrl || '/').replace(/\/$/, '');
    const url = (path && path.startsWith('http')) ? path : `${base}/${String(path).replace(/^\//, '')}`;
    const headers = Object.assign({}, (this.config.api.getHeaders ? this.config.api.getHeaders() : {}), init.headers || {});
    const merged = Object.assign({}, this.config.api.fetchOptions || {}, init, { headers });
    this._log('apiFetch', url, merged);
    const res = await fetch(url, merged);
    if (!res.ok) {
      const txt = await res.text().catch(()=>null);
      const err = new Error(`API ${res.status} ${res.statusText}${txt ? ' — ' + txt.slice(0,200) : ''}`);
      err.response = res;
      throw err;
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return await res.json();
    return await res.text();
  }

  /* ---------- DOM helpers & animations ---------- */
  _findNodesByKey(idKey) {
    if (!this.grid) return [];
    const nodes = Array.from(this.grid.querySelectorAll('[data-product-id]'));
    return nodes.filter(n => this._normalizeKey(n.getAttribute('data-product-id') || '') === this._normalizeKey(idKey));
  }

  _appleRemoveAnimation(node, opts = {}) {
    return new Promise(resolve => {
      if (!node || !node.parentNode) return resolve(false);
      try {
        if (typeof node.animate === 'function') {
          const keyframes = [
            { transform: 'scale(1) translateY(0)', opacity: 1, filter: 'blur(0px)' },
            { transform: 'scale(0.98) translateY(-6px)', opacity: 0.8, filter: 'blur(2px)', offset: 0.4 },
            { transform: 'scale(0.9) translateY(-20px)', opacity: 0, filter: 'blur(6px)' }
          ];
          const timing = { duration: opts.duration || 600, easing: opts.easing || 'cubic-bezier(.22,.61,.36,1)', fill: 'forwards' };
          const prevZ = node.style.zIndex;
          node.style.zIndex = 9999;
          const anim = node.animate(keyframes, timing);
          anim.onfinish = () => { node.style.zIndex = prevZ; node.remove(); resolve(true); };
          anim.oncancel = anim.onfinish;
          return;
        }
        node.style.transition = 'all 0.6s cubic-bezier(.22,.61,.36,1)';
        node.style.opacity = '0';
        node.style.transform = 'translateY(-20px) scale(0.9)';
        node.style.filter = 'blur(4px)';
        setTimeout(() => { try { node.remove(); } catch(_){}; resolve(true); }, 600);
      } catch (e) {
        try { node.remove(); } catch(_) {}
        resolve(true);
      }
    });
  }

  async _removeNodeElem(node) {
    if (!node || !node.parentNode) return false;
    if (node.dataset.removing === '1') return false;
    node.dataset.removing = '1';
    const ok = await this._appleRemoveAnimation(node).catch(()=>true);
    try { delete node.dataset.removing; } catch(_) {}
    // pulse counter

      if (this.countEl && typeof this.countEl.animate === 'function') {
        this.countEl.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(.2,.9,.2,1)' });
      } else if (this.countEl) {
        this.countEl.style.transition = 'transform 180ms ease';
        this.countEl.style.transform = 'scale(1.06)';
        setTimeout(()=> { if (this.countEl) this.countEl.style.transform = ''; }, 80);
      }
    return ok;
  }

  async removeNodeById(id) {
    if (!id) return;
    const key = this._normalizeKey(id);
    const nodes = this._findNodesByKey(key);
    if (!nodes.length) return;
    await Promise.all(nodes.map(n => this._removeNodeElem(n)));
    this.recalcCount();
  }

  async removeNodesByIds(ids = []) {
    const uniq = Array.isArray(ids) ? Array.from(new Set(ids.map(this._normalizeKey.bind(this)))) : [];
    const promises = [];
    for (const k of uniq) {
      const nodes = this._findNodesByKey(k);
      for (const n of nodes) promises.push(this._removeNodeElem(n));
    }
    if (promises.length) await Promise.all(promises);
    this.recalcCount();
  }

  recalcCount() {
    try {
      if (!this.countEl) return;
      if (!this.grid) { this.countEl.textContent = 'В избранном: 0'; return; }
      const cards = Array.from(this.grid.querySelectorAll('[data-product-id]'));
      const set = new Set(cards.map(c => this._normalizeKey(c.getAttribute('data-product-id') || '')));
      const n = set.size;
      this.countEl.textContent = n > 0 ? `В избранном: ${n}` : 'В избранном пусто';
    } catch (e) { this._error('recalcCount failed', e); }
  }

  normalizeFavoritesArray(arr) {
    return (Array.isArray(arr) ? arr : []).map(entry => {
      if (!entry) return null;
      if (typeof entry === 'string' || typeof entry === 'number') {
        const sid = String(entry);
        return { _missingId: sid, name: sid, fullname: sid, price: null, picture: '', stock: 0, short: 'Товар (данные отсутствуют)' };
      }
      const id = this._normalizeIdRaw(entry.name ?? entry.id ?? entry.productId ?? entry.title ?? entry.fullname ?? entry._missingId ?? '');
      return {
        _missingId: entry._missingId ?? '',
        name: id || '',
        fullname: entry.fullname ?? entry.title ?? entry.name ?? id,
        price: (entry.price != null) ? entry.price : (entry.cost != null ? entry.cost : null),
        oldPrice: entry.oldPrice ?? entry.previousPrice ?? null,
        picture: entry.picture ?? entry.image ?? entry.img ?? '',
        stock: entry.stock,
        short: entry.short ?? entry.summary ?? entry.description ?? '',
        raw: entry
      };
    }).filter(Boolean);
  }

  /* ---------- remove / optimistic remove ---------- */
  async removeFromFav(id) {
    const key = this._normalizeIdRaw(id);
    if (!key) return false;

    // shopMatic integration
    try {
      if (this.foxEngine && this.foxEngine.shopMatic && typeof this.foxEngine.shopMatic.removeFavorite === 'function') {
        await Promise.resolve(this.foxEngine.shopMatic.removeFavorite(key));
        this._log('removed via shopMatic', key);
        await this.removeNodeById(key);
        return true;
      }
    } catch (e) { this._error('shopMatic.removeFavorite failed', e); }

    // API
    if (this.config.api.enabled) {
      try {
        const path = this.config.api.endpoints.remove.replace('{id}', encodeURIComponent(key));
        try {
          await this._apiFetch(path, { method: 'DELETE' });
        } catch {
          await this._apiFetch(path, { method: 'POST', body: JSON.stringify({ id: key }) });
        }
        this._log('removed via API', key);
        await this.removeNodeById(key);
        return true;
      } catch (e) { this._error('API removeFromFav failed', e); }
    }
  }

  async optimisticRemoveUI(id, node) {
    if (!id) return;
    try {
      if (node && node.parentNode) {
        const animPromise = this._removeNodeElem(node);
        const backendPromise = this.removeFromFav(id);
        const res = await Promise.all([animPromise, backendPromise]).catch(()=>[true,false]);
        const ok = Array.isArray(res) ? Boolean(res[1]) : Boolean(res);
        if (!ok) throw new Error('remove returned false');
        this._log('optimistic remove succeeded', id);
      } else {
        const ok = await this.removeFromFav(id);
        if (!ok) {
			throw new Error('remove returned false');
		}
      }
    } catch (e) {
      this._error('optimisticRemoveUI failed', e);
      this.notify(this.config.ui.removeFailedRefresh, { type: 'error' });
      this.refresh(true);
    }
	this.recalcCount();
	this.removeFromFav(id);
  }

  /* ---------- availability refresh (cart updates) ---------- */


  _onStorageEvent(e) {
    try {
      if (!e) return;
      if (e.key !== this.config.storageKey && e.key !== null) return;
      let newIds = [];
      try {
        const raw = localStorage.getItem(this.config.storageKey);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) newIds = arr.map(String).map(s => this._normalizeKey(s));
        }
      } catch(_) { newIds = []; }

      const domIds = Array.from(this.grid ? this.grid.querySelectorAll('[data-product-id]') : []).map(c => this._normalizeKey(c.getAttribute('data-product-id') || '')).filter(Boolean);
      const toRemove = domIds.filter(d => !newIds.includes(d));
      if (toRemove.length) this.removeNodesByIds(toRemove);
      else this.refresh(true);
    } catch (e) { this._error('storage listener error', e); this.refresh(true); }
  }

  _onCartUpdated(/*ev*/) {
  }

  /* ---------- render ---------- */
	async renderGrid() {
	  const grid = this.grid;
	  if (!grid) return;

	  grid.innerHTML = '';

	  const sm = this.foxEngine.shopMatic;

	  const itemsRaw = sm.getFavorites() || [];
	  const items = Array.isArray(itemsRaw) ? itemsRaw : [];

	  const count = items.length;

	  if (this.countEl) {
		this.countEl.textContent = count
		  ? `В избранном: ${count}`
		  : 'В избранном пусто';
	  }

	  if (!count) {
		grid.innerHTML = `<div class="empty" role="status">
		  <h3>${this.config.ui.emptyTitle}</h3>
		  <p>${this.config.ui.emptyBody}</p>
		</div>`;
		return;
	  }  
	   await sm.card.renderCardList(items, grid, "VERTICAL");
	}


  /* ---------- UI helpers ---------- */
  _setButtonLoading(btn, loading) {
    if (!btn) return;
    try {
      btn.disabled = !!loading;
      if (loading) {
        btn.setAttribute('aria-busy','true');
        btn.dataset.origText = btn.innerHTML;
        btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px;"><i class="fa fa-spinner fa-spin" aria-hidden="true"></i> Обработка...</span>';
      } else {
        btn.removeAttribute('aria-busy');
        if (btn.dataset.origText) { btn.innerHTML = btn.dataset.origText; delete btn.dataset.origText; }
      }
    } catch (e) { this._error('setButtonLoading failed', e); }
  }

  decrementCount() {
    try {
      if (!this.countEl) return;
      const txt = (this.countEl.textContent || '').match(/\d+/);
      if (txt && txt[0]) {
        const v = Math.max(0, parseInt(txt[0],10)-1);
        this.countEl.textContent = v > 0 ? `В избранном: ${v}` : 'В избранном пусто';
        try {
          if (typeof this.countEl.animate === 'function') {
            this.countEl.animate([{ transform:'scale(1)' },{ transform:'scale(1.08)' },{ transform:'scale(1)'}], { duration:360, easing:'cubic-bezier(.2,.9,.2,1)' });
          }
        } catch(_) {}
      } else this.refresh(true);
    } catch (e) { this._error('decrementCount failed', e); }
  }

  /* ---------- lifecycle: init / refresh / destroy ---------- */
  init() {
    if (this._destroyed) return;
    const sel = this.config.selectors;
    this.grid = document.querySelector(sel.grid);
    this.countEl = document.querySelector(sel.count);
    this.clearBtn = document.querySelector(sel.clearBtn);
    this.backBtn = document.querySelector(sel.backBtn);

    if (this.countEl) this.countEl.textContent = this.config.ui.loadingText;

    // Clear button
    if (this.clearBtn) {
      this._clearHandler = async () => {
        if (!confirm(this.config.ui.clearConfirm)) return;
        this._setButtonLoading(this.clearBtn, true);
        const preNodes = this.grid ? Array.from(this.grid.querySelectorAll('[data-product-id]')) : [];
        try {
          if (!preNodes.length) {
            this.notify(this.config.ui.cleared, { type: 'success' });
            this._setButtonLoading(this.clearBtn, false);
            return;
          }
          const ids = Array.from(new Set(preNodes.map(n => n.getAttribute('data-product-id')))).filter(Boolean);
          const tasks = [];
          for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const node = this._findNodesByKey(id)[0];
            const delay = i * this.config.ui.clearCascadeDelay;
            const p = new Promise(res => {
              setTimeout(async () => {
                try { if (node) await this._removeNodeElem(node); await this.removeFromFav(id); res(true); } catch (e) { res(false); }
              }, delay);
            });
            tasks.push(p);
          }
          await Promise.all(tasks);
          await this.refresh(true);
          this.notify(this.config.ui.cleared, { type: 'success' });
        } catch (e) {
          this._error('clear button failed', e);
          this.notify('Не удалось очистить список избранного', { type: 'error' });
        } finally {
          this._setButtonLoading(this.clearBtn, false);
        }
      };
      this.clearBtn.addEventListener('click', this._clearHandler);
    }

    // Back button
    if (this.backBtn) {
      this._backHandler = () => { if (document.referrer) location.href = document.referrer; else history.back(); };
      this.backBtn.addEventListener('click', this._backHandler);
    }

    // storage & cart listeners
    window.addEventListener('storage', this._storageHandler);
    window.addEventListener('cart:updated', this._cartHandler);

    // delegate remove button in grid (fallback cards)
    this._gridClickHandler = (ev) => {
      const t = ev.target;
      const rem = t.closest && t.closest('[data-role="fav"], .wish-remove');
      if (rem && this.grid && this.grid.contains(rem)) {
        ev.stopPropagation();
        const card = rem.closest && rem.closest('[data-product-id]');
        const id = card ? (card.getAttribute('data-product-id') || '') : '';
        this.optimisticRemoveUI(id, card);
      }
    };
    if (this.grid) this.grid.addEventListener('click', this._gridClickHandler);
    this.refresh(true);
  }

  refresh(force = false) {
    if (this._destroyed) return;
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      this.renderGrid().catch(e => this._error('renderGrid failed', e));
    }, force ? 0 : this.config.debounceMs);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    try {
      window.removeEventListener('storage', this._storageHandler);
      window.removeEventListener('cart:updated', this._cartHandler);
      if (this.clearBtn && this._clearHandler) this.clearBtn.removeEventListener('click', this._clearHandler);
      if (this.backBtn && this._backHandler) this.backBtn.removeEventListener('click', this._backHandler);
      if (this.grid && this._gridClickHandler) this.grid.removeEventListener('click', this._gridClickHandler);
    } catch (e) { /* ignore */ }
    // clear refs & timers
    this.grid = null; this.countEl = null; this.clearBtn = null; this.backBtn = null;
    if (this._refreshTimer) { clearTimeout(this._refreshTimer); this._refreshTimer = null; }
    if (this._cartUpdateTimer) { clearTimeout(this._cartUpdateTimer); this._cartUpdateTimer = null; }
  }
}