import { describe, it, expect } from 'vitest';
import { AI } from '../src/AI.js';
import { MIN_POWER, MAX_POWER, MIN_PITCH, MAX_PITCH } from '../src/constants.js';
import { GAME_MODES } from '../src/GameModes.js';

function makeCannon(x, y, z, facing) {
  return {
    group: { position: { x, y, z } },
    facingDirection: facing,
    yaw: 0,
    pitch: Math.PI / 6,
    updateAim() {},
  };
}

const castleMode = GAME_MODES.CASTLE;
const spaceMode = GAME_MODES.SPACE;

describe('AI Difficulty Behavioral Differences', () => {
  describe('preferHighArc', () => {
    it('EASY prefers high arc trajectories', () => {
      const easy = new AI('EASY');
      const cannon = makeCannon(-16, 10, 0, 1);
      const target = { x: 16, y: 2, z: 0 };

      // Run multiple times and collect pitches
      const pitches = [];
      for (let i = 0; i < 50; i++) {
        const aim = easy.computeAim(cannon, target, castleMode);
        pitches.push(aim.pitch);
      }
      const avgEasyPitch = pitches.reduce((a, b) => a + b) / pitches.length;

      const hard = new AI('HARD');
      const hardPitches = [];
      for (let i = 0; i < 50; i++) {
        const aim = hard.computeAim(cannon, target, castleMode);
        hardPitches.push(aim.pitch);
      }
      const avgHardPitch = hardPitches.reduce((a, b) => a + b) / hardPitches.length;

      // Easy should tend toward higher pitch (lobbing) than hard (aggressive low arc)
      expect(avgEasyPitch).toBeGreaterThan(avgHardPitch);
    });
  });

  describe('powerStrategy', () => {
    it('EASY uses random power strategy with high variance', () => {
      const easy = new AI('EASY');
      const cannon = makeCannon(-16, 10, 0, 1);
      const target = { x: 16, y: 2, z: 0 };

      const powers = [];
      for (let i = 0; i < 100; i++) {
        const aim = easy.computeAim(cannon, target, castleMode);
        powers.push(aim.power);
      }

      const min = Math.min(...powers);
      const max = Math.max(...powers);
      // Random strategy should produce wide spread
      expect(max - min).toBeGreaterThan(10);
    });

    it('HARD uses optimal power strategy with low variance', () => {
      const hard = new AI('HARD');
      const cannon = makeCannon(-16, 10, 0, 1);
      const target = { x: 16, y: 2, z: 0 };

      const powers = [];
      for (let i = 0; i < 100; i++) {
        const aim = hard.computeAim(cannon, target, castleMode);
        powers.push(aim.power);
      }

      const min = Math.min(...powers);
      const max = Math.max(...powers);
      // Optimal strategy: no additional variance on power after solve
      // Only source of variance is the ballistic solver's power sweep
      expect(max - min).toBeLessThan(5);
    });

    it('all difficulties keep power within valid bounds', () => {
      for (const diff of ['EASY', 'MEDIUM', 'HARD']) {
        const ai = new AI(diff);
        const cannon = makeCannon(-16, 10, 0, 1);
        const target = { x: 16, y: 2, z: 0 };
        for (let i = 0; i < 50; i++) {
          const aim = ai.computeAim(cannon, target, castleMode);
          expect(aim.power).toBeGreaterThanOrEqual(MIN_POWER);
          expect(aim.power).toBeLessThanOrEqual(MAX_POWER);
        }
      }
    });
  });

  describe('zero-G powerStrategy', () => {
    it('EASY picks random power in zero-G', () => {
      const easy = new AI('EASY');
      const cannon = makeCannon(-16, 10, 0, 1);
      const target = { x: 16, y: 10, z: 0 };

      const powers = [];
      for (let i = 0; i < 100; i++) {
        powers.push(easy.computeAim(cannon, target, spaceMode).power);
      }
      const range = Math.max(...powers) - Math.min(...powers);
      expect(range).toBeGreaterThan(10);
    });

    it('HARD picks optimal power in zero-G', () => {
      const hard = new AI('HARD');
      const cannon = makeCannon(-16, 10, 0, 1);
      const target = { x: 16, y: 10, z: 0 };

      const powers = [];
      for (let i = 0; i < 50; i++) {
        powers.push(hard.computeAim(cannon, target, spaceMode).power);
      }
      const range = Math.max(...powers) - Math.min(...powers);
      // Optimal strategy in zero-G should be very consistent
      expect(range).toBeLessThan(1);
    });
  });

  describe('hesitation', () => {
    it('EASY has longer hesitation than HARD', () => {
      const easy = new AI('EASY');
      const hard = new AI('HARD');
      expect(easy.difficulty.hesitation).toBeGreaterThan(hard.difficulty.hesitation);
    });

    it('HARD has zero hesitation', () => {
      const hard = new AI('HARD');
      expect(hard.difficulty.hesitation).toBe(0);
    });

    it('all difficulties have defined hesitation values', () => {
      for (const diff of ['EASY', 'MEDIUM', 'HARD']) {
        const ai = new AI(diff);
        expect(typeof ai.difficulty.hesitation).toBe('number');
        expect(ai.difficulty.hesitation).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('aimTime', () => {
    it('EASY aims slower than HARD', () => {
      const easy = new AI('EASY');
      const hard = new AI('HARD');
      expect(easy.difficulty.aimTime).toBeGreaterThan(hard.difficulty.aimTime);
    });
  });

  describe('repositionStrategy', () => {
    it('EASY uses random repositioning', () => {
      const easy = new AI('EASY');
      expect(easy.difficulty.repositionStrategy).toBe('random');
    });

    it('MEDIUM uses covered repositioning', () => {
      const med = new AI('MEDIUM');
      expect(med.difficulty.repositionStrategy).toBe('covered');
    });

    it('HARD uses optimal repositioning', () => {
      const hard = new AI('HARD');
      expect(hard.difficulty.repositionStrategy).toBe('optimal');
    });

    it('optimal strategy picks positions with most cover', () => {
      const hard = new AI('HARD');
      // Castle with blocks concentrated at low X values
      const castle = {
        gridWidth: 9,
        gridDepth: 9,
        layoutData: [
          { x: 0, y: 0, z: 4 },
          { x: 1, y: 0, z: 4 },
          { x: 2, y: 0, z: 4 },
          { x: 3, y: 0, z: 4 },
          { x: 0, y: 0, z: 3 },
          { x: 1, y: 0, z: 3 },
        ],
      };

      // Over many picks, optimal should favor high-x positions (more blocks in front)
      const xValues = [];
      for (let i = 0; i < 100; i++) {
        const pos = hard.chooseRepositionTarget(castle);
        xValues.push(pos.x);
      }
      const avgX = xValues.reduce((a, b) => a + b) / xValues.length;
      // With blocks at x=0-3, positions at x>3 have cover, so average should lean right
      expect(avgX).toBeGreaterThan(3);
    });

    it('random strategy produces varied positions', () => {
      const easy = new AI('EASY');
      const castle = { gridWidth: 9, gridDepth: 9, layoutData: [] };

      const positions = new Set();
      for (let i = 0; i < 100; i++) {
        const pos = easy.chooseRepositionTarget(castle);
        positions.add(`${pos.x},${pos.z}`);
      }
      // Random should hit many different cells
      expect(positions.size).toBeGreaterThan(10);
    });
  });

  describe('difficulty defaults', () => {
    it('falls back to MEDIUM for unknown difficulty', () => {
      const ai = new AI('NIGHTMARE');
      expect(ai.difficulty.spreadRad).toBe(0.10);
      expect(ai.difficulty.repositionStrategy).toBe('covered');
    });
  });
});
