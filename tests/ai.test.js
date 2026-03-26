import { describe, it, expect } from 'vitest';
import { AI } from '../src/AI.js';
import { MIN_POWER, MAX_POWER, MIN_PITCH, MAX_PITCH, MAX_YAW_OFFSET } from '../src/constants.js';
import { GAME_MODES } from '../src/GameModes.js';

// Minimal cannon stub matching CannonTower interface
function makeCannon(x, y, z, facing) {
  const cannon = {
    group: { position: { x, y, z } },
    facingDirection: facing,
    yaw: 0,
    pitch: Math.PI / 6,
    updateAim() {},
  };
  return cannon;
}

describe('AI', () => {
  describe('computeAim — gravity mode', () => {
    const mode = GAME_MODES.CASTLE;

    it('should return finite yaw/pitch and power within valid bounds', () => {
      const ai = new AI('HARD');
      const cannon = makeCannon(-16, 10, 0, 1);
      const target = { x: 16, y: 2, z: 0 };
      const aim = ai.computeAim(cannon, target, mode);

      // Raw yaw may exceed MAX_YAW_OFFSET — clamping happens in startAiming
      expect(Number.isFinite(aim.yaw)).toBe(true);
      expect(aim.pitch).toBeGreaterThanOrEqual(MIN_PITCH);
      expect(aim.pitch).toBeLessThanOrEqual(MAX_PITCH);
      expect(aim.power).toBeGreaterThanOrEqual(MIN_POWER);
      expect(aim.power).toBeLessThanOrEqual(MAX_POWER);
    });

    it('should aim roughly toward the target (positive yaw for +Z offset)', () => {
      const ai = new AI('HARD');
      const cannon = makeCannon(-16, 10, 0, 1);
      const target = { x: 16, y: 2, z: 5 };
      const aim = ai.computeAim(cannon, target, mode);
      // Target is at +Z, so yaw should be non-zero
      expect(Math.abs(aim.yaw)).toBeGreaterThan(0.01);
    });

    it('should compute higher pitch for higher targets', () => {
      const ai = new AI('HARD');
      const cannon = makeCannon(-16, 10, 0, 1);
      const lowTarget = { x: 16, y: 2, z: 0 };
      const highTarget = { x: 16, y: 12, z: 0 };
      const lowAim = ai.computeAim(cannon, lowTarget, mode);
      const highAim = ai.computeAim(cannon, highTarget, mode);
      expect(highAim.pitch).toBeGreaterThan(lowAim.pitch);
    });

    it('should work for player 2 cannon (facing -X)', () => {
      const ai = new AI('HARD');
      const cannon = makeCannon(16, 10, 0, -1);
      const target = { x: -16, y: 2, z: 0 };
      const aim = ai.computeAim(cannon, target, mode);

      expect(aim.pitch).toBeGreaterThanOrEqual(MIN_PITCH);
      expect(aim.pitch).toBeLessThanOrEqual(MAX_PITCH);
      expect(aim.power).toBeGreaterThanOrEqual(MIN_POWER);
      expect(aim.power).toBeLessThanOrEqual(MAX_POWER);
    });
  });

  describe('computeAim — zero-G mode', () => {
    const mode = GAME_MODES.SPACE;

    it('should return valid aim for zero gravity', () => {
      const ai = new AI('MEDIUM');
      const cannon = makeCannon(-16, 10, 0, 1);
      const target = { x: 16, y: 10, z: 3 };
      const aim = ai.computeAim(cannon, target, mode);

      expect(aim.power).toBeGreaterThanOrEqual(MIN_POWER);
      expect(aim.power).toBeLessThanOrEqual(MAX_POWER);
      expect(Number.isFinite(aim.yaw)).toBe(true);
      expect(Number.isFinite(aim.pitch)).toBe(true);
    });

    it('should aim roughly level when target is at same height', () => {
      const ai = new AI('HARD');
      const cannon = makeCannon(-16, 10, 0, 1);
      const target = { x: 16, y: 10, z: 0 };
      const aim = ai.computeAim(cannon, target, mode);
      expect(Math.abs(aim.pitch)).toBeLessThan(0.2);
    });
  });

  describe('applySpread', () => {
    it('should keep aim within valid bounds after spread', () => {
      const ai = new AI('EASY'); // largest spread
      const baseAim = { yaw: 0, pitch: Math.PI / 6, power: 30 };
      for (let i = 0; i < 50; i++) {
        const spread = ai.applySpread(baseAim);
        expect(spread.power).toBeGreaterThanOrEqual(MIN_POWER);
        expect(spread.power).toBeLessThanOrEqual(MAX_POWER);
        expect(Number.isFinite(spread.yaw)).toBe(true);
        expect(Number.isFinite(spread.pitch)).toBe(true);
      }
    });

    it('EASY should have more spread than HARD', () => {
      const easy = new AI('EASY');
      const hard = new AI('HARD');
      const baseAim = { yaw: 0, pitch: Math.PI / 6, power: 30 };
      let easyVariance = 0, hardVariance = 0;
      const N = 200;
      for (let i = 0; i < N; i++) {
        const e = easy.applySpread(baseAim);
        const h = hard.applySpread(baseAim);
        easyVariance += Math.abs(e.yaw) + Math.abs(e.pitch - baseAim.pitch);
        hardVariance += Math.abs(h.yaw) + Math.abs(h.pitch - baseAim.pitch);
      }
      expect(easyVariance / N).toBeGreaterThan(hardVariance / N);
    });
  });

  describe('aiming animation', () => {
    it('startAiming should return a promise that resolves with final aim', async () => {
      const ai = new AI('HARD');
      const cannon = makeCannon(0, 10, 0, 1);
      cannon.yaw = 0;
      cannon.pitch = Math.PI / 6;
      const target = { yaw: 0.3, pitch: 0.8, power: 40 };

      const promise = ai.startAiming(cannon, target);
      // Simulate frames until done
      for (let i = 0; i < 200; i++) {
        const done = ai.updateAiming(0.016, cannon);
        if (done) break;
      }
      const result = await promise;
      expect(result.yaw).toBeCloseTo(0.3, 2);
      expect(result.pitch).toBeCloseTo(0.8, 2);
      expect(result.power).toBeCloseTo(40, 0);
    });

    it('updateAiming should smoothly interpolate from start to target', () => {
      const ai = new AI('MEDIUM');
      const cannon = makeCannon(0, 10, 0, 1);
      cannon.yaw = 0;
      cannon.pitch = 0;

      ai.startAiming(cannon, { yaw: 0.4, pitch: 0.6, power: 30 });

      // After a few frames, cannon should be partway there
      for (let i = 0; i < 10; i++) ai.updateAiming(0.016, cannon);
      expect(cannon.yaw).toBeGreaterThan(0);
      expect(cannon.yaw).toBeLessThan(0.4);
      expect(cannon.pitch).toBeGreaterThan(0);
      expect(cannon.pitch).toBeLessThan(0.6);
    });

    it('should clamp target aim to valid ranges', async () => {
      const ai = new AI('HARD');
      const cannon = makeCannon(0, 10, 0, 1);
      cannon.yaw = 0;
      cannon.pitch = 0;
      // Extreme values that exceed valid ranges
      const promise = ai.startAiming(cannon, { yaw: 99, pitch: 99, power: 999 });
      for (let i = 0; i < 200; i++) {
        if (ai.updateAiming(0.016, cannon)) break;
      }
      const result = await promise;
      expect(result.yaw).toBeLessThanOrEqual(MAX_YAW_OFFSET);
      expect(result.pitch).toBeLessThanOrEqual(MAX_PITCH);
      expect(result.power).toBeLessThanOrEqual(MAX_POWER);
    });
  });
});
