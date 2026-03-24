import { describe, it, expect } from 'vitest';
import {
  fillRect, fillRowX, fillRowZ, fillPerimeter,
  fillTower, fillCrenellations, place, placeMany, fillHull,
} from '../src/PresetHelpers.js';

describe('PresetHelpers', () => {
  describe('place', () => {
    it('should add a single block', () => {
      const out = [];
      place(out, 1, 2, 3, 'CUBE', 1);
      expect(out).toEqual([{ x: 1, y: 2, z: 3, type: 'CUBE', rotation: 1 }]);
    });

    it('should default rotation to 0', () => {
      const out = [];
      place(out, 0, 0, 0, 'WALL');
      expect(out[0].rotation).toBe(0);
    });
  });

  describe('placeMany', () => {
    it('should place multiple blocks from compact arrays', () => {
      const out = [];
      placeMany(out, [
        [0, 0, 0, 'CUBE', 2],
        [1, 1, 1, 'WALL'],
      ]);
      expect(out).toHaveLength(2);
      expect(out[0]).toEqual({ x: 0, y: 0, z: 0, type: 'CUBE', rotation: 2 });
      expect(out[1].rotation).toBe(0);
    });

    it('should support rotX as 6th element', () => {
      const out = [];
      placeMany(out, [[0, 0, 0, 'THRUSTER', 0, 3]]);
      expect(out[0].rotX).toBe(3);
    });
  });

  describe('fillRowX', () => {
    it('should fill a row along X', () => {
      const out = [];
      fillRowX(out, 2, 5, 0, 1, 'CUBE');
      expect(out).toHaveLength(4); // x=2,3,4,5
      expect(out.every(b => b.z === 0 && b.y === 1 && b.type === 'CUBE')).toBe(true);
    });
  });

  describe('fillRowZ', () => {
    it('should fill a row along Z', () => {
      const out = [];
      fillRowZ(out, 0, 1, 3, 2, 'WALL', 1);
      expect(out).toHaveLength(3); // z=1,2,3
      expect(out.every(b => b.x === 0 && b.y === 2 && b.rotation === 1)).toBe(true);
    });
  });

  describe('fillRect', () => {
    it('should fill a rectangular area', () => {
      const out = [];
      fillRect(out, 0, 2, 0, 2, 0, 'CUBE');
      expect(out).toHaveLength(9); // 3x3
    });
  });

  describe('fillPerimeter', () => {
    it('should fill only the edges of a rectangle', () => {
      const out = [];
      fillPerimeter(out, 0, 4, 0, 4, 0, 'CUBE');
      // 5x5 perimeter = 5*4 = 16 (not counting corners twice, but the function does include them)
      // Actually: all (x,z) where x=0|4 OR z=0|4 = 5+5+3+3 = 16
      expect(out).toHaveLength(16);
    });
  });

  describe('fillTower', () => {
    it('should fill a 2x2 column for multiple layers', () => {
      const out = [];
      fillTower(out, 0, 0, 0, 2, 'CUBE');
      expect(out).toHaveLength(12); // 4 blocks per layer * 3 layers
    });
  });

  describe('fillHull', () => {
    it('should fill a hull shape with cubes and ramp edges', () => {
      const rows = [
        { z: 0, xMin: 1, xMax: 3 },
        { z: 1, xMin: 0, xMax: 4 },
        { z: 2, xMin: 1, xMax: 3 },
      ];
      const out = [];
      fillHull(out, rows, 0, 'CUBE', 'RAMP', 'z');
      expect(out.length).toBeGreaterThan(0);
      // Edge blocks should be RAMP with rotX
      const ramps = out.filter(b => b.type === 'RAMP');
      expect(ramps.length).toBeGreaterThan(0);
      ramps.forEach(r => expect(r.rotX).toBe(2)); // inverted
    });

    it('should use CUBE for all blocks when edgeType is CUBE', () => {
      const rows = [
        { z: 0, xMin: 1, xMax: 3 },
        { z: 1, xMin: 0, xMax: 4 },
      ];
      const out = [];
      fillHull(out, rows, 0, 'CUBE', 'CUBE', 'z');
      expect(out.every(b => b.type === 'CUBE')).toBe(true);
    });
  });
});
