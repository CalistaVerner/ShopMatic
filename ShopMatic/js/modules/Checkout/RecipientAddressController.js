import { escapeHtml } from "../utils.js";
import { ListButtonUpdater } from "./ListButtonUpdater.js";

/**
 * RecipientAddressController
 *
 * Контроллер для выбора и редактирования получателей и адресов.
 * Использует конфигурационный объект, чтобы избежать ветвлений по типу,
 * и обеспечивает общую логику рендера и взаимодействия.
 */
export class RecipientAddressController {
  constructor({ storage, foxEngine, view }) {
    if (!storage) throw new Error('RecipientAddressController: storage is required');
    this.storage = storage;
    this.foxEngine = foxEngine;
    this.view = view;

    // Объект для хранения текущих элементов, вместо отдельных свойств
    this.current = { recipient: null, address: null };
	//this.eventBus = new EventBus();

    // UID для изоляции разметки
    this._uid = 'rac-' + Math.random().toString(36).slice(2, 8);

    // Вспомогательные структуры
    this._mounted = new WeakMap();
    this._pendingClose = new Map();
    this._scheduledRenders = new WeakMap();
    this._RENDER_DEBOUNCE_MS = 80;

    // Инстанс обновлятора кнопок
    this.listButtonUpdater = new ListButtonUpdater(this.storage, this._uid);

    // Конфигурация модальных окон
    this._modalConfig = {
      recipient: {
        title: 'Выбор получателя',
        emptyMessage: 'Получателей пока нет',
        listKey: 'getRecipients',
        getItem: (id) => this.storage.getRecipient(id),
        addItem: (payload) => this.storage.addRecipient(payload),
        updateItem: (id, data) => this.storage.updateRecipient(id, data),
        removeItem: (id) => this.storage.removeRecipient(id),
        selectItem: (id) => this.storage.selectRecipient(id),
        apply: (item) => this.apply('recipient', item),
        fields: [
          { name: 'name', label: 'Имя', inputId: 'recipientNameInput', fieldPlaceholder: 'Получатель: ' },
          { name: 'phone', label: 'Телефон', inputId: 'recipientPhoneInput', fieldPlaceholder: 'Телефон: ' },
          { name: 'comment', label: 'Комментарий', inputId: 'recipientCommentInput', fieldPlaceholder: 'Комментарий: ' }
        ],
        validate: (data) => (!data.name || data.name.trim().length < 2 ? 'Имя должно содержать минимум 2 символа' : null),
        addLabel: 'получателя'
      },
      address: {
        title: 'Выбор адреса',
        emptyMessage: 'Адреса пока нет',
        listKey: 'getAddresses',
        getItem: (id) => this.storage.getAddress(id),
        addItem: (payload) => this.storage.addAddress(payload),
        updateItem: (id, data) => this.storage.updateAddress(id, data),
        removeItem: (id) => this.storage.removeAddress(id),
        selectItem: (id) => this.storage.selectAddress(id),
        apply: (item) => this.apply('address', item),
        fields: [
          { name: 'street',   label: 'Улица',    inputId: 'addressStreetInput',   fieldPlaceholder: 'ул. ' },
          { name: 'house',    label: 'Дом',      inputId: 'addressHouseInput',    fieldPlaceholder: 'д. ' },
          { name: 'entrance', label: 'Подъезд',  inputId: 'addressEntranceInput', fieldPlaceholder: 'Подъезд: ' },
          { name: 'floor',    label: 'Этаж',     inputId: 'addressFloorInput',    fieldPlaceholder: 'Этаж: ' },
          { name: 'flat',     label: 'Квартира', inputId: 'addressFlatInput',     fieldPlaceholder: 'Квартира: ' },
          { name: 'city',     label: 'Город',    inputId: 'addressCityInput',     fieldPlaceholder: 'Город: ' },
          { name: 'label',    label: 'Метка',    inputId: 'addressLabelInput',    fieldPlaceholder: 'Метка: ' }
        ],
        validate: (data) => (!data.street || data.street.trim().length < 1 ? 'Укажите улицу' : null),
        addLabel: 'адрес'
      }
    };
  }

