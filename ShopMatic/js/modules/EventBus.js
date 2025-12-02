/*
 * Extended EventBus
 *
 * This implementation enhances the basic event bus pattern by adding support for
 * priority listeners and one‑time event handlers. Consumers can register
 * handlers with a priority value to control the order of invocation. Higher
 * priority handlers run first. The `once` option makes a handler automatically
 * unsubscribe after the first call. There is also an `off` method that
 * supports removing specific handlers, all handlers for an event, or all
 * handlers globally.
 */
export class EventBus {
  constructor() {
    // Dictionary of event names to arrays of listener objects. Each listener
    // object stores the handler function along with metadata about whether it
    // should only run once and its priority.
    this.events = {};
  }

  /**
   * Subscribe to an event.
   *
   * @param {string} event ‑ The name of the event to subscribe to.
   * @param {Function} handler ‑ The callback to invoke when the event is emitted.
   * @param {Object} [options] ‑ Optional subscription options. Supported keys:
   *   - once: boolean indicating that the handler should automatically remove
   *           itself after it fires for the first time.
   *   - priority: number indicating the execution priority (higher numbers
   *           execute before lower ones). Defaults to 0.
   */
  on(event, handler, options = {}) {
    if (!event || typeof handler !== 'function') return;
    const listener = {
      handler,
      once: !!options.once,
      priority: options.priority || 0
    };
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
    // Sort listeners so those with higher priority run first.
    this.events[event].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Subscribe to an event but remove the handler after the first invocation.
   *
   * @param {string} event ‑ The name of the event to subscribe to.
   * @param {Function} handler ‑ The callback to invoke when the event is emitted.
   * @param {number} [priority] ‑ Optional priority for the handler.
   */
  once(event, handler, priority = 0) {
    this.on(event, handler, { once: true, priority });
  }

  /**
   * Emit an event with optional data. All handlers subscribed to the event
   * will be invoked in order of their priority. Handlers marked as `once`
   * will be removed after execution.
   *
   * @param {string} event ‑ The name of the event to emit.
   * @param {*} [data] ‑ Optional data to pass to each handler.
   */
  emit(event, data) {
    const listeners = this.events[event];
    if (!Array.isArray(listeners) || !listeners.length) return;
    // Clone the array to avoid issues if handlers modify the listener list.
    for (const listener of [...listeners]) {
      try {
        listener.handler(data);
      } catch (err) {
        // Log errors but allow other listeners to continue executing.
        console.error(`Error in handler for event '${event}':`, err);
      }
      if (listener.once) {
        this.off(event, listener.handler);
      }
    }
  }

  /**
   * Unsubscribe from events.
   *
   * @param {string} [event] ‑ The event name. If omitted, all events are removed.
   * @param {Function} [handler] ‑ The specific handler to remove. If omitted,
   *   all handlers for the event are removed.
   */
  off(event, handler) {
    if (!event) {
      // Remove all events entirely.
      this.events = {};
      return;
    }
    if (!this.events[event]) return;
    if (!handler) {
      // Remove all handlers for the specified event.
      this.events[event] = [];
      return;
    }
    // Remove only the specified handler.
    this.events[event] = this.events[event].filter(
      (listener) => listener.handler !== handler
    );
  }
}