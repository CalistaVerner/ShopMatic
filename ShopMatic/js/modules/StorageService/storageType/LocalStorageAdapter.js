// StorageService/storageType/LocalStorageAdapter.js

import { BaseStorage } from '../BaseStorage.js';

// Адаптер вокруг window.localStorage (можно заменить на sessionStorage, IndexedDB и т.п.)
export class LocalStorageAdapter extends BaseStorage {
  constructor() {
    super(typeof localStorage !== 'undefined' ? localStorage : null);
  }
}