  /* ======== Геттеры и сеттеры для обратной совместимости ======== */

  get currentRecipient() { return this.current.recipient; }
  set currentRecipient(val) { this.current.recipient = val; }

  get currentAddress() { return this.current.address; }
  set currentAddress(val) { this.current.address = val; }

  /* ======== Вспомогательные методы ======== */

  // Делает первую букву строки заглавной: 'recipient' -> 'Recipient'
  _capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /* ======== Публичный API ======== */

  openModal(type) {
    const cfg = this._modalConfig[type];
    if (!cfg) return;
    const html   = this._wrapHtml(this._buildModalInner(type, cfg));
    const rootId = `${this._uid}-${type}-modal`;
    this._showModalSafe(html, rootId, cfg.title, (root) => {
      this._mountModal(root, type, cfg);
    });
  }

  openRecipientModal() {
    this.openModal('recipient');
  }

  openAddressModal() {
    this.openModal('address');
  }


  /**
   * Унифицированный метод apply: сохраняет текущий элемент для типа,
   * вызывает метод вью для отображения данных и обновляет кнопки.
   */
  apply(type, item) {
    this.current[type] = item;
    const viewMethod = type === 'recipient' ? 'fillRecipient' : 'fillAddress';
    if (this.view[viewMethod]) {
      try {
        this.view[viewMethod](item);
      } catch {
        /* ignore */
      }
    }
    const root = document.getElementById(`${this._uid}-${type}-modal`);
    if (root) this.listButtonUpdater.updateListButtons(root, type);

    // Генерация события после применения изменений
    //this.eventBus.emit(`${type}Updated`, item); // Событие обновления получателя или адреса
  }


  /* ======== Внутренние методы ======== */

  _wrapHtml(inner) {
    return `<div class="modal-body">${inner}</div>`;
  }

