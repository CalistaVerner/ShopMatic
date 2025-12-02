/**
 * RecipientAddressStorage (v2+) — расширенная и безопасная версия
 *
 * Хранит структуру:
 * {
 *   version: 2,
 *   recipients: [...],
 *   addresses: [...],
 *   selected: { recipientId: null, addressId: null }
 * }
 */
export class RecipientAddressStorage {
  constructor(storageKey) {
    if (!storageKey || typeof storageKey !== "string") {
      throw new Error("RecipientAddressStorage: storageKey must be a non-empty string");
    }

    this.storageKey = storageKey;
    this._cache = null;
    // subscribers: Set of {fn, events?: Set}
    this._subscribers = new Set();
    this._persisting = false;
  }

  /* ======================
     LOW-LEVEL STORAGE
  ======================= */

_ensureLoaded() {
  if (this._cache) return;

  try {
    const raw = localStorage.getItem(this.storageKey);
    const parsed = raw ? JSON.parse(raw) : null;

    if (parsed && typeof parsed === "object") {
      // handle old formats gracefully: attempt to migrate common shapes
      if (Array.isArray(parsed) && parsed.every(p => p && typeof p === "object" && 'name' in p)) {
        this._cache = { version: 2, recipients: parsed, addresses: [], selected: { recipientId: null, addressId: null }, deliveryOptions: {} };
        this._safeSave();
        return;
      }

      // If object has recipients & addresses already
      if (Array.isArray(parsed.recipients) || Array.isArray(parsed.addresses)) {
        this._cache = {
          version: parsed.version || 2,
          recipients: Array.isArray(parsed.recipients) ? parsed.recipients : [],
          addresses: Array.isArray(parsed.addresses) ? parsed.addresses : [],
          selected: parsed.selected && typeof parsed.selected === 'object'
            ? { recipientId: parsed.selected.recipientId || null, addressId: parsed.selected.addressId || null }
            : { recipientId: null, addressId: null },
          deliveryOptions: parsed.deliveryOptions || {} // Ensure deliveryOptions is set
        };
        return;
      }
    }

    // Otherwise invalid
    throw new Error("Invalid structure");
  } catch {
    // Самовосстановление — чистая структура
    this._cache = { version: 2, recipients: [], addresses: [], selected: { recipientId: null, addressId: null }, deliveryOptions: {} };
    this._safeSave();
  }
}


_safeSave(metaEvent = "save", payload = null) {
  if (!this._cache) return;

  try {
    // Check if localStorage is available
    if (typeof localStorage === 'undefined') {
      console.warn('localStorage is not available');
      return;
    }

    // Avoid re-entrant saving storms
    if (this._persisting) {
      // Schedule next tick save to avoid a potential infinite loop
      setTimeout(() => this._safeSave(metaEvent, payload), 50);
      return;
    }

    this._persisting = true;

    // Preprocess the _cache to handle Date objects and other potential issues
    const processedCache = this._processCacheBeforeSave(this._cache);

    // Validate data before saving
    const dataToSave = JSON.stringify(processedCache);
    if (!dataToSave) {
      throw new Error('Failed to serialize cache data');
    }

    // Attempt to save to localStorage
    localStorage.setItem(this.storageKey, dataToSave);

  } catch (e) {
    console.error("RecipientAddressStorage: failed to save", e);

    // Optionally, you could implement fallback storage, like sessionStorage
    // sessionStorage.setItem(this.storageKey, JSON.stringify(this._cache));
  } finally {
    this._persisting = false;
    // Always notify after attempting save; pass meta info
    this._notify(metaEvent, payload);
  }
}

/**
 * Preprocess the cache before saving to handle potential issues.
 * For example, converting Date objects to string.
 */
_processCacheBeforeSave(cache) {
  // Clone cache to prevent mutation
  const cacheClone = JSON.parse(JSON.stringify(cache));

  // Handle Date fields: convert them to ISO string
  const convertDates = (obj) => {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        if (obj[key] instanceof Date) {
          obj[key] = obj[key].toISOString();  // Convert Date to ISO string
        } else if (typeof obj[key] === "object" && obj[key] !== null) {
          // Recursively handle nested objects
          convertDates(obj[key]);
        }
      }
    }
  };

  convertDates(cacheClone); // Convert all dates in the cache

  return cacheClone;
}



  /**
   * Notify subscribers.
   * Each subscriber callback receives (stateClone, meta).
   * For backward compatibility callbacks that accept zero args still work.
   */
  _notify(eventType = "change", payload = null) {
    const snapshot = this._clone(this._cache);
    for (const sub of Array.from(this._subscribers)) {
      try {
        // If subscriber has event filter, skip non-matching
        if (sub.events && sub.events.size && !sub.events.has(eventType)) continue;
        // Call with both args (backwards-compatible)
        sub.fn(snapshot, { type: eventType, payload });
      } catch (e) {
        // swallow subscriber errors
        /* eslint-disable no-empty */
      }
    }
  }

  /**
   * Subscribe to all changes or to specific event types.
   * callback(stateClone, meta)
   * options = { events: ['added:recipient','selected:address'] }
   * Returns unsubscribe function.
   */
  subscribe(callback, options = {}) {
    if (typeof callback !== "function") return () => {};
    const sub = { fn: callback, events: null };
    if (options && Array.isArray(options.events) && options.events.length) {
      sub.events = new Set(options.events);
    }
    this._subscribers.add(sub);
    // return unsubscribe
    return () => this._subscribers.delete(sub);
  }

  /* ======================
     HELPERS
  ======================= */

  _clone(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      // fallback shallow clone
      return Array.isArray(obj) ? obj.slice() : Object.assign({}, obj);
    }
  }

  _generateId(prefix = "id") {
    return `${prefix}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }

  _normalizeRecipient(data = {}) {
    return {
      id: data.id || this._generateId("rcp"),
      name: String(data.name || "").trim(),
      phone: String(data.phone || "").trim(),
      comment: String(data.comment || "").trim(),
      // extension point for UI flags
      label: data.label || null,
      meta: data.meta || {}
    };
  }

  _normalizeAddress(data = {}) {
    return {
      id: data.id || this._generateId("addr"),
      street: String(data.street || "").trim(),
      house: String(data.house || "").trim(),
      entrance: String(data.entrance || "").trim(),
      floor: String(data.floor || "").trim(),
      flat: String(data.flat || "").trim(),
      city: String(data.city || "").trim(),
      label: data.label || null,
      meta: data.meta || {}
    };
  }

  _validateRecipient(r) {
    return r && typeof r.name === "string" && r.name.trim().length >= 2;
  }

  _validateAddress(a) {
    return a && typeof a.street === "string" && a.street.trim().length >= 1;
  }

  _find(list, id) {
    if (!Array.isArray(list)) return null;
    return list.find((x) => x && x.id === id) || null;
  }

  _updateDeep(target, patch) {
    for (const key of Object.keys(patch)) {
      if (patch[key] && typeof patch[key] === "object" && !Array.isArray(patch[key])) {
        if (!target[key]) target[key] = {};
        this._updateDeep(target[key], patch[key]);
      } else {
        target[key] = patch[key];
      }
    }
    return target;
  }

  /* ======================
     RECIPIENT API
  ======================= */

  addRecipient(data) {
    this._ensureLoaded();
    const record = this._normalizeRecipient(data);
    if (!this._validateRecipient(record)) {
      throw new Error("Invalid recipient data");
    }
    this._cache.recipients.push(record);
    // notify added
    this._safeSave("added:recipient", this._clone(record));

    // Если ещё нет выбранного получателя — выбираем этот автоматически
    try {
      if (!this._cache.selected) this._cache.selected = { recipientId: null, addressId: null };
      if (!this._cache.selected.recipientId) {
        this._cache.selected.recipientId = record.id;
        // дважды сохраняем: уже сохранен added, теперь selected
        this._safeSave("selected:recipient", this._clone(record));
      }
    } catch (e) {
      console.warn("auto-select on addRecipient failed", e);
    }

    return this._clone(record);
  }

  upsertRecipient(data) {
    this._ensureLoaded();
    if (!data || typeof data !== "object") throw new Error("Invalid data");
    if (data.id) {
      const existing = this._find(this._cache.recipients, data.id);
      if (existing) {
        const patch = this._normalizeRecipient(data);
        // keep id from existing
        patch.id = existing.id;
        this._updateDeep(existing, patch);
        if (!this._validateRecipient(existing)) throw new Error("Invalid recipient after update");
        this._safeSave("updated:recipient", this._clone(existing));
        return this._clone(existing);
      }
    }
    return this.addRecipient(data);
  }

  getRecipients() {
    this._ensureLoaded();
    return this._clone(this._cache.recipients);
  }

  getRecipient(id) {
    this._ensureLoaded();
    return this._clone(this._find(this._cache.recipients, id));
  }

  updateRecipient(id, patch) {
    this._ensureLoaded();
    const item = this._find(this._cache.recipients, id);
    if (!item) return false;
    this._updateDeep(item, patch || {});
    if (!this._validateRecipient(item)) return false;
    this._safeSave("updated:recipient", this._clone(item));
    return true;
  }

  removeRecipient(id) {
    this._ensureLoaded();
    const existed = !!this._find(this._cache.recipients, id);
    this._cache.recipients = this._cache.recipients.filter((r) => r.id !== id);
    // clear selection if removed
    if (this._cache.selected && this._cache.selected.recipientId === id) {
      this._cache.selected.recipientId = null;
      this._safeSave("removed:recipient", { id });
      this._safeSave("selected:recipient", null);
      return;
    }
    if (existed) this._safeSave("removed:recipient", { id });
  }

  /* ======================
     ADDRESS API
  ======================= */

 addAddress(data) {
    this._ensureLoaded();
    const record = this._normalizeAddress(data);
    if (!this._validateAddress(record)) {
      throw new Error("Invalid address data");
    }
    this._cache.addresses.push(record);
    this._safeSave("added:address", this._clone(record));

    // Если ещё нет выбранного адреса — выбираем этот автоматически
    try {
      if (!this._cache.selected) this._cache.selected = { recipientId: null, addressId: null };
      if (!this._cache.selected.addressId) {
        this._cache.selected.addressId = record.id;
        this._safeSave("selected:address", this._clone(record));
      }
    } catch (e) {
      console.warn("auto-select on addAddress failed", e);
    }

    return this._clone(record);
  }

  upsertAddress(data) {
    this._ensureLoaded();
    if (!data || typeof data !== "object") throw new Error("Invalid data");
    if (data.id) {
      const existing = this._find(this._cache.addresses, data.id);
      if (existing) {
        const patch = this._normalizeAddress(data);
        patch.id = existing.id;
        this._updateDeep(existing, patch);
        if (!this._validateAddress(existing)) throw new Error("Invalid address after update");
        this._safeSave("updated:address", this._clone(existing));
        return this._clone(existing);
      }
    }
    return this.addAddress(data);
  }

  getAddresses() {
    this._ensureLoaded();
    return this._clone(this._cache.addresses);
  }

  getAddress(id) {
    this._ensureLoaded();
    return this._clone(this._find(this._cache.addresses, id));
  }

  updateAddress(id, patch) {
    this._ensureLoaded();
    const item = this._find(this._cache.addresses, id);
    if (!item) return false;
    this._updateDeep(item, patch || {});
    if (!this._validateAddress(item)) return false;
    this._safeSave("updated:address", this._clone(item));
    return true;
  }

  removeAddress(id) {
    this._ensureLoaded();
    const existed = !!this._find(this._cache.addresses, id);
    this._cache.addresses = this._cache.addresses.filter((a) => a.id !== id);
    // clear selection if removed
    if (this._cache.selected && this._cache.selected.addressId === id) {
      this._cache.selected.addressId = null;
      this._safeSave("removed:address", { id });
      this._safeSave("selected:address", null);
      return;
    }
    if (existed) this._safeSave("removed:address", { id });
  }

  /* ======================
     SELECTION API
  ======================= */

	getSelectedRecipient(selectedId = "") {
	  this._ensureLoaded(); // Загружаем данные, если они не были загружены
	  const id = this._cache.selected?.recipientId || selectedId; // Используем выбранный id или переданный
	  if (!id) return null; // Если нет id, возвращаем null

	  // Проверка существования получателя по id
	  const rec = this._find(this._cache.recipients, String(id)); // Приводим id к строковому типу
	  if (!rec) {
		// Если не нашли — очищаем выбранного получателя
		this._cache.selected.recipientId = null;
		this._safeSave("selected:recipient", null);
		return null;
	  }
	  return this._clone(rec); // Возвращаем выбранного получателя
	}


  getSelectedAddress(selectedId = "") {
    this._ensureLoaded();
    const id = this._cache.selected?.addressId || selectedId;
    if (!id) return null;
    const addr = this._find(this._cache.addresses, id);
    if (!addr) {
      this._cache.selected.addressId = null;
      this._safeSave("selected:address", null);
      return null;
    }
    return this._clone(addr);
  }

selectRecipient(id) {
  this._ensureLoaded();
  if (id === null) {
    this._cache.selected.recipientId = null;
    this._safeSave("selected:recipient", null);
    return null;
  }
  const found = this._find(this._cache.recipients, id);
  if (!found) {
    console.warn("RecipientAddressStorage: selectRecipient — id not found", id);
    return null;
  }
  this._cache.selected.recipientId = found.id;
  this._safeSave("selected:recipient", this._clone(found)); // Сохраняем выбранного получателя
  return this._clone(found); // Возвращаем выбранного получателя
}


  selectAddress(id) {
    this._ensureLoaded();
    if (id === null) {
      this._cache.selected.addressId = null;
      this._safeSave("selected:address", null);
      return null;
    }
    const found = this._find(this._cache.addresses, id);
    if (!found) {
      console.warn("RecipientAddressStorage: selectAddress — id not found", id);
      return null;
    }
    this._cache.selected.addressId = found.id;
    this._safeSave("selected:address", this._clone(found));
    return this._clone(found);
  }

  clearSelection() {
    this._ensureLoaded();
    this._cache.selected.recipientId = null;
    this._cache.selected.addressId = null;
    this._safeSave("selected:cleared", null);
  }

  /* ======================
     EXTRA CONVENIENCE
  ======================= */

  hasAny() {
    this._ensureLoaded();
    return this._cache.recipients.length > 0 || this._cache.addresses.length > 0;
  }

  findRecipientsByName(query) {
    this._ensureLoaded();
    const q = String(query || "").trim().toLowerCase();
    if (!q) return this._clone(this._cache.recipients);
    return this._clone(this._cache.recipients.filter(r =>
      String(r.name || "").toLowerCase().includes(q)
    ));
  }

  findAddress(query) {
    this._ensureLoaded();
    const q = String(query || "").trim().toLowerCase();
    if (!q) return this._clone(this._cache.addresses);
    return this._clone(this._cache.addresses.filter(a =>
      (String(a.street || "") + " " + String(a.house || "")).toLowerCase().includes(q)
    ));
  }

  sortRecipientsByName() {
    this._ensureLoaded();
    this._cache.recipients.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    this._safeSave("sorted:recipients", null);
  }

  sortAddressesByStreet() {
    this._ensureLoaded();
    this._cache.addresses.sort((a, b) =>
      String(a.street || "").localeCompare(String(b.street || ""))
    );
    this._safeSave("sorted:addresses", null);
  }

  getAddressesByLabel(label) {
    this._ensureLoaded();
    return this._clone(this._cache.addresses.filter(a => a.label === label));
  }

  getRecipientsByLabel(label) {
    this._ensureLoaded();
    return this._clone(this._cache.recipients.filter(r => r.label === label));
  }

  getAll() {
    this._ensureLoaded();
    return this._clone(this._cache);
  }

  export() {
    this._ensureLoaded();
    try {
      return JSON.stringify(this._cache);
    } catch {
      return null;
    }
  }

  /**
   * Import JSON. options: { merge: true|false } (merge by id when possible)
   */
  import(jsonString, options = { merge: false }) {
    if (!jsonString || typeof jsonString !== "string") throw new Error("Invalid import payload");
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      throw new Error("Failed to parse import JSON");
    }

    this._ensureLoaded();

    if (!options.merge) {
      // replace entirely, but normalize shape
      const recipients = Array.isArray(parsed.recipients) ? parsed.recipients.map(p => this._normalizeRecipient(p)) : [];
      const addresses = Array.isArray(parsed.addresses) ? parsed.addresses.map(a => this._normalizeAddress(a)) : [];
      this._cache = { version: 2, recipients, addresses, selected: { recipientId: null, addressId: null } };
      this._safeSave("import:replace", null);
      return;
    }

    // merge: try to upsert by id or append
    const incomingRecipients = Array.isArray(parsed.recipients) ? parsed.recipients : [];
    const incomingAddresses = Array.isArray(parsed.addresses) ? parsed.addresses : [];

    for (const r of incomingRecipients) {
      try { this.upsertRecipient(r); } catch {}
    }
    for (const a of incomingAddresses) {
      try { this.upsertAddress(a); } catch {}
    }

    // if import had selected keys, adopt them if exist
    if (parsed.selected && typeof parsed.selected === 'object') {
      if (parsed.selected.recipientId && this._find(this._cache.recipients, parsed.selected.recipientId)) {
        this._cache.selected.recipientId = parsed.selected.recipientId;
        this._safeSave("selected:recipient", this.getRecipient(parsed.selected.recipientId));
      }
      if (parsed.selected.addressId && this._find(this._cache.addresses, parsed.selected.addressId)) {
        this._cache.selected.addressId = parsed.selected.addressId;
        this._safeSave("selected:address", this.getAddress(parsed.selected.addressId));
      }
    }

    this._safeSave("import:merge", null);
  }
  
  setDeliveryOptions(options) {
	  this._ensureLoaded();
	  this._cache.deliveryOptions = options;
	  this._safeSave("updated:deliveryOptions", options);
	}

	getDeliveryOptions() {
	  this._ensureLoaded();
	  return this._cache.deliveryOptions || {};
	}


  clearAll() {
    this._cache = { version: 2, recipients: [], addresses: [], selected: { recipientId: null, addressId: null } };
    this._safeSave("cleared", null);
  }
}