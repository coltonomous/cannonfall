import { describe, it, expect, beforeEach } from 'vitest';

// Test the in-memory store logic extracted from server.js patterns
// We can't import the server directly (it starts listening), so we
// replicate the store logic to verify correctness.

function createStore() {
  const store = new Map();

  function storeSet(key, value, ttlSeconds) {
    const existing = store.get(key);
    if (existing?.timer) clearTimeout(existing.timer);
    const timer = ttlSeconds
      ? setTimeout(() => store.delete(key), ttlSeconds * 1000)
      : null;
    store.set(key, { value, timer });
  }

  function storeGet(key) {
    const entry = store.get(key);
    return entry ? entry.value : null;
  }

  function storeDel(key) {
    const entry = store.get(key);
    if (entry?.timer) clearTimeout(entry.timer);
    store.delete(key);
  }

  return { store, storeSet, storeGet, storeDel };
}

describe('In-Memory Store', () => {
  let s;

  beforeEach(() => {
    s = createStore();
  });

  it('should set and get values', () => {
    s.storeSet('key1', { data: 'hello' });
    expect(s.storeGet('key1')).toEqual({ data: 'hello' });
  });

  it('should return null for missing keys', () => {
    expect(s.storeGet('nonexistent')).toBeNull();
  });

  it('should delete values', () => {
    s.storeSet('key1', 'value');
    s.storeDel('key1');
    expect(s.storeGet('key1')).toBeNull();
  });

  it('should overwrite existing values', () => {
    s.storeSet('key1', 'first');
    s.storeSet('key1', 'second');
    expect(s.storeGet('key1')).toBe('second');
  });

  it('should handle TTL cleanup', async () => {
    s.storeSet('expiring', 'value', 0.05); // 50ms TTL
    expect(s.storeGet('expiring')).toBe('value');
    await new Promise(r => setTimeout(r, 100));
    expect(s.storeGet('expiring')).toBeNull();
  });

  it('should clear TTL timer on delete', () => {
    s.storeSet('key1', 'value', 10);
    s.storeDel('key1');
    expect(s.store.size).toBe(0);
  });

  it('should clear old TTL timer on overwrite', () => {
    s.storeSet('key1', 'v1', 10);
    s.storeSet('key1', 'v2', 20);
    // Only one entry should exist
    expect(s.store.size).toBe(1);
    expect(s.storeGet('key1')).toBe('v2');
  });
});

describe('Shot Resolution Logic', () => {
  // Test the dual-client hit confirmation logic
  function resolveShot(reports, currentTurn) {
    const attacker = currentTurn;
    const defender = 1 - attacker;

    const attackerReport = reports.get(attacker);
    const defenderReport = reports.get(defender);

    let isHit;
    if (defenderReport) {
      isHit = defenderReport.hit;
    } else if (attackerReport) {
      isHit = attackerReport.hit;
    } else {
      isHit = false;
    }

    return { isHit, perfect: attackerReport?.perfect || false };
  }

  it('should trust defender when both report hit', () => {
    const reports = new Map();
    reports.set(0, { hit: true, perfect: false });
    reports.set(1, { hit: true, perfect: false });
    expect(resolveShot(reports, 0).isHit).toBe(true);
  });

  it('should trust defender when defender says miss', () => {
    const reports = new Map();
    reports.set(0, { hit: true, perfect: false }); // attacker says hit
    reports.set(1, { hit: false, perfect: false }); // defender says miss
    expect(resolveShot(reports, 0).isHit).toBe(false);
  });

  it('should trust attacker on timeout (defender missing)', () => {
    const reports = new Map();
    reports.set(0, { hit: true, perfect: true }); // only attacker reported
    const result = resolveShot(reports, 0);
    expect(result.isHit).toBe(true);
    expect(result.perfect).toBe(true);
  });

  it('should be miss when no one reports hit', () => {
    const reports = new Map();
    reports.set(0, { hit: false, perfect: false });
    reports.set(1, { hit: false, perfect: false });
    expect(resolveShot(reports, 0).isHit).toBe(false);
  });

  it('should be miss when no one reports at all', () => {
    const reports = new Map();
    expect(resolveShot(reports, 0).isHit).toBe(false);
  });
});