  /**
   * Построение внутренней HTML-структуры модального окна по типу и конфигурации.
   */
  _buildModalInner(type, cfg) {
    const capType = this._capitalize(type);
    const fieldsHtml = cfg.fields
      .map(
        (field) => `
      <div class="form-section">
        <label for="${this._uid}-${field.inputId}" class="ui-label">${field.label}</label>
        <input id="${this._uid}-${field.inputId}" class="ui-input" autocomplete="off" placeholder="${field.fieldPlaceholder || ''}" />
      </div>
    `
      )
      .join('');
    return `
      <div id="${this._uid}-${type}-modal" class="form-root" role="dialog" aria-modal="true" aria-label="${cfg.title}">
        <h2 class="form-title">${cfg.title}</h2>
        <div id="${this._uid}-${type}-list" class="item-list ${type}-list" tabindex="0"></div>
        <div class="form-actions">
          <button id="${this._uid}-add${capType}Btn" class="btn btn-primary" type="button">Добавить ${cfg.addLabel}</button>
        </div>
        <div id="${this._uid}-${type}-form" class="form-embedded" aria-hidden="true">
          <h3 id="${this._uid}-${type}-form-title" class="form-subtitle">Добавить ${cfg.addLabel}</h3>
          ${fieldsHtml}
          <div id="${this._uid}-${type}-error" class="ui-error" aria-live="polite"></div>
          <div class="form-actions row">
            <button id="${this._uid}-save${capType}Btn" class="btn btn-primary" type="button">Сохранить</button>
            <button id="${this._uid}-cancel${capType}Btn" class="btn btn-secondary" type="button">Отмена</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Безопасно отображает модальное окно: делегирует foxEngine.modalApp, если доступен,
   * иначе вставляет HTML напрямую в документ.
   */
  _showModalSafe(html, rootId, title, onAttached) {
    try {
      let attached = false;
      const closeCallback = () => {
        try {
          const root = document.getElementById(rootId);
          if (root) {
            const cleanup = this._mounted.get(root);
            if (typeof cleanup === 'function') cleanup();
            root.remove();
            this._mounted.delete(root);
          } else {
            this._pendingClose.set(rootId, true);
          }
        } catch (err) {
          console.error('Ошибка при закрытии модала:', err);
        }
      };
      const existingModal = document.getElementById(rootId);
      if (existingModal) existingModal.remove();
      if (this.foxEngine?.modalApp?.showModalApp) {
        try {
          this.foxEngine.modalApp.showModalApp('100%', title, html, closeCallback);
		  /**
		   * TEST WIP TMP
		  */
		  
		  //this.eventBus.on('modalBuilt', (data) => {
		  //console.log(data);
		  //onAttached(data);
		  //});
          setTimeout(() => {
            const root = document.getElementById(rootId);
            if (root && !attached) {
              attached = true;
              onAttached(root);
            }
          }, 10);
        } catch (err) {
          console.warn('modalApp.showModalApp не удался, пробуем fallback', err);
          document.body.insertAdjacentHTML('beforeend', html);
        }
      } else {
        document.body.insertAdjacentHTML('beforeend', html);
      }
	  //this.eventBus.emit('modalBuilt', html);
    } catch (e) {
      console.warn('modalApp недоступен, fallback injection', e);
      document.body.insertAdjacentHTML('beforeend', html);
      const root = document.getElementById(rootId);
      if (root) {
        if (this._pendingClose.get(rootId)) {
          this._pendingClose.delete(rootId);
          try {
            root.remove();
          } catch {}
          return;
        }
        onAttached(root);
      }
    }
  }

  /**
   * Монтирует модальное окно: назначает обработчики событий и реализует
   * поведение для соответствующего типа.
   */
  _mountModal(root, type, cfg) {
    const capType   = this._capitalize(type);
    const listId    = `${this._uid}-${type}-list`;
    const addBtnId  = `${this._uid}-add${capType}Btn`;
    const formId    = `${this._uid}-${type}-form`;
    const titleId   = `${this._uid}-${type}-form-title`;
    const errorId   = `${this._uid}-${type}-error`;
    const saveBtnId = `${this._uid}-save${capType}Btn`;
    const cancelBtnId = `${this._uid}-cancel${capType}Btn`;

    const listContainer = root.querySelector(`#${listId}`);
    const addBtn    = root.querySelector(`#${addBtnId}`);
    const formRoot  = root.querySelector(`#${formId}`);
    const formTitle = root.querySelector(`#${titleId}`);
    const errorEl   = root.querySelector(`#${errorId}`);
    const saveBtn   = root.querySelector(`#${saveBtnId}`);
    const cancelBtn = root.querySelector(`#${cancelBtnId}`);

    let activeEditingId = null;

    // Рендер списка элементов
    const render = () => {
      const list = this.storage[cfg.listKey]() || [];
      if (!list.length) {
        listContainer.innerHTML = `<div class="empty">${cfg.emptyMessage}</div>`;
      } else {
        listContainer.innerHTML = list.map((r) => this._makeItemHtml(type, r)).join('');
      }
      this.listButtonUpdater.updateListButtons(root, type);
    };

    // Показать форму (для добавления/редактирования)
    const showForm = (item = null) => {
      activeEditingId = item?.id || '';
      formTitle.textContent = item
        ? `Изменить ${cfg.addLabel}`
        : `Добавить ${cfg.addLabel}`;
      cfg.fields.forEach((field) => {
        const input = root.querySelector(`#${this._uid}-${field.inputId}`);
        if (input) input.value = item ? item[field.name] || '' : '';
      });
      if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
      }
      formRoot.style.display = '';
      formRoot.setAttribute('aria-hidden', 'false');
      listContainer.style.display = 'none';
      addBtn?.setAttribute('disabled', 'disabled');
      setTimeout(() => {
        try {
          root.querySelector(`#${this._uid}-${cfg.fields[0].inputId}`)?.focus();
        } catch {}
      }, 120);
    };

