/**
 * @author Calista Verner
 */

export class DomUtils {
  /**
   * Safe querySelector.
   * @param {ParentNode|Element|null|undefined} root
   * @param {string} selector
   * @returns {Element|null}
   */
  static qs(root, selector) {
    try {
      return root?.querySelector?.(selector) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Safe closest.
   * @param {Element|null|undefined} el
   * @param {string} selector
   * @returns {Element|null}
   */
  static closest(el, selector) {
    try {
      return el?.closest?.(selector) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Toggle element visibility via display.
   * @param {Element|null} el
   * @param {boolean} visible
   */
  static setVisible(el, visible) {
    if (!el) return;
    el.style.display = visible ? '' : 'none';
  }

  /**
   * Set aria-disabled and disabled when supported.
   * @param {Element|null} el
   * @param {boolean} disabled
   */
  static setDisabled(el, disabled) {
    if (!el) return;
    try {
      if ('disabled' in el) el.disabled = !!disabled;
    } catch {}
    try {
      if (disabled) el.setAttribute('aria-disabled', 'true');
      else el.removeAttribute('aria-disabled');
    } catch {}
  }
}