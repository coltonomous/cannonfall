import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ── Replicated timer tracking logic from BattleController.js ──

class TimerTracker {
  constructor() {
    this._pendingTimers = [];
  }

  _scheduleTimer(fn, delay) {
    const id = setTimeout(() => {
      this._pendingTimers = this._pendingTimers.filter(t => t !== id);
      fn();
    }, delay);
    this._pendingTimers.push(id);
    return id;
  }

  _cancelTimers() {
    for (const id of this._pendingTimers) clearTimeout(id);
    this._pendingTimers = [];
  }
}

// ── Tests ────────────────────────────────────────────

describe('Timer Tracking', () => {
  let tracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new TimerTracker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scheduleTimer adds timer to pending list', () => {
    tracker._scheduleTimer(() => {}, 1000);
    expect(tracker._pendingTimers.length).toBe(1);
  });

  it('scheduleTimer executes the callback after delay', () => {
    let called = false;
    tracker._scheduleTimer(() => { called = true; }, 500);

    vi.advanceTimersByTime(499);
    expect(called).toBe(false);

    vi.advanceTimersByTime(1);
    expect(called).toBe(true);
  });

  it('timer removes itself from pending list after firing', () => {
    tracker._scheduleTimer(() => {}, 100);
    expect(tracker._pendingTimers.length).toBe(1);

    vi.advanceTimersByTime(100);
    expect(tracker._pendingTimers.length).toBe(0);
  });

  it('cancelTimers prevents pending callbacks from firing', () => {
    let called = false;
    tracker._scheduleTimer(() => { called = true; }, 500);

    tracker._cancelTimers();
    vi.advanceTimersByTime(1000);

    expect(called).toBe(false);
  });

  it('cancelTimers clears the pending list', () => {
    tracker._scheduleTimer(() => {}, 100);
    tracker._scheduleTimer(() => {}, 200);
    tracker._scheduleTimer(() => {}, 300);
    expect(tracker._pendingTimers.length).toBe(3);

    tracker._cancelTimers();
    expect(tracker._pendingTimers.length).toBe(0);
  });

  it('multiple timers fire independently', () => {
    const order = [];
    tracker._scheduleTimer(() => order.push('a'), 100);
    tracker._scheduleTimer(() => order.push('b'), 200);
    tracker._scheduleTimer(() => order.push('c'), 300);

    vi.advanceTimersByTime(300);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(tracker._pendingTimers.length).toBe(0);
  });

  it('cancelling after some timers have fired only cancels remaining', () => {
    const order = [];
    tracker._scheduleTimer(() => order.push('a'), 100);
    tracker._scheduleTimer(() => order.push('b'), 200);
    tracker._scheduleTimer(() => order.push('c'), 300);

    vi.advanceTimersByTime(150); // 'a' fires
    expect(order).toEqual(['a']);
    expect(tracker._pendingTimers.length).toBe(2);

    tracker._cancelTimers();
    vi.advanceTimersByTime(300);
    expect(order).toEqual(['a']); // b and c never fire
  });

  it('scheduleTimer returns the timer id', () => {
    const id = tracker._scheduleTimer(() => {}, 100);
    expect(id).toBeDefined();
    expect(tracker._pendingTimers).toContain(id);
  });
});
