import { describe, it, expect } from 'vitest';

// ── Replicated validation functions from server.js ────

const MAX_LAYOUT_BLOCKS = 600;
const MAX_GRID_SIZE = 20;

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateCastleData(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.layout) || data.layout.length > MAX_LAYOUT_BLOCKS) return false;
  if (!data.target || !isFiniteNumber(data.target.x) || !isFiniteNumber(data.target.z)) return false;
  if (data.target.x < 0 || data.target.x >= MAX_GRID_SIZE) return false;
  if (data.target.z < 0 || data.target.z >= MAX_GRID_SIZE) return false;
  for (const block of data.layout) {
    if (!block || typeof block !== 'object') return false;
    if (!isFiniteNumber(block.x) || !isFiniteNumber(block.y) || !isFiniteNumber(block.z)) return false;
    if (typeof block.type !== 'string' || block.type.length > 20) return false;
  }
  return true;
}

function validateRepositionPayload({ targetPos }) {
  if (!targetPos || typeof targetPos !== 'object') return false;
  if (!isFiniteNumber(targetPos.x) || !isFiniteNumber(targetPos.z)) return false;
  if (targetPos.x < 0 || targetPos.x >= MAX_GRID_SIZE) return false;
  if (targetPos.z < 0 || targetPos.z >= MAX_GRID_SIZE) return false;
  return true;
}

// ── Tests ────────────────────────────────────────────

