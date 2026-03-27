import { describe, it, expect, beforeEach } from 'vitest';

// ── Replicated rate limiting logic from server.js ─────

const RATE_LIMIT_WINDOW = 2000;
const RATE_LIMIT_MAX = 30;

let rateLimitCounters;

function resetState() {
  rateLimitCounters = new Map();
}

function rateLimit(sessionId) {
  const now = Date.now();
  let entry = rateLimitCounters.get(sessionId);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    rateLimitCounters.set(sessionId, entry);
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

function cleanupRateLimit(sessionId) {
  rateLimitCounters.delete(sessionId);
}

// ── Tests ────────────────────────────────────────────

describe('Rate Limiting', () => {
  beforeEach(resetState);

  it('allows events up to the limit', () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(rateLimit('user-1')).toBe(false);
    }
  });

  it('blocks the event immediately after the limit', () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) rateLimit('user-1');
    expect(rateLimit('user-1')).toBe(true);
  });

  it('blocks all subsequent events after the limit', () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) rateLimit('user-1');
    expect(rateLimit('user-1')).toBe(true);
    expect(rateLimit('user-1')).toBe(true);
    expect(rateLimit('user-1')).toBe(true);
  });

  it('tracks clients independently', () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) rateLimit('user-1');
    expect(rateLimit('user-1')).toBe(true);
    // user-2 should still be fine
    expect(rateLimit('user-2')).toBe(false);
  });

  it('resets after the window expires', () => {
    const entry = { count: RATE_LIMIT_MAX, resetAt: Date.now() - 1 };
    rateLimitCounters.set('user-1', entry);
    // Next call should start a fresh window
    expect(rateLimit('user-1')).toBe(false);
  });

  it('creates entry on first call for unknown session', () => {
    expect(rateLimitCounters.has('new-user')).toBe(false);
    rateLimit('new-user');
    expect(rateLimitCounters.has('new-user')).toBe(true);
  });

  it('cleanupRateLimit removes the session entry', () => {
    rateLimit('user-1');
    expect(rateLimitCounters.has('user-1')).toBe(true);
    cleanupRateLimit('user-1');
    expect(rateLimitCounters.has('user-1')).toBe(false);
  });

  it('cleanupRateLimit is safe for non-existent sessions', () => {
    expect(() => cleanupRateLimit('ghost')).not.toThrow();
  });

  it('exactly RATE_LIMIT_MAX events are allowed (boundary)', () => {
    let allowed = 0;
    for (let i = 0; i < RATE_LIMIT_MAX + 5; i++) {
      if (!rateLimit('user-1')) allowed++;
    }
    expect(allowed).toBe(RATE_LIMIT_MAX);
  });
});