    // Скрыть форму и вернуться к списку
    const hideForm = () => {
      activeEditingId = null;
      formRoot.style.display = 'none';
      formRoot.setAttribute('aria-hidden', 'true');
      listContainer.style.display = '';
      addBtn?.removeAttribute('disabled');
      if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
      }
      this.listButtonUpdater.updateListButtons(root, type);
    };

    // Делегированный обработчик кликов
    const onRootClick = (e) => {
      const addEl = e.target.closest(`#${addBtnId}`);
      if (addEl) {
        e.preventDefault();
        showForm();
        return;
      }
      const itemEl = e.target.closest(`.${type}-item`);
      if (!itemEl) return;
      const id     = itemEl.dataset.id;
      const action = e.target.dataset.action;
      if (!action) return;

      if (action === 'select') {
        const selected = cfg.getItem(id);
        if (selected) {
          cfg.apply(selected);
          cfg.selectItem(selected.id);
          this._closeModalSafe(root);
        }
        return;
      }
      if (action === 'edit') {
        const itemData = cfg.getItem(id);
        if (itemData) showForm(itemData);
        return;
      }
      if (action === 'delete') {
        const label = cfg.addLabel;
        if (!confirm(`Удалить ${label}?`)) return;
        cfg.removeItem(id);
        return;
      }
    };

    // Обработчик кнопки "Сохранить"
    const onSaveClick = async (e) => {
      e.preventDefault();
      const payload = {};
      cfg.fields.forEach((field) => {
        const input = root.querySelector(`#${this._uid}-${field.inputId}`);
        if (input) payload[field.name] = input.value.trim();
      });
      const error = cfg.validate(payload);
      if (error) {
        if (errorEl) {
          errorEl.style.display = '';
          errorEl.textContent  = error;
        }
        return;
      }
      try {
        if (activeEditingId) {
          await cfg.updateItem(activeEditingId, payload);
        } else {
          await cfg.addItem(payload);
        }
        render();
        hideForm();
      } catch (err) {
        console.error(err);
        if (errorEl) {
          errorEl.style.display = '';
          errorEl.textContent  = 'Ошибка при сохранении. Попробуйте ещё раз.';
        }
      }
    };

    // Обработчик отмены
    const onCancel = (e) => {
      e.preventDefault();
      hideForm();
    };

    // Обработчик клавиатуры (Escape/Enter)
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (formRoot && formRoot.style.display !== 'none') {
          hideForm();
          return;
        }
        this._closeModalSafe(root);
      }
      if (e.key === 'Enter') {
        if (formRoot && formRoot.style.display !== 'none') {
          e.preventDefault();
          onSaveClick(e);
        }
      }
    };

    // Назначение слушателей
    this._safeAddListener(root, 'click', onRootClick);
    this._safeAddListener(saveBtn, 'click', onSaveClick);
    this._safeAddListener(cancelBtn, 'click', onCancel);
    this._safeAddListener(document, 'keydown', onKeyDown);

    // Подписка на изменения в хранилище
    const unsubscribe = this._subscribeRender(() => {
      this._scheduleRender(root, render);
    });

    // Очистка обработчиков при закрытии/удалении
    const cleanup = () => {
      this._safeRemoveListener(root, 'click', onRootClick);
      this._safeRemoveListener(saveBtn, 'click', onSaveClick);
      this._safeRemoveListener(cancelBtn, 'click', onCancel);
      this._safeRemoveListener(document, 'keydown', onKeyDown);
      unsubscribe();
      const scheduled = this._scheduledRenders.get(root);
      if (scheduled && scheduled.timer) clearTimeout(scheduled.timer);
      this._scheduledRenders.delete(root);
    };
    this._mounted.set(root, cleanup);

    // Первичный рендер и скрытие формы
    render();
    hideForm();

    // Отслеживаем удаление DOM-элемента
    const observer = new MutationObserver(() => {
      if (!document.body.contains(root)) {
        const c = this._mounted.get(root);
        if (typeof c === 'function') c();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * Генерация HTML карточки элемента. Каждый field рендерится с плейсхолдером (если определён).
   */
  _makeItemHtml(type, item) {
    const cfg = this._modalConfig[type];
    const fieldsHtml = cfg.fields
      .map((field) => {
        const value = item[field.name];
        const placeholder = field.fieldPlaceholder ? field.fieldPlaceholder : '';
        return value
          ? `<div class="itemField"><span class="fieldPlaceholder">${placeholder}</span>${escapeHtml(value)}</div>`
          : '';
      })
      .join('');
    return `
      <div class="item-card ${type}-item" data-id="${escapeHtml(item.id)}">
        <div style="flex:1;min-width:0">
          ${fieldsHtml}
        </div>
        <div class="item-actions" aria-hidden="false">
          <button class="action-btn select-btn" data-action="select" title="Выбрать">
            <i class="fa fa-check" aria-hidden="true"></i><span class="btn-label">Выбрать</span>
          </button>
          <button class="action-btn edit-btn icon-only" data-action="edit" title="Изменить">
            <i class="fa fa-pencil" aria-hidden="true"></i>
          </button>
          <button class="action-btn delete-btn icon-only" data-action="delete" title="Удалить">
            <i class="fa fa-trash" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    `;
  }

  /* ======== Другие вспомогательные методы ======== */

  _scheduleRender(root, renderFn) {
    const existing = this._scheduledRenders.get(root);
    if (existing && existing.timer) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          try {
            renderFn();
          } catch (e) {
            console.error('render error:', e);
          }
        });
      } else {
        setTimeout(() => {
          try {
            renderFn();
          } catch (e) {
            console.error('render error:', e);
          }
        }, 0);
      }
      this._scheduledRenders.delete(root);
    }, this._RENDER_DEBOUNCE_MS);
    this._scheduledRenders.set(root, { timer });
  }

  _closeModalSafe(root) {
    try {
      this.foxEngine?.modalApp?.closeModalApp();
    } catch {
      try {
        root.remove();
      } catch {}
    }
  }

  _safeAddListener(el, ev, handler, opts) {
    if (!el || !handler) return;
    el.addEventListener(ev, handler, opts);
  }

  _safeRemoveListener(el, ev, handler, opts) {
    if (!el || !handler) return;
    try {
      el.removeEventListener(ev, handler, opts);
    } catch {
      /* ignore */
    }
  }

  _subscribeRender(renderFn) {
    const unsub = this.storage.subscribe(() => {
      try {
        renderFn();
      } catch (e) {
        console.error(e);
      }
    });
    return unsub;
  }

  /* ======== Методы для обратной совместимости ======== */

  _buildRecipientFields() {
    return this._modalConfig.recipient.fields.map((f) => ({ id: f.inputId, label: f.label }));
  }

  _buildAddressFields() {
    return this._modalConfig.address.fields.map((f) => ({ id: f.inputId, label: f.label }));
  }

  _openModal(type, fields, cfg) {
    const html = this._wrapHtml(this._buildModalInner(type, this._modalConfig[type]));
    const rootId = `${this._uid}-${type}-modal`;
    this._showModalSafe(html, rootId, cfg.title, (root) => {
      this._mountModal(root, type, this._modalConfig[type]);
    });
  }

  _mountRecipientModal(root) {
    this._mountModal(root, 'recipient', this._modalConfig.recipient);
  }

  _mountAddressModal(root) {
    this._mountModal(root, 'address', this._modalConfig.address);
  }

  _buildRecipientModalInner() {
    return this._buildModalInner('recipient', this._modalConfig.recipient);
  }

  _buildAddressModalInner() {
    return this._buildModalInner('address', this._modalConfig.address);
  }
}