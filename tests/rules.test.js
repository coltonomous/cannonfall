import { describe, it, expect } from 'vitest';
import { isPerfectPower, validateCastle, validateTargetPos } from '../shared/rules.js';
import { MIN_POWER, MAX_POWER, PERFECT_MIN, PERFECT_MAX, MODE_RULES, MAX_LAYOUT_BLOCKS } from '../shared/constants.js';

const powerAt = (frac) => MIN_POWER + (MAX_POWER - MIN_POWER) * frac;

describe('isPerfectPower', () => {
  it('is true anywhere inside the sweet spot', () => {
    expect(isPerfectPower(powerAt(PERFECT_MIN + 1e-9))).toBe(true);
    expect(isPerfectPower(powerAt((PERFECT_MIN + PERFECT_MAX) / 2))).toBe(true);
    expect(isPerfectPower(powerAt(PERFECT_MAX - 1e-9))).toBe(true);
  });

  it('is false outside it', () => {
    expect(isPerfectPower(powerAt(PERFECT_MIN - 0.01))).toBe(false);
    expect(isPerfectPower(powerAt(PERFECT_MAX + 0.01))).toBe(false);
    expect(isPerfectPower(MIN_POWER)).toBe(false);
    expect(isPerfectPower(MAX_POWER)).toBe(false);
  });
});

describe('validateTargetPos', () => {
  it('accepts integer positions inside the mode grid, one layer above the top', () => {
    const { gridWidth, gridDepth, maxLayers } = MODE_RULES.castle;
    expect(validateTargetPos({ x: gridWidth - 1, y: maxLayers, z: gridDepth - 1 }, 'castle'))
      .toEqual({ x: gridWidth - 1, y: maxLayers, z: gridDepth - 1 });
  });

  it('defaults y to the ground layer', () => {
    expect(validateTargetPos({ x: 1, z: 2 }, 'pirate')).toEqual({ x: 1, y: 0, z: 2 });
  });

  it('rejects positions outside the grid, fractional or missing values, and unknown modes', () => {
    expect(validateTargetPos({ x: 7, z: 0 }, 'pirate')).toBeNull(); // pirate grid is 7 wide
    expect(validateTargetPos({ x: 0, z: -1 }, 'castle')).toBeNull();
    expect(validateTargetPos({ x: 0.5, z: 0 }, 'castle')).toBeNull();
    expect(validateTargetPos({ x: 0, y: 99, z: 0 }, 'castle')).toBeNull();
    expect(validateTargetPos({ x: 0 }, 'castle')).toBeNull();
    expect(validateTargetPos({ x: 0, z: 0 }, 'moon')).toBeNull();
    expect(validateTargetPos(null, 'castle')).toBeNull();
  });
});

describe('validateCastle', () => {
  const base = { layout: [{ x: 0, y: 0, z: 0, type: 'CUBE' }], target: { x: 4, z: 4 } };
  const withBlock = (block) => ({ ...base, layout: [{ x: 0, y: 0, z: 0, type: 'CUBE', ...block }] });

  it('returns a normalized copy with only known fields', () => {
    const result = validateCastle({
      layout: [{ x: 1, y: 2, z: 3, type: 'RAMP', rotation: 6, rotX: 0, rotZ: -1, hp: 999 }],
      target: { x: 4, z: 4, glow: true },
      cannonPos: { x: 8, z: 4, height: 50 },
      floor: [{ x: 0, z: 0, yOffset: -1, flip: true, solid: true }],
      admin: true,
    }, 'castle');
    expect(result).toEqual({
      layout: [{ x: 1, y: 2, z: 3, type: 'RAMP', rotation: 2, rotZ: 3 }],
      target: { x: 4, y: 0, z: 4 },
      cannonPos: { x: 8, z: 4 },
      floor: [{ x: 0, z: 0, type: 'CUBE', rotation: 0, yOffset: -1, flip: true }],
    });
  });

  it('enforces each mode\'s grid and layer limits', () => {
    for (const [mode, { gridWidth, gridDepth, maxLayers }] of Object.entries(MODE_RULES)) {
      const target = { x: 0, z: gridDepth - 1 };
      const ok = (block) => validateCastle({ layout: [{ type: 'CUBE', ...block }], target }, mode);
      expect(ok({ x: gridWidth - 1, y: maxLayers - 1, z: 0 }), mode).not.toBeNull();
      expect(ok({ x: gridWidth, y: 0, z: 0 }), mode).toBeNull();
      expect(ok({ x: 0, y: maxLayers, z: 0 }), mode).toBeNull();
      expect(ok({ x: 0, y: 0, z: gridDepth }), mode).toBeNull();
    }
  });

  it('rejects unknown and excluded block types', () => {
    expect(validateCastle(withBlock({ type: 'EVIL' }), 'castle')).toBeNull();
    expect(validateCastle(withBlock({ type: 'SHIELD' }), 'castle')).toBeNull();
    expect(validateCastle({ ...withBlock({ type: 'SHIELD' }), target: { x: 3, z: 3 } }, 'space')).not.toBeNull();
  });

  it('rejects fractional or non-numeric coordinates', () => {
    expect(validateCastle(withBlock({ x: 0.5 }), 'castle')).toBeNull();
    expect(validateCastle(withBlock({ y: '1' }), 'castle')).toBeNull();
    expect(validateCastle(withBlock({ z: NaN }), 'castle')).toBeNull();
  });

  it('enforces the build budget', () => {
    const { budget, gridWidth, gridDepth } = MODE_RULES.castle;
    const cubes = (n) => Array.from({ length: n }, (_, i) => ({
      x: i % gridWidth, y: Math.floor(i / (gridWidth * gridDepth)), z: Math.floor(i / gridWidth) % gridDepth, type: 'CUBE',
    }));
    const affordable = Math.floor(budget / 3); // a cube costs 3
    expect(validateCastle({ ...base, layout: cubes(affordable) }, 'castle')).not.toBeNull();
    expect(validateCastle({ ...base, layout: cubes(affordable + 1) }, 'castle')).toBeNull();
  });

  it('rejects oversized layouts before looking at blocks', () => {
    const layout = Array(MAX_LAYOUT_BLOCKS + 1).fill({ x: 0, y: 0, z: 0, type: 'COLUMN' });
    expect(validateCastle({ ...base, layout }, 'space')).toBeNull();
  });

  it('rejects a bad target or cannon position', () => {
    expect(validateCastle({ ...base, target: undefined }, 'castle')).toBeNull();
    expect(validateCastle({ ...base, target: { x: 99, z: 0 } }, 'castle')).toBeNull();
    expect(validateCastle({ ...base, cannonPos: { x: 9, z: 0 } }, 'castle')).toBeNull();
    expect(validateCastle({ ...base, cannonPos: 'there' }, 'castle')).toBeNull();
  });

  it('only lets floor pieces extend downward', () => {
    const floor = (yOffset) => ({ ...base, floor: [{ x: 0, z: 0, type: 'CUBE', yOffset }] });
    expect(validateCastle(floor(-2), 'pirate')).not.toBeNull();
    expect(validateCastle(floor(1), 'pirate')).toBeNull();
    expect(validateCastle(floor(-6), 'pirate')).toBeNull();
  });

  it('rejects non-objects and unknown modes', () => {
    expect(validateCastle(null, 'castle')).toBeNull();
    expect(validateCastle({ layout: 'lots' , target: { x: 0, z: 0 } }, 'castle')).toBeNull();
    expect(validateCastle({ ...base, layout: [null] }, 'castle')).toBeNull();
    expect(validateCastle(base, 'moon')).toBeNull();
  });
});
