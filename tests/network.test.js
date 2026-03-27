import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Replicated handler management from Network.js ────

class NetworkHandlers {
  constructor() {
    this.handlers = {};
  }

  on(event, callback) {
    if (this.handlers[event]) {
      console.warn(`[Network] Overwriting handler for "${event}"`);
    }
    this.handlers[event] = callback;
  }

  off(event) {
    delete this.handlers[event];
  }

  removeAllHandlers() {
    this.handlers = {};
  }

  // Simulates what happens when a socket event arrives
  _dispatch(event, data) {
    if (this.handlers[event]) {
      this.handlers[event](data);
    }
  }
}

// ── Tests ────────────────────────────────────────────

describe('Network Handler Management', () => {
  let net;

  beforeEach(() => {
    net = new NetworkHandlers();
  });

  describe('on()', () => {
    it('registers a handler for an event', () => {
      const fn = () => {};
      net.on('matched', fn);
      expect(net.handlers['matched']).toBe(fn);
    });

    it('overwrites previous handler for same event', () => {
      const fn1 = () => 'first';
      const fn2 = () => 'second';
      net.on('matched', fn1);
      net.on('matched', fn2);
      expect(net.handlers['matched']).toBe(fn2);
    });

    it('warns when overwriting an existing handler', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      net.on('matched', () => {});
      net.on('matched', () => {});
      expect(warnSpy).toHaveBeenCalledWith('[Network] Overwriting handler for "matched"');
      warnSpy.mockRestore();
    });

    it('does not warn on first registration', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      net.on('matched', () => {});
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('off()', () => {
    it('removes a registered handler', () => {
      net.on('matched', () => {});
      net.off('matched');
      expect(net.handlers['matched']).toBeUndefined();
    });

    it('is safe to call for non-existent events', () => {
      expect(() => net.off('ghost')).not.toThrow();
    });

    it('prevents handler from being dispatched', () => {
      let called = false;
      net.on('matched', () => { called = true; });
      net.off('matched');
      net._dispatch('matched', {});
      expect(called).toBe(false);
    });
  });

  describe('removeAllHandlers()', () => {
    it('clears all registered handlers', () => {
      net.on('matched', () => {});
      net.on('game-over', () => {});
      net.on('shot-resolved', () => {});
      net.removeAllHandlers();
      expect(Object.keys(net.handlers).length).toBe(0);
    });
  });

  describe('dispatch behavior', () => {
    it('calls the correct handler with data', () => {
      let received = null;
      net.on('matched', (data) => { received = data; });
      net._dispatch('matched', { playerIndex: 1 });
      expect(received).toEqual({ playerIndex: 1 });
    });

    it('does not throw when dispatching unregistered event', () => {
      expect(() => net._dispatch('unknown', {})).not.toThrow();
    });

    it('dispatches to independently registered handlers', () => {
      let a = false, b = false;
      net.on('matched', () => { a = true; });
      net.on('game-over', () => { b = true; });
      net._dispatch('matched', {});
      expect(a).toBe(true);
      expect(b).toBe(false);
    });
  });
});
