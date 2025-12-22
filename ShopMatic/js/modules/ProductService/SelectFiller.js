// ProductService/SelectFiller.js

export class SelectFiller {
  /**
   * @param {ProductBackend} backend
   * @param {ProductCache} cache
   * @param {(key:string, vars?:Record<string,string|number>) => string} msgFn
   */
  constructor(backend, cache, msgFn) {
    this.backend = backend;
    this.cache = cache;
    this._msg = msgFn;
  }

  _normalizeId(v) {
    if (v === undefined || v === null) return '';
    return String(v).trim();
  }

  async _fetchList(entity) {
    try {
      return await this.backend.fetchList(entity);
    } catch (e) {
      console.debug(`SelectFiller.fetchList(${entity}) failed`, e);
      return [];
    }
  }

  /**
   * Универсальный наполнитель select.
   */
  async fillSelectGeneric(
    selectEl,
    {
      entity = 'categories',
      productProp = 'category',
      includeAllOption = true,
      onlyFromProducts = false,
      sort = true,
      allMsgKey = 'ALL_CATEGORIES_OPTION',
      selected = ''
    } = {}
  ) {
    if (typeof selectEl === 'string') {
      selectEl = document.querySelector(selectEl);
    }
    if (!selectEl) return false;

    const slug = (str) => String(str).toLowerCase().replace(/\s+/g, '');
    const collected = new Map();

    const add = (id, name, fullname) => {
      const safeName =
        name && name.toLowerCase() !== 'undefined' ? name : '';
      const safeFullname =
        fullname && fullname.toLowerCase() !== 'undefined'
          ? fullname
          : '';
      const human = safeFullname || safeName || id;
      if (!human) return;
      const key = slug(human);
      const entry = collected.get(key) || { id: '', name: '', fullname: '' };
      if (!entry.id && id) entry.id = id;
      if (!entry.name && safeName) entry.name = safeName;
      if (!entry.fullname && safeFullname) entry.fullname = safeFullname;
      collected.set(key, entry);
    };

    // 1) список с бэкенда
    if (!onlyFromProducts) {
      const list = await this._fetchList(entity);
      for (const it of list) {
        if (!it) continue;
        if (typeof it === 'string') {
          add(it, it, it);
        } else {
          const id = this._normalizeId(it.id ?? it.key ?? it.name);
          const name = it.name != null ? String(it.name).trim() : '';
          const fullname =
            it.fullname != null ? String(it.fullname).trim() : '';
          add(id, name, fullname);

          const nm =
            fullname && fullname.toLowerCase() !== 'undefined'
              ? fullname
              : name;

          if (entity === 'brands' && id && nm) {
            this.cache._setCache(this.cache.brandsMap, id, nm, false);
          }
          if (entity === 'categories' && id && nm) {
            this.cache._setCache(this.cache.categoriesMap, id, nm, false);
          }
        }
      }
    }

    // 2) данные из products
    for (const p of this.cache.products) {
      const id = this._normalizeId(p[productProp]);
      const name =
        p[`${productProp}Name`] != null
          ? String(p[`${productProp}Name`]).trim()
          : '';
      const fullname =
        p[`${productProp}Fullname`] != null
          ? String(p[`${productProp}Fullname`]).trim()
          : '';
      add(id, name, fullname);

      const nm =
        fullname && fullname.toLowerCase() !== 'undefined'
          ? fullname
          : name;

      if (entity === 'brands' && id && nm) {
        this.cache._setCache(this.cache.brandsMap, id, nm, false);
      }
      if (entity === 'categories' && id && nm) {
        this.cache._setCache(this.cache.categoriesMap, id, nm, false);
      }
    }

    let rows = Array.from(collected.values());
    if (sort) {
      rows.sort((a, b) =>
        String(a.fullname || a.name).localeCompare(
          String(b.fullname || b.name)
        )
      );
    }

    selectEl.innerHTML = '';

    if (includeAllOption) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = this._msg(allMsgKey);

      if (selected === '' || selected == null) {
        opt.selected = true;
      }

      selectEl.appendChild(opt);
    }

    for (const r of rows) {
      const o = document.createElement('option');
      o.value = r.name;
      if (r.id) o.dataset.id = r.id;
      if (r.fullname && r.fullname.toLowerCase() !== 'undefined') {
        o.dataset.fullname = r.fullname;
      }
      o.dataset.name = r.name || '';
      o.textContent = r.fullname || r.name || r.id;

      if (selected !== '' && String(o.value) === String(selected)) {
        o.selected = true;
      }

      selectEl.appendChild(o);
    }

    return true;
  }

  fillCategories(selectEl, opts = {}) {
    return this.fillSelectGeneric(
      selectEl,
      Object.assign(
        {
          entity: 'categories',
          productProp: 'category',
          allMsgKey: 'ALL_CATEGORIES_OPTION'
        },
        opts
      )
    );
  }

  fillBrands(selectEl, opts = {}) {
    return this.fillSelectGeneric(
      selectEl,
      Object.assign(
        {
          entity: 'brands',
          productProp: 'brand',
          allMsgKey: 'ALL_BRANDS_OPTION'
        },
        opts
      )
    );
  }
}