describe('validateCastleData', () => {
  const validCastle = () => ({
    layout: [
      { x: 4, y: 0, z: 4, type: 'CUBE' },
      { x: 5, y: 0, z: 4, type: 'WALL' },
    ],
    target: { x: 4, z: 4 },
  });

  it('accepts valid castle data', () => {
    expect(validateCastleData(validCastle())).toBe(true);
  });

  it('accepts empty layout', () => {
    expect(validateCastleData({ layout: [], target: { x: 4, z: 4 } })).toBe(true);
  });

  it('rejects null', () => {
    expect(validateCastleData(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(validateCastleData(undefined)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(validateCastleData('castle')).toBe(false);
    expect(validateCastleData(42)).toBe(false);
  });

  it('rejects missing layout', () => {
    expect(validateCastleData({ target: { x: 4, z: 4 } })).toBe(false);
  });

  it('rejects non-array layout', () => {
    expect(validateCastleData({ layout: 'blocks', target: { x: 4, z: 4 } })).toBe(false);
  });

  it('rejects layout exceeding MAX_LAYOUT_BLOCKS', () => {
    const huge = { layout: Array(MAX_LAYOUT_BLOCKS + 1).fill({ x: 0, y: 0, z: 0, type: 'CUBE' }), target: { x: 0, z: 0 } };
    expect(validateCastleData(huge)).toBe(false);
  });

  it('accepts layout at exactly MAX_LAYOUT_BLOCKS', () => {
    const max = { layout: Array(MAX_LAYOUT_BLOCKS).fill({ x: 0, y: 0, z: 0, type: 'CUBE' }), target: { x: 0, z: 0 } };
    expect(validateCastleData(max)).toBe(true);
  });

  it('rejects missing target', () => {
    expect(validateCastleData({ layout: [] })).toBe(false);
  });

  it('rejects target with non-finite x', () => {
    expect(validateCastleData({ layout: [], target: { x: NaN, z: 4 } })).toBe(false);
    expect(validateCastleData({ layout: [], target: { x: Infinity, z: 4 } })).toBe(false);
  });

  it('rejects target with non-finite z', () => {
    expect(validateCastleData({ layout: [], target: { x: 4, z: NaN } })).toBe(false);
  });

  it('rejects target x out of grid bounds', () => {
    expect(validateCastleData({ layout: [], target: { x: -1, z: 4 } })).toBe(false);
    expect(validateCastleData({ layout: [], target: { x: MAX_GRID_SIZE, z: 4 } })).toBe(false);
  });

  it('rejects target z out of grid bounds', () => {
    expect(validateCastleData({ layout: [], target: { x: 4, z: -1 } })).toBe(false);
    expect(validateCastleData({ layout: [], target: { x: 4, z: MAX_GRID_SIZE } })).toBe(false);
  });

  it('accepts target at grid boundaries', () => {
    expect(validateCastleData({ layout: [], target: { x: 0, z: 0 } })).toBe(true);
    expect(validateCastleData({ layout: [], target: { x: MAX_GRID_SIZE - 1, z: MAX_GRID_SIZE - 1 } })).toBe(true);
  });

  it('rejects block with non-finite coordinates', () => {
    const data = { layout: [{ x: NaN, y: 0, z: 0, type: 'CUBE' }], target: { x: 4, z: 4 } };
    expect(validateCastleData(data)).toBe(false);
  });

  it('rejects block with missing y', () => {
    const data = { layout: [{ x: 0, z: 0, type: 'CUBE' }], target: { x: 4, z: 4 } };
    expect(validateCastleData(data)).toBe(false);
  });

  it('rejects block with non-string type', () => {
    const data = { layout: [{ x: 0, y: 0, z: 0, type: 123 }], target: { x: 4, z: 4 } };
    expect(validateCastleData(data)).toBe(false);
  });

  it('rejects block with type longer than 20 characters', () => {
    const data = { layout: [{ x: 0, y: 0, z: 0, type: 'A'.repeat(21) }], target: { x: 4, z: 4 } };
    expect(validateCastleData(data)).toBe(false);
  });

  it('accepts block type of exactly 20 characters', () => {
    const data = { layout: [{ x: 0, y: 0, z: 0, type: 'A'.repeat(20) }], target: { x: 4, z: 4 } };
    expect(validateCastleData(data)).toBe(true);
  });

  it('rejects null block in layout', () => {
    const data = { layout: [null], target: { x: 4, z: 4 } };
    expect(validateCastleData(data)).toBe(false);
  });
});

describe('validateRepositionPayload', () => {
  it('accepts valid reposition payload', () => {
    expect(validateRepositionPayload({ targetPos: { x: 5, z: 3 } })).toBe(true);
  });

  it('accepts boundary positions', () => {
    expect(validateRepositionPayload({ targetPos: { x: 0, z: 0 } })).toBe(true);
    expect(validateRepositionPayload({ targetPos: { x: MAX_GRID_SIZE - 1, z: MAX_GRID_SIZE - 1 } })).toBe(true);
  });

  it('rejects missing targetPos', () => {
    expect(validateRepositionPayload({})).toBe(false);
  });

  it('rejects null targetPos', () => {
    expect(validateRepositionPayload({ targetPos: null })).toBe(false);
  });

  it('rejects non-finite x', () => {
    expect(validateRepositionPayload({ targetPos: { x: NaN, z: 3 } })).toBe(false);
    expect(validateRepositionPayload({ targetPos: { x: Infinity, z: 3 } })).toBe(false);
  });

  it('rejects non-finite z', () => {
    expect(validateRepositionPayload({ targetPos: { x: 5, z: NaN } })).toBe(false);
  });

  it('rejects x out of bounds', () => {
    expect(validateRepositionPayload({ targetPos: { x: -1, z: 3 } })).toBe(false);
    expect(validateRepositionPayload({ targetPos: { x: MAX_GRID_SIZE, z: 3 } })).toBe(false);
  });

  it('rejects z out of bounds', () => {
    expect(validateRepositionPayload({ targetPos: { x: 5, z: -1 } })).toBe(false);
    expect(validateRepositionPayload({ targetPos: { x: 5, z: MAX_GRID_SIZE } })).toBe(false);
  });

  it('rejects string coordinates', () => {
    expect(validateRepositionPayload({ targetPos: { x: '5', z: 3 } })).toBe(false);
  });
});
