// wishlist/FavoritesCore.js

/**
 * FavoritesCore — чистая модель избранного:
 *  - хранит список и Set для O(1) проверки
 *  - нормализует ID
 *  - умеет max/overflow
 *  - не знает ничего о storage и UI
 */
export class FavoritesCore {
  constructor({ max = 0, overflow = 'reject' } = {}) {
    this._max = Math.max(0, Number.isFinite(max) ? Math.floor(max) : 0);
    this._overflow = overflow === 'drop_oldest' ? 'drop_oldest' : 'reject';
    this._list = [];
    this._set = new Set();
  }

  /** Нормализация ID в строку */
  normalizeId(id) {
    if (id === null || id === undefined) return null;
    const candidate =
      id?.name ?? id?.id ?? id?.productId ?? id?._missingId ?? id;
    const str = String(candidate).trim();
    return str === '' ? null : str;
  }

  /** Обновить список целиком (с учётом max) */
  replaceList(arr) {
    const normalized = this.normalizeList(arr);
    let list = normalized;
    let truncated = false;

    if (this._max > 0 && normalized.length > this._max) {
      list = normalized.slice(-this._max);
      truncated = true;
    }

    this._list = list;
    this._set = new Set(list);
    return { truncated, list: this.exportToArray() };
  }

  /** Нормализовать и дедуплицировать массив ID */
  normalizeList(arr = []) {
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    const res = [];

    for (const el of arr) {
      const sid = this.normalizeId(el);
      if (sid && !seen.has(sid)) {
        seen.add(sid);
        res.push(sid);
      }
    }
    return res;
  }

  /** Есть ли ID в избранном */
  isFavorite(id) {
    const sid = this.normalizeId(id);
    if (!sid) return false;
    return this._set.has(sid);
  }

  has(id) {
    return this.isFavorite(id);
  }

  /** Добавить ID в избранное */
  add(id) {
    const sid = this.normalizeId(id);
    if (!sid) {
      return { ok: false, reason: 'invalid_id', id: sid };
    }
    if (this._set.has(sid)) {
      return { ok: false, reason: 'exists', id: sid };
    }

    if (this._max > 0 && this._list.length >= this._max) {
      if (this._overflow === 'drop_oldest') {
        const removed = this._list.shift();
        if (removed !== undefined) this._set.delete(removed);
      } else {
        return { ok: false, reason: 'limit_reached', id: sid };
      }
    }

    this._list.push(sid);
    this._set.add(sid);
    return { ok: true, reason: null, id: sid };
  }

  /** Удалить ID из избранного */
  remove(id) {
    const sid = this.normalizeId(id);
    if (!sid || !this._set.has(sid)) {
      return { ok: false, reason: 'not_found', id: sid };
    }

    this._list = this._list.filter(x => x !== sid);
    this._set.delete(sid);
    return { ok: true, reason: null, id: sid };
  }

  /** Переключить статус избранного */
  toggle(id) {
    if (this.isFavorite(id)) {
      const res = this.remove(id);
      return { ...res, action: 'remove' };
    }
    const res = this.add(id);
    if (!res.ok && res.reason === 'limit_reached') {
      return { ...res, action: 'limit' };
    }
    return { ...res, action: 'add' };
  }

  /** Очистить всё избранное */
  clear() {
    if (!this._list.length) {
      return { ok: false, reason: 'already_empty' };
    }
    this._list = [];
    this._set.clear();
    return { ok: true, reason: null };
  }

  /** Импорт массива ID */
  importFromArray(arr = [], { replace = false } = {}) {
    const normalized = this.normalizeList(arr);

    if (replace) {
      const { truncated, list } = this.replaceList(normalized);
      return { ok: true, truncated, list };
    }

    let changed = false;
    for (const sid of normalized) {
      if (this._set.has(sid)) continue;

      if (this._max > 0 && this._list.length >= this._max) {
        if (this._overflow === 'drop_oldest') {
          const removed = this._list.shift();
          if (removed !== undefined) this._set.delete(removed);
        } else {
          continue;
        }
      }

      this._list.push(sid);
      this._set.add(sid);
      changed = true;
    }

    return { ok: true, truncated: false, changed, list: this.exportToArray() };
  }

  /** Вернуть массив ID */
  exportToArray() {
    return [...this._list];
  }

  /** Кол-во избранных */
  getCount() {
    return this._list.length;
  }

  /** Итератор по ID */
  [Symbol.iterator]() {
    return this._list[Symbol.iterator]();
  }

  /** Set со всеми ID */
  toSet() {
    return new Set(this._set);
  }
}
