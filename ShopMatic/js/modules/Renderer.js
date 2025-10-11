// shopmatic/Renderer.js
import { escapeHtml, makeSpecHtmlPreview, formatPrice, computeDiscountPercent } from './utils.js';

export class Renderer {
  constructor({ foxEngine, productService, favorites }) {
    this.foxEngine = foxEngine;
    this.productService = productService;
    this.favorites = favorites; // FavoritesModule instance (to read state)
  }

  async createCard(product) {
    const p = product || {};
    const id = p.name || p.id || p.title || p.fullname || '';
    const discount = computeDiscountPercent(p);
    const priceText = formatPrice(p.price);
    const hasOldPrice = p.oldPrice && Number(p.oldPrice) > 0;
    const badgeText = (p.stock > 0) ? 'В наличии' : 'Под заказ';
    const stockText = (p.stock > 0) ? ('Остаток: ' + p.stock) : 'Нет в наличии';
    const specsHtml = makeSpecHtmlPreview(p.specs || {});

    const data = {
      fullname: escapeHtml(p.fullname || p.title || p.name || ''),
	  id: p.name,
      img: escapeHtml(p.picture || ''),
      SHORT: escapeHtml(p.short || ''),
      price: escapeHtml(priceText),
      oldPrice: hasOldPrice ? escapeHtml(formatPrice(p.oldPrice)) : '',
      badgeText: escapeHtml(badgeText),
	  stock: p.stock,
      specs: specsHtml
    };

    let html = '';
    if (this.foxEngine && this.foxEngine.templateCache && this.foxEngine.templateCache.productCard) {
      try {
        html = await this.foxEngine.replaceTextInTemplate(this.foxEngine.templateCache.productCard, data);
      } catch (e) {
        this.foxEngine.log && this.foxEngine.log("Ошибка при рендере шаблона карточки: " + e, "ERROR");
      }
    }
    if (!html) {
      html = `
        <div class="card">
          <div class="card__media"><img src="${data.IMG}" alt="${data.TITLE}"></div>
          <div class="card__body">
            <h3 class="card__title">${data.TITLE}</h3>
            <div class="card__price">${data.PRICE}${hasOldPrice ? ' <small class="old">' + data.OLD_PRICE + '</small>' : ''}</div>
            <div class="card__short">${data.SHORT}</div>
            <div class="card__specs">${data.SPECS_HTML}</div>
            <div class="card__controls"><button data-role="buy">В корзину</button></div>
          </div>
        </div>`;
    }

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    const card = wrapper.firstElementChild || wrapper;
    card.setAttribute('data-product-id', String(id));
    return card;
  }

  async render(list = [], rootEl) {
    if (!rootEl) return;
    rootEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    const cards = await Promise.all(list.map(p => this.createCard(p)));
    for (const card of cards) {
      if (!card) continue;
      card.style.opacity = '0';
      card.style.transition = 'opacity 0.28s ease';
      frag.appendChild(card);
      requestAnimationFrame(() => { card.style.opacity = '1'; });
    }
    rootEl.appendChild(frag);
  }

