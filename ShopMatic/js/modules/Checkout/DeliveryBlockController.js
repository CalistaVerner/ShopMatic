import { escapeHtml } from "../utils.js";

class DeliveryBlockController {
  constructor({ engine, root, storage, addressController }) {
    this.foxEngine = engine;
    this.root = root;
    this.storage = storage;
    this.addressController = addressController;
    this._switcheryMap = new Map();
    this._onStorageChange = this._onStorageChange.bind(this);
    this.storage.subscribe(this._onStorageChange);

    this._isHandlersAttached = false; // флаг, чтобы не добавлять обработчики повторно
    this._render();
  }

  _render() {
    if (!this.root) return;

    const selectedRecipient = this.storage.getSelectedRecipient();
    const selectedAddress  = this.storage.getSelectedAddress();
    const deliveryOptions  = this.storage.getDeliveryOptions() || {};

    // Строим каркас только один раз
    if (!this.root.querySelector("#top-second-section")) {
      this.root.innerHTML = `
        <h2 class="cart-title">Условия доставки</h2>
        <div class="delivery-options" id="deliveryOptions"></div>
        <div id="top-second-section" data-widget="TopSecondSection"></div>
        <div class="delivery-options-switch">
          ${this._renderSwitcher("leaveAtDoor", "Оставить у двери", deliveryOptions.leaveAtDoor)}
          ${this._renderSwitcher("doNotCall", "Не звонить", deliveryOptions.doNotCall)}
        </div>
      `;
      this._attachHandlers();
      this._initSwitcheries();
    }

    // Обновляем адрес и получателя
    const topSection = this.root.querySelector("#top-second-section");
    if (topSection) {
      topSection.innerHTML = `
        ${this._renderAddress(selectedAddress)}
        ${this._renderRecipient(selectedRecipient)}
      `;
    }

    // Обновляем состояние переключателей
    const leaveAtDoorInput = this.root.querySelector("#leaveAtDoor");
    const doNotCallInput  = this.root.querySelector("#doNotCall");
    if (leaveAtDoorInput) {
      leaveAtDoorInput.checked = !!deliveryOptions.leaveAtDoor;
    }
    if (doNotCallInput) {
      doNotCallInput.checked  = !!deliveryOptions.doNotCall;
    }
  }

  _renderSwitcher(id, label, checked) {
    return `
      <div class="switch-item">
        <label for="${id}">${label}</label>
        <input type="checkbox" class="switcher" id="${id}" ${checked ? "checked" : ""} />
      </div>
    `;
  }

  _renderAddress(address) {
    if (!address) {
      return this._renderEmptySection("Адрес", "Выбрать адрес", "js-open-address");
    }

    const details = [
      address.flat ? `кв. ${escapeHtml(address.flat)}` : "",
      address.floor ? `${escapeHtml(address.floor)} этаж` : "",
      address.doorcode ? `домофон ${escapeHtml(address.doorcode)}` : ""
    ].filter(Boolean).join(", ");

    return `
      <div class="delivery-point">
        <div class="delivery-point-selector">
          <button class="delivery-point-button js-open-address">
            <div class="button-content">
              <span class="label">Адрес</span>
              <div class="address-details">
                <span class="address">${escapeHtml(address.street)}, ${escapeHtml(address.house)}</span>
                <span class="additional-info">${details}</span>
              </div>
            </div>
            <div class="arrow-icon"><i class="fa-solid fa-ellipsis"></i></div>
          </button>
        </div>
      </div>
    `;
  }

  _renderRecipient(r) {
    if (!r) {
      return this._renderEmptySection("Получатель", "Добавить", "js-open-recipient");
    }

    return `
      <div class="recipient-selector">
        <div class="recipient-info">
          <button class="recipient-button js-open-recipient">
            <div class="button-content">
              <span class="label">Получатель</span>
              <div class="recipient-details">
                <span class="name">${escapeHtml(r.name)}</span>
                <span class="contact-info">${escapeHtml(r.phone || "")}</span>
              </div>
            </div>
            <div class="arrow-icon"><i class="fa-solid fa-ellipsis"></i></div>
          </button>
        </div>
      </div>
    `;
  }

  _renderEmptySection(label, placeholder, buttonClass) {
    // buttonClass ожидается "js-open-address" или "js-open-recipient"
    return `
      <div class="${buttonClass}-selector">
        <div class="${buttonClass}-info">
          <button class="${buttonClass}-button ${buttonClass}">
            <div class="button-content">
              <span class="label">${label}</span>
              <div class="${buttonClass}-details empty">${placeholder}</div>
            </div>
            <div class="arrow-icon">→</div>
          </button>
        </div>
      </div>
    `;
  }

  _attachHandlers() {
    // Используем делегирование событий, чтобы обработчики работали и после замены элементов
    if (this._isHandlersAttached) return;
    this._isHandlersAttached = true;

    // Делегируем клики на кнопки "Открыть адрес" и "Открыть получателя"
    this.root.addEventListener("click", (event) => {
      const addressButton = event.target.closest(".js-open-address");
      if (addressButton) {
        this.addressController.openAddressModal();
        return;
      }
      const recipientButton = event.target.closest(".js-open-recipient");
      if (recipientButton) {
        this.addressController.openRecipientModal();
        return;
      }
    });

    // Делегируем изменения на переключателях
    this.root.addEventListener("change", (event) => {
      if (event.target.classList.contains("switcher")) {
        this._onSwitcherChange(event);
      }
    });
  }

  _initSwitcheries() {
    this.root.querySelectorAll("input.switcher").forEach(input => {
      if (!this._switcheryMap.has(input.id)) {
        try {
          this._switcheryMap.set(
            input.id,
            new Switchery(input, { size: "small" })
          );
        } catch (err) {
          console.warn("Failed to init Switchery for", input, err);
        }
      } else {
        const sw = this._switcheryMap.get(input.id);
        if (sw && input.checked !== sw.isChecked()) {
          sw.setPosition(true);
        }
      }
    });
  }

  _onSwitcherChange(event) {
    try {
      const input   = event.target;
      const id      = input.id;
      const checked = input.checked;

      const prev = this.storage.getDeliveryOptions() || {};
      const next = { ...prev, [id]: checked };
      this.storage.setDeliveryOptions(next);
    } catch (error) {
      console.error("Error handling switcher change:", error);
    }
  }

  destroy() {
    this.storage.subscribe(() => {});
    this._switcheryMap.forEach(sw => {
      try {
        sw.element.remove();
      } catch (_) {}
    });
    this._switcheryMap.clear();
    this.root = null;
  }

  _onStorageChange() {
    this._render();
  }
}

export { DeliveryBlockController };
