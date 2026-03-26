import { describe, it, expect } from 'vitest';

// ── Replicated CORS config logic from server.js ──────

function buildCorsConfig(envOrigins, nodeEnv) {
  const allowedOrigins = envOrigins
    ? envOrigins.split(',').map(s => s.trim())
    : null;

  if (allowedOrigins) {
    return { origin: allowedOrigins };
  }
  if (nodeEnv === 'production') {
    return { origin: false };
  }
  return { origin: '*' };
}

// ── Tests ────────────────────────────────────────────

describe('CORS Configuration', () => {
  it('uses wildcard origin in development (no env vars)', () => {
    const config = buildCorsConfig(undefined, undefined);
    expect(config).toEqual({ origin: '*' });
  });

  it('uses wildcard origin when NODE_ENV is not production', () => {
    const config = buildCorsConfig(undefined, 'development');
    expect(config).toEqual({ origin: '*' });
  });

  it('disables CORS in production (same-origin only)', () => {
    const config = buildCorsConfig(undefined, 'production');
    expect(config).toEqual({ origin: false });
  });

  it('uses explicit allowed origins when ALLOWED_ORIGINS is set', () => {
    const config = buildCorsConfig('https://example.com', 'production');
    expect(config).toEqual({ origin: ['https://example.com'] });
  });

  it('splits comma-separated origins', () => {
    const config = buildCorsConfig('https://a.com,https://b.com', 'production');
    expect(config).toEqual({ origin: ['https://a.com', 'https://b.com'] });
  });

  it('trims whitespace from origins', () => {
    const config = buildCorsConfig('  https://a.com , https://b.com  ', 'production');
    expect(config).toEqual({ origin: ['https://a.com', 'https://b.com'] });
  });

  it('ALLOWED_ORIGINS takes priority over NODE_ENV', () => {
    // Even in development, if explicit origins are set, use them
    const config = buildCorsConfig('https://myapp.com', 'development');
    expect(config).toEqual({ origin: ['https://myapp.com'] });
  });

  it('single origin produces single-element array', () => {
    const config = buildCorsConfig('http://localhost:5173', undefined);
    expect(config.origin).toHaveLength(1);
    expect(config.origin[0]).toBe('http://localhost:5173');
  });
});
