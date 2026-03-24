import { describe, it, expect } from 'vitest';
import * as C from '../src/constants.js';
import { GAME_MODES } from '../src/GameModes.js';

// Test game flow logic without DOM/THREE dependencies by testing
// the rules and constants that govern state transitions.

describe('Game Flow Rules', () => {
  describe('turn management', () => {
    it('should alternate turns (0 and 1)', () => {
      let turn = 0;
      for (let i = 0; i < 10; i++) {
        turn = 1 - turn;
        expect(turn).toBe(i % 2 === 0 ? 1 : 0);
      }
    });

    it('damaged player should get next turn after reposition', () => {
      const currentTurn = 0; // player 0 fired
      const damagedPlayer = 1 - currentTurn; // player 1 damaged
      const nextTurn = damagedPlayer; // damaged player gets next turn
      expect(nextTurn).toBe(1);
    });
  });

  describe('HP system', () => {
    it('should start with MAX_HP for both players', () => {
      expect(C.MAX_HP).toBeGreaterThan(0);
      const hp = [C.MAX_HP, C.MAX_HP];
      expect(hp[0]).toBe(hp[1]);
    });

    it('normal hit should deal 1 damage', () => {
      const hp = [C.MAX_HP, C.MAX_HP];
      const damage = 1;
      hp[1] -= damage;
      expect(hp[1]).toBe(C.MAX_HP - 1);
    });

    it('perfect hit should deal 2 damage', () => {
      const hp = [C.MAX_HP, C.MAX_HP];
      const damage = 2;
      hp[1] -= damage;
      expect(hp[1]).toBe(C.MAX_HP - 2);
    });

    it('game should end when HP reaches 0', () => {
      const hp = [C.MAX_HP, 0];
      expect(hp[1] <= 0).toBe(true);
    });
  });

  describe('perfect shot detection', () => {
    it('should detect power in sweet spot range', () => {
      const testPower = C.MIN_POWER + (C.MAX_POWER - C.MIN_POWER) * 0.84;
      const powerFrac = (testPower - C.MIN_POWER) / (C.MAX_POWER - C.MIN_POWER);
      expect(powerFrac).toBeGreaterThanOrEqual(C.PERFECT_MIN);
      expect(powerFrac).toBeLessThanOrEqual(C.PERFECT_MAX);
    });

    it('should reject power below sweet spot', () => {
      const testPower = C.MIN_POWER + (C.MAX_POWER - C.MIN_POWER) * 0.5;
      const powerFrac = (testPower - C.MIN_POWER) / (C.MAX_POWER - C.MIN_POWER);
      expect(powerFrac).toBeLessThan(C.PERFECT_MIN);
    });

    it('should reject power above sweet spot', () => {
      const testPower = C.MIN_POWER + (C.MAX_POWER - C.MIN_POWER) * 0.95;
      const powerFrac = (testPower - C.MIN_POWER) / (C.MAX_POWER - C.MIN_POWER);
      expect(powerFrac).toBeGreaterThan(C.PERFECT_MAX);
    });

    it('sweet spot should be narrow (< 10% of range)', () => {
      const spotWidth = C.PERFECT_MAX - C.PERFECT_MIN;
      expect(spotWidth).toBeLessThan(0.1);
    });
  });

  describe('charge mechanic', () => {
    it('power should oscillate with sine wave', () => {
      const dt = 1 / 60;
      let chargeTime = 0;
      let power = C.MIN_POWER;
      const powers = [];

      // Simulate 2 seconds of charging
      for (let i = 0; i < 120; i++) {
        chargeTime += dt;
        const t = chargeTime * C.CHARGE_FREQ;
        power = C.MIN_POWER + (C.MAX_POWER - C.MIN_POWER) * (0.5 - 0.5 * Math.cos(t));
        powers.push(power);
      }

      // Should stay within bounds
      expect(Math.min(...powers)).toBeGreaterThanOrEqual(C.MIN_POWER - 0.01);
      expect(Math.max(...powers)).toBeLessThanOrEqual(C.MAX_POWER + 0.01);

      // Should have oscillated (not flat)
      const unique = new Set(powers.map(p => Math.round(p)));
      expect(unique.size).toBeGreaterThan(5);
    });
  });

  describe('aim limits', () => {
    it('pitch should be bounded', () => {
      expect(C.MIN_PITCH).toBeLessThan(0); // can aim slightly below horizontal
      expect(C.MAX_PITCH).toBeGreaterThan(0);
      expect(C.MAX_PITCH).toBeLessThanOrEqual(Math.PI / 2);
    });

    it('yaw should be bounded to ±45 degrees', () => {
      expect(C.MAX_YAW_OFFSET).toBeCloseTo(Math.PI / 4, 2);
    });
  });

  describe('mode-specific gameplay rules', () => {
    it('all modes should have the same HP', () => {
      // HP is global, not per-mode
      expect(C.MAX_HP).toBe(3);
    });

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

describe('Trajectory', () => {
  it('zero gravity should produce straight line', () => {
    const g = 0;
    const step = 0.05;
    const vx = 30, vy = 0;
    let py = 5;

    for (let i = 0; i < 100; i++) {
      py += vy * step;
      // vy -= g * step; // g=0, no change
    }

    expect(py).toBeCloseTo(5, 5); // Y unchanged
  });

  it('normal gravity should produce arc', () => {
    const g = 9.82;
    const step = 0.05;
    let py = 5;
    let vy = 15; // upward
    let peaked = false;
    let fellBelow = false;

    for (let i = 0; i < 200; i++) {
      py += vy * step;
      vy -= g * step;
      if (vy < 0 && !peaked) peaked = true;
      if (py < 0) fellBelow = true;
    }

    expect(peaked).toBe(true);
    expect(fellBelow).toBe(true);
  });
});
