import { describe, it, expect } from 'vitest';
import * as C from '../src/constants.js';
import { GAME_MODES } from '../src/GameModes.js';

// Test game flow logic without DOM/THREE dependencies by testing
// the rules and constants that govern state transitions.

describe('Game Flow Rules', () => {
  describe('perfect shot detection', () => {
    it('should detect power in sweet spot range', () => {
      const mid = (C.PERFECT_MIN + C.PERFECT_MAX) / 2;
      const testPower = C.MIN_POWER + (C.MAX_POWER - C.MIN_POWER) * mid;
      const powerFrac = (testPower - C.MIN_POWER) / (C.MAX_POWER - C.MIN_POWER);
      expect(powerFrac).toBeGreaterThanOrEqual(C.PERFECT_MIN);
      expect(powerFrac).toBeLessThanOrEqual(C.PERFECT_MAX);
    });

    it('should reject power below sweet spot', () => {
      const testPower = C.MIN_POWER + (C.MAX_POWER - C.MIN_POWER) * (C.PERFECT_MIN - 0.1);
      const powerFrac = (testPower - C.MIN_POWER) / (C.MAX_POWER - C.MIN_POWER);
      expect(powerFrac).toBeLessThan(C.PERFECT_MIN);
    });

    it('should reject power above sweet spot', () => {
      const testPower = C.MIN_POWER + (C.MAX_POWER - C.MIN_POWER) * (C.PERFECT_MAX + 0.1);
      const powerFrac = (testPower - C.MIN_POWER) / (C.MAX_POWER - C.MIN_POWER);
      expect(powerFrac).toBeGreaterThan(C.PERFECT_MAX);
    });
  });

  describe('charge mechanic', () => {
    it('power should oscillate within bounds', () => {
      const dt = 1 / 60;
      let chargeTime = 0;
      let power = C.MIN_POWER;
      const powers = [];

      for (let i = 0; i < 120; i++) {
        chargeTime += dt;
        const t = chargeTime * C.CHARGE_FREQ;
        power = C.MIN_POWER + (C.MAX_POWER - C.MIN_POWER) * (0.5 - 0.5 * Math.cos(t));
        powers.push(power);
      }

      expect(Math.min(...powers)).toBeGreaterThanOrEqual(C.MIN_POWER - 0.01);
      expect(Math.max(...powers)).toBeLessThanOrEqual(C.MAX_POWER + 0.01);

      // Should have oscillated (not flat)
      const unique = new Set(powers.map(p => Math.round(p)));
      expect(unique.size).toBeGreaterThan(5);
    });
  });

  describe('mode-specific gameplay rules', () => {
    for (const [name, mode] of Object.entries(GAME_MODES)) {
      it(`${name} should have excludeBlocks array`, () => {
        expect(Array.isArray(mode.excludeBlocks)).toBe(true);
      });

      it(`${name} grid should accommodate presets`, () => {
        expect(mode.gridWidth).toBeGreaterThanOrEqual(7);
        expect(mode.gridDepth).toBeGreaterThanOrEqual(9);
      });
    }
  });
});
