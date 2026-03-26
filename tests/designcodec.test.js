import { describe, it, expect } from 'vitest';
import { encode, decode } from '../src/DesignCodec.js';

describe('DesignCodec', () => {
  const CASTLE_MODE = 'castle';
  const PIRATE_MODE = 'pirate';
  const SPACE_MODE = 'space';

  describe('roundtrip encode/decode', () => {
    it('should roundtrip a simple layout', () => {
      const data = {
        layout: [
          { x: 4, y: 0, z: 4, type: 'CUBE', rotation: 0 },
          { x: 4, y: 1, z: 4, type: 'CUBE', rotation: 0 },
        ],
        target: { x: 4, y: 0, z: 4 },
        cannonPos: { x: 8, z: 4 },
        floor: null,
      };
      const hash = encode(data, CASTLE_MODE);
      const result = decode(hash);
      expect(result).not.toBeNull();
      expect(result.modeId).toBe(CASTLE_MODE);
      expect(result.castleData.layout).toEqual(data.layout);
      expect(result.castleData.target).toEqual(data.target);
      expect(result.castleData.cannonPos).toEqual(data.cannonPos);
    });

    it('should roundtrip all 14 block types', () => {
      const types = [
        'CUBE', 'HALF_SLAB', 'WALL', 'RAMP', 'COLUMN', 'QUARTER_DOME',
        'BULLNOSE', 'HALF_BULLNOSE', 'THRUSTER', 'SHIELD', 'PLANK',
        'CYLINDER', 'LATTICE', 'BARREL',
      ];
      const layout = types.map((type, i) => ({
        x: i, y: 0, z: 0, type, rotation: 0,
      }));
      const data = {
        layout,
        target: { x: 0, y: 0, z: 0 },
        cannonPos: { x: 8, z: 4 },
        floor: null,
      };
      const result = decode(encode(data, CASTLE_MODE));
      expect(result.castleData.layout).toHaveLength(14);
      for (let i = 0; i < types.length; i++) {
        expect(result.castleData.layout[i].type).toBe(types[i]);
      }
    });

    it('should preserve rotation fields (rotation, rotX, rotZ)', () => {
      const data = {
        layout: [
          { x: 0, y: 0, z: 0, type: 'RAMP', rotation: 2, rotX: 1, rotZ: 3 },
          { x: 1, y: 0, z: 0, type: 'CUBE', rotation: 1 },
        ],
        target: { x: 0, y: 0, z: 0 },
        cannonPos: { x: 8, z: 4 },
        floor: null,
      };
      const result = decode(encode(data, CASTLE_MODE));
      expect(result.castleData.layout[0].rotation).toBe(2);
      expect(result.castleData.layout[0].rotX).toBe(1);
      expect(result.castleData.layout[0].rotZ).toBe(3);
      expect(result.castleData.layout[1].rotation).toBe(1);
      expect(result.castleData.layout[1]).not.toHaveProperty('rotX');
      expect(result.castleData.layout[1]).not.toHaveProperty('rotZ');
    });

    it('should roundtrip pirate mode with floor data', () => {
      const data = {
        layout: [{ x: 3, y: 0, z: 5, type: 'CUBE', rotation: 0 }],
        target: { x: 3, y: 0, z: 5 },
        cannonPos: { x: 6, z: 5 },
        floor: [
          { x: 0, z: 0, type: 'CUBE', yOffset: 0 },
          { x: 1, z: 0, type: 'RAMP', yOffset: 1, flip: true, rotation: 2 },
        ],
      };
      const result = decode(encode(data, PIRATE_MODE));
      expect(result.modeId).toBe(PIRATE_MODE);
      expect(result.castleData.floor).toEqual(data.floor);
    });

    it('should roundtrip space mode', () => {
      const data = {
        layout: [{ x: 3, y: 0, z: 6, type: 'SHIELD', rotation: 0 }],
        target: { x: 3, y: 0, z: 6 },
        cannonPos: { x: 6, z: 6 },
        floor: null,
      };
      const result = decode(encode(data, SPACE_MODE));
      expect(result.modeId).toBe(SPACE_MODE);
      expect(result.castleData.layout[0].type).toBe('SHIELD');
    });

    it('should reject an empty layout', () => {
      const data = {
        layout: [],
        target: { x: 4, y: 0, z: 4 },
        cannonPos: { x: 8, z: 4 },
        floor: null,
      };
      const result = decode(encode(data, CASTLE_MODE));
      expect(result).toBeNull();
    });
  });

  describe('encode format', () => {
    it('should produce a string starting with d=<modeChar>:', () => {
      const data = {
        layout: [],
        target: { x: 0, y: 0, z: 0 },
        cannonPos: { x: 8, z: 4 },
        floor: null,
      };
      expect(encode(data, 'castle')).toMatch(/^d=c:/);
      expect(encode(data, 'pirate')).toMatch(/^d=p:/);
      expect(encode(data, 'space')).toMatch(/^d=s:/);
    });
  });

  describe('decode error handling', () => {
    it('should return null for empty string', () => {
      expect(decode('')).toBeNull();
    });

    it('should return null for malformed hash', () => {
      expect(decode('garbage')).toBeNull();
      expect(decode('d=x:invalid')).toBeNull();
    });

    it('should return null for corrupted base64', () => {
      expect(decode('d=c:!!not-base64!!')).toBeNull();
    });

    it('should return null for missing mode prefix', () => {
      expect(decode('somethingelse')).toBeNull();
    });
  });

  describe('input sanitization', () => {
    it('should reject blocks with out-of-bounds coordinates', () => {
      const data = {
        layout: [{ x: 0, y: 0, z: 0, type: 'CUBE' }, { x: 999, y: 0, z: 0, type: 'CUBE' }],
        target: { x: 0, y: 0, z: 0 },
        cannonPos: { x: 8, z: 4 },
      };
      const result = decode(encode(data, CASTLE_MODE));
      expect(result.castleData.layout).toHaveLength(1);
    });

    it('should reject blocks with unknown types', () => {
      const data = {
        layout: [{ x: 0, y: 0, z: 0, type: 'CUBE' }, { x: 1, y: 0, z: 0, type: 'EVIL_BLOCK' }],
        target: { x: 0, y: 0, z: 0 },
        cannonPos: { x: 8, z: 4 },
      };
      const result = decode(encode(data, CASTLE_MODE));
      expect(result.castleData.layout).toHaveLength(1);
      expect(result.castleData.layout[0].type).toBe('CUBE');
    });

    it('should reject NaN/Infinity coordinates', () => {
      const data = {
        layout: [{ x: NaN, y: 0, z: 0, type: 'CUBE' }, { x: 0, y: Infinity, z: 0, type: 'CUBE' }],
        target: { x: 0, y: 0, z: 0 },
        cannonPos: { x: 8, z: 4 },
      };
      const result = decode(encode(data, CASTLE_MODE));
      expect(result).toBeNull(); // all blocks invalid → empty layout → rejected
    });

    it('should reject target with out-of-bounds coordinates', () => {
      const data = {
        layout: [{ x: 0, y: 0, z: 0, type: 'CUBE' }],
        target: { x: -5, z: 100 },
        cannonPos: { x: 8, z: 4 },
      };
      const result = decode(encode(data, CASTLE_MODE));
      expect(result).toBeNull();
    });

    it('should clamp rotation values', () => {
      const data = {
        layout: [{ x: 0, y: 0, z: 0, type: 'CUBE', rotation: 7 }],
        target: { x: 0, y: 0, z: 0 },
        cannonPos: { x: 8, z: 4 },
      };
      const result = decode(encode(data, CASTLE_MODE));
      expect(result.castleData.layout[0].rotation).toBe(3); // 7 % 4
    });
  });
});
