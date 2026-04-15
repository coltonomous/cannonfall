/**
 * Lightweight event emitter for decoupling game subsystems.
 * Replaces direct callback injection between Game, BattleController,
 * and NetworkHandler.
 */
export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   * @param {string} event
   * @param {Function} fn
   * @returns {Function} unsubscribe
   */
  on(event, fn) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const fns = this._listeners.get(event);
    if (!fns) return;
    const idx = fns.indexOf(fn);
    if (idx >= 0) fns.splice(idx, 1);
  }

  emit(event, data) {
    const fns = this._listeners.get(event);
    if (!fns) return;
    for (const fn of fns) fn(data);
  }

  clear() {
    this._listeners.clear();
  }
}
