import { describe, it, expect } from 'vitest';
import { BLOCK_TYPES, BLOCK_MASS } from '../src/constants.js';

describe('Block Types', () => {
  const types = Object.entries(BLOCK_TYPES);

  it('should have at least 10 block types', () => {
    expect(types.length).toBeGreaterThanOrEqual(10);
  });

  for (const [name, info] of types) {
    describe(name, () => {
      it('should have a positive cost', () => {
        expect(info.cost).toBeGreaterThan(0);
      });

      it('should have a size array with 3 elements', () => {
        expect(Array.isArray(info.size)).toBe(true);
        expect(info.size).toHaveLength(3);
        info.size.forEach(s => expect(s).toBeGreaterThan(0));
      });
    });
  }

  describe('cost balance', () => {
    it('cube should be the most expensive basic block', () => {
      expect(BLOCK_TYPES.CUBE.cost).toBeGreaterThanOrEqual(BLOCK_TYPES.HALF_SLAB.cost);
      expect(BLOCK_TYPES.CUBE.cost).toBeGreaterThanOrEqual(BLOCK_TYPES.WALL.cost);
    });

    it('wall and slab should cost the same (same volume)', () => {
      expect(BLOCK_TYPES.WALL.cost).toBe(BLOCK_TYPES.HALF_SLAB.cost);
    });

    it('small blocks should cost 1', () => {
      expect(BLOCK_TYPES.COLUMN.cost).toBe(1);
      expect(BLOCK_TYPES.BARREL.cost).toBe(1);
      expect(BLOCK_TYPES.PLANK.cost).toBe(1);
      expect(BLOCK_TYPES.LATTICE.cost).toBe(1);
    });
  });

  describe('special properties', () => {
    it('shield should have low mass and custom material', () => {
      expect(BLOCK_TYPES.SHIELD.mass).toBeLessThan(BLOCK_MASS);
      expect(BLOCK_TYPES.SHIELD.material).toBeDefined();
      expect(BLOCK_TYPES.SHIELD.material.transparent).toBe(true);
    });

    it('lattice should have low mass and custom material', () => {
      expect(BLOCK_TYPES.LATTICE.mass).toBeLessThan(BLOCK_MASS);
      expect(BLOCK_TYPES.LATTICE.material).toBeDefined();
    });
  });
});