  async _createMiniCartItemHTML(item, foxEngine) {
    // Если есть шаблон мини-карточки — используем
    const title = escapeHtml(item.fullname || item.title || item.name || 'Товар');
    const price = formatPrice(item.price || 0);
    const qty = Number(item.qty || 0);
    const img = escapeHtml(item.picture || '/assets/no-image.png');
    const id = escapeHtml(item.name || '');
    if (foxEngine && foxEngine.templateCache && foxEngine.templateCache.miniCartItem) {
      try {
        return await foxEngine.replaceTextInTemplate(foxEngine.templateCache.miniCartItem, { id, img, title, qty, price });
      } catch (e) {
        console.warn('Renderer._createMiniCartItemHTML template error', e);
      }
    }
    // fallback:
    return `<li class="cart-item"><div class="ps-product--mini-cart"><img src="${img}" alt="${title}" /><div class="ps-product__content"><div class="ps-product__name">${title}</div><div class="ps-product__meta">${qty} × ${price}</div></div></div></li>`;
  }

async _renderCartGrid(cartEl, cartArr, foxEngine) {
  if (!cartEl) return;
  cartEl.innerHTML = '';

  // локальные безопасные помощники (используют глобальные, если те доступны)
  const _escape = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s ?? '').replace(/[&<>"'`=\/]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#x60;','=':'&#x3D;','/':'&#x2F;'})[c]));
  const _formatPrice = (typeof formatPrice === 'function') ? formatPrice : (v => {
    try { return Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(Number(v || 0)); } catch (e) { return String(v || 0); }
  });
  const _makeSpecs = (typeof makeSpecHtmlPreview === 'function') ? makeSpecHtmlPreview : (specs => {
    if (!specs || typeof specs !== 'object') return '';
    const keys = Object.keys(specs);
    if (!keys.length) return '';
    return `<div class="cart-item__info"><strong>Основные характеристики:</strong><ul>${keys.map(k => `<li>${_escape(k)}: ${_escape(specs[k])}</li>`).join('')}</ul></div>`;
  });

  if (!Array.isArray(cartArr) || cartArr.length === 0) {
    cartEl.innerHTML = `
      <div class="cart-empty">
        <p><i class="fa-regular fa-cart-shopping"></i> Ваша корзина пуста.</p>
        <a href="#page/catalog" class="btn btn-primary">Перейти в каталог</a>
      </div>`;
    return;
  }

  const frag = document.createDocumentFragment();

  for (const rawItem of cartArr) {
    // нормализация полей
    const item = rawItem || {};
    const fullname = String(item.fullname ?? item.title ?? item.name ?? '').trim();
    const idRaw = String(item.name ?? item.id ?? item.productId ?? '').trim();
    const picture = String(item.picture ?? item.image ?? '/assets/no-image.png');
    const priceNum = Number(item.price ?? 0);
    const qtyNum = Number.isFinite(Number(item.qty)) ? Number(item.qty) : 1;
    const stockNum = Number.isFinite(Number(item.stock)) ? Number(item.stock) : 0;
    const specsHtml = _makeSpecs(item.specs || {});

    const priceFormatted = _formatPrice(priceNum);
    const totalPriceNum = priceNum * (qtyNum || 0);
    const totalPriceFormatted = _formatPrice(totalPriceNum);

    // Попытка получить html из шаблона foxEngine (если есть)
    let rowHtml = '';
    if (foxEngine && foxEngine.templateCache && foxEngine.templateCache.cartItem) {
      try {
        // передаём "сырые" данные (не-escaped) — предполагается, что replaceTextInTemplate корректно экранирует
        rowHtml = await foxEngine.replaceTextInTemplate(foxEngine.templateCache.cartItem, {
          id: idRaw,
          fullname,
          price: priceFormatted,
          totalPrice: totalPriceFormatted,
          qty: qtyNum,
          stock: stockNum,
          picture,
          specs: specsHtml
        });
      } catch (e) {
        console.warn('Renderer._renderCartGrid template error', e);
        rowHtml = '';
      }
    }

    // Если шаблон не задан или вернул пустое — используем встроенный шаблон, соответствующий вашей разметке
    if (!rowHtml) {
      // экранируем пользовательские значения для безопасности
      const escFull = _escape(fullname);
      const escId = _escape(idRaw);
      const escPicture = _escape(picture);
      const escPrice = _escape(priceFormatted);
      const escTotal = _escape(totalPriceFormatted);

      // построим HTML похожий на ваш пример (.cart-item + .cart-item__content)
      rowHtml = `
        <div class="cart-item__content">
          <div class="cart-item__image">
            <img src="${escPicture}" alt="${escFull}">
          </div>

          <div class="cart-item__details">
            <div class="cart-item__title">
              <a href="#product/${encodeURIComponent(idRaw)}" target="_blank">${escFull}</a>
            </div>
            ${specsHtml}
          </div>

          <div class="cart-item__right">
            <div class="cart-item__price">
              <span class="price-value">${escPrice}</span>
              <div class="price-total">Итого: <span class="price-total-value">${escTotal}</span></div>
            </div>

            <div class="qty-controls" data-id="${escId}">
              <button class="qty-btn qty-decr" aria-label="Уменьшить">−</button>
              <input class="qty-input" type="number" value="${stockNum > 0 ? String(Math.max(1, qtyNum)) : '0'}" min="1" max="${stockNum}" ${stockNum <= 0 ? 'disabled aria-disabled="true"' : ''}>
              <button class="qty-btn qty-incr" aria-label="Увеличить">+</button>
            </div>
          </div>

          <div class="cart-item__controls">
            <div class="cart-item__icons">
              <button class="wishlist-btn fav-btn" title="Добавить в избранное">
                <i class="icon-heart"></i>
              </button>
              <button class="remove-btn" data-id="${escId}" title="Удалить">
                <i class="fa-regular fa-xmark"></i>
              </button>
            </div>
          </div>
        </div>`;
    }

    // Создадим корневой элемент .cart-item и установим data-cart-item (упрощает идентификацию)
    const wrapper = document.querySelector('.cart-item');
    wrapper.className = 'cart-item';
    // data attributes: data-cart-item и data-id для совместимости
    if (idRaw) {
     // wrapper.setAttribute('data-cart-item', idRaw);
    //  wrapper.setAttribute('data-id', idRaw);
    }
    wrapper.innerHTML = rowHtml.trim();

    // После вставки HTML — проставим корректные атрибуты для input/btn (доп. защита)
    try {
      const qtyInput = wrapper.querySelector && wrapper.querySelector('.qty-input');
      const btnPlus = wrapper.querySelector && wrapper.querySelector('.qty-btn.qty-incr');
      const btnMinus = wrapper.querySelector && wrapper.querySelector('.qty-btn.qty-decr');

      if (qtyInput) {
        // min
        qtyInput.setAttribute('min', '1');
        // max
        qtyInput.setAttribute('max', String(stockNum));
        if (stockNum <= 0) {
          qtyInput.value = '0';
          qtyInput.disabled = true;
          qtyInput.setAttribute('aria-disabled', 'true');
        } else {
          // если введённое значение некорректно — скорректируем
          let cur = parseInt(qtyInput.value || String(qtyNum), 10);
          if (isNaN(cur) || cur < 1) cur = 1;
          if (cur > stockNum) cur = stockNum;
          qtyInput.value = String(cur);
          qtyInput.disabled = false;
          qtyInput.removeAttribute('aria-disabled');
        }
      }

      if (btnPlus) {
        btnPlus.disabled = stockNum <= 0 || qtyNum >= stockNum;
        if (btnPlus.disabled) btnPlus.setAttribute('aria-disabled', 'true'); else btnPlus.removeAttribute('aria-disabled');
      }
      if (btnMinus) {
        btnMinus.disabled = stockNum <= 0 || qtyNum <= 1;
        if (btnMinus.disabled) btnMinus.setAttribute('aria-disabled', 'true'); else btnMinus.removeAttribute('aria-disabled');
      }
    } catch (e) {
      // ignore small DOM sync errors
    }

    frag.appendChild(wrapper);
  }

  // append all at once
  cartEl.appendChild(frag);
}


  updateProductCardFavState(rootEl, id, isFav) {
    if (!rootEl || !id) return;
    const selector = `[data-product-id="${CSS && CSS.escape ? CSS.escape(String(id)) : String(id).replace(/"/g, '\\"')}"]`;
    const card = rootEl.querySelector(selector);
    if (!card) return;
    const favBtn = card.querySelector('.fav-btn');
    if (!favBtn) return;
    favBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    favBtn.title = isFav ? 'В избранном' : 'Добавить в избранное';
    favBtn.classList.toggle('is-fav', isFav);
    const icon = favBtn.querySelector('i');
    if (icon) {
      icon.classList.remove('fa-regular', 'fa-solid');
      icon.classList.add(isFav ? 'fa-solid' : 'fa-regular');
      if (!icon.classList.contains('fa-heart')) icon.classList.add('fa-heart');
    }
  }
}
