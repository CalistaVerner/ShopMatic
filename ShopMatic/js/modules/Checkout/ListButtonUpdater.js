export class ListButtonUpdater {
  constructor(storage, uid) {
    this.storage = storage;
    this._uid = uid;
  }

  // Главный метод для обновления списка
  updateListButtons(root, type) {
    try {
      if (!root) return;

      const listContainer = root.querySelector(`#${this._uid}-${type}-list`);
      if (!listContainer) return;

      const children = Array.from(listContainer.querySelectorAll('.item-card'));
      const selectedItem = this._getSelectedItem(type);

      children.forEach(el => {
        const id = el.dataset.id;
        const isSelected = this._isSelected(type, selectedItem, id);

        this._updateItemState(el, isSelected);
      });
    } catch (e) {
      console.error('_updateListButtons error:', e);
    }
  }

  // Получаем выбранный элемент в зависимости от типа
  _getSelectedItem(type) {
    if (type === 'recipient') {
      return this.storage.getSelectedRecipient();
    } else if (type === 'address') {
      return this.storage.getSelectedAddress();
    }
    return null;
  }

  // Проверяем, является ли элемент выбранным
  _isSelected(type, selectedItem, id) {
    return selectedItem && String(selectedItem.id) === String(id);
  }

  // Обновляем состояние элемента в списке
  _updateItemState(el, isSelected) {
    this._updateClasses(el, isSelected);
    this._updateButtons(el, isSelected);
  }

  // Обновляем классы элемента
  _updateClasses(el, isSelected) {
    if (isSelected) {
      el.classList.add('selected');
    } else {
      el.classList.remove('selected');
    }
  }

  // Обновляем кнопки внутри элемента
  _updateButtons(el, isSelected) {
    this._updateSelectButton(el, isSelected);
    this._updateEditButton(el, isSelected);
    this._updateDeleteButton(el, isSelected);
  }

  // Обновляем кнопку "Выбрать"
  _updateSelectButton(el, isSelected) {
    const selectBtn = el.querySelector('.action-btn.select-btn');
    if (selectBtn) {
      const icon = selectBtn.querySelector('i');
      const lbl = selectBtn.querySelector('.btn-label');
      if (isSelected) {
        selectBtn.classList.add('selected');
        if (icon) icon.className = 'fa fa-check-circle';
        if (lbl) lbl.textContent = 'Выбрано';
      } else {
        selectBtn.classList.remove('selected');
        if (icon) icon.className = 'fa fa-check';
        if (lbl) lbl.textContent = 'Выбрать';
      }
    }
  }

  // Обновляем кнопку "Редактировать"
  _updateEditButton(el, isSelected) {
    const editBtn = el.querySelector('.action-btn.edit-btn');
    if (editBtn) {
      if (isSelected) editBtn.classList.remove('disabled');
      else editBtn.classList.add('disabled');
    }
  }

  // Обновляем кнопку "Удалить"
  _updateDeleteButton(el, isSelected) {
    const deleteBtn = el.querySelector('.action-btn.delete-btn');
    if (deleteBtn) {
      if (isSelected) deleteBtn.classList.remove('disabled');
      else deleteBtn.classList.add('disabled');
    }
  }
}
