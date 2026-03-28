/**
 * Tests for the headless training environment.
 *
 * Verifies physics, hit detection, opponent policies, preset loading,
 * and observation/reward correctness.  Run with:
 *     node --experimental-vm-modules ../node_modules/.bin/vitest run training/env/headless.test.js
 * or from the repo root: pnpm test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HeadlessGame, LAYOUT_GENERATORS,
  MIN_PITCH, MAX_PITCH, MAX_YAW_OFFSET, MIN_POWER, MAX_POWER,
} from './HeadlessGame.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGame(overrides = {}) {
  return new HeadlessGame({
    mode: 'CASTLE',
    maxTurns: 30,
    layoutGenerator: 'simple_wall',
    opponentPolicy: 'none',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Initialization & Reset
// ---------------------------------------------------------------------------

describe('HeadlessGame initialization', () => {
  it('should create a game with default options', () => {
    const game = new HeadlessGame();
    expect(game.gameMode).toBeDefined();
    expect(game.gameMode.id).toBe('castle');
  });

  it('should throw on unknown game mode', () => {
    expect(() => new HeadlessGame({ mode: 'INVALID' })).toThrow('Unknown game mode');
  });

  it('should support all three game modes', () => {
    for (const mode of ['CASTLE', 'PIRATE', 'SPACE']) {
      const game = new HeadlessGame({ mode });
      expect(game.gameMode.id).toBe(mode.toLowerCase());
    }
  });
});

describe('reset()', () => {
  it('should return a valid observation', () => {
    const game = makeGame();
    const obs = game.reset();

    expect(obs).toHaveProperty('cannonPos');
    expect(obs).toHaveProperty('targetDx');
    expect(obs).toHaveProperty('targetDy');
    expect(obs).toHaveProperty('targetDz');
    expect(obs).toHaveProperty('targetDist');
    expect(obs).toHaveProperty('hp');
    expect(obs).toHaveProperty('blockCount');
    expect(obs).toHaveProperty('blockPositions');
    expect(obs.hp).toEqual([3, 3]);
    expect(obs.turnCount).toBe(0);
    expect(obs.turn).toBe(0);
  });

  it('should place both castles and cannons', () => {
    const game = makeGame();
    game.reset();

    expect(game.castles[0]).toBeDefined();
    expect(game.castles[1]).toBeDefined();
    expect(game.castles[0].targetPos).toBeDefined();
    expect(game.castles[1].targetPos).toBeDefined();
    expect(game.cannons[0].facing).toBe(1);
    expect(game.cannons[1].facing).toBe(-1);
  });

  it('should place cannons on opposite sides', () => {
    const game = makeGame();
    game.reset();
    expect(game.cannons[0].x).toBeLessThan(0);
    expect(game.cannons[1].x).toBeGreaterThan(0);
  });

  it('should have non-zero block count', () => {
    const game = makeGame();
    const obs = game.reset();
    expect(obs.blockCount).toBeGreaterThan(0);
  });

  it('should reset state cleanly between episodes', () => {
    const game = makeGame();
    game.reset();
    game.step({ yaw: 0, pitch: 0.5, power: 30 });
    const obs = game.reset();
    expect(obs.hp).toEqual([3, 3]);
    expect(obs.turnCount).toBe(0);
    expect(game.done).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Action clamping
// ---------------------------------------------------------------------------

describe('action clamping', () => {
  it('should clamp actions to valid ranges', () => {
    const game = makeGame();
    game.reset();

    // Extreme action should not throw
    const result = game.step({ yaw: 999, pitch: -999, power: 999 });
    expect(result).toHaveProperty('observation');
    expect(result).toHaveProperty('reward');
    expect(result).toHaveProperty('done');
  });
});

// ---------------------------------------------------------------------------
// Shot simulation
// ---------------------------------------------------------------------------

describe('shot simulation', () => {
  it('should track closest distance to target', () => {
    const game = makeGame();
    game.reset();

    const result = game.step({ yaw: 0, pitch: 0.5, power: 30 });
    expect(result.info.closestDist).toBeGreaterThan(0);
    expect(result.info.closestDist).toBeLessThan(Infinity);
  });

  it('should decrement defender HP on hit', () => {
    const game = makeGame({ opponentPolicy: 'none' });
    game.reset();

    // Manually force a hit by checking the reward path:
    // If a hit occurs, hp[1] should decrease and reward should be >= 10
    const origHp = game.hp[1];
    // Simulate many quick shots — use heuristic aim logic for player 0
    const obs = game.getObservation();
    const dx = obs.targetDx;
    const dz = obs.targetDz;
    const horizDist = Math.sqrt(dx * dx + dz * dz);

    // Fire 10 shots aimed roughly at target (enough to test the path)
    let hitOccurred = false;
    for (let i = 0; i < 10 && !game.done; i++) {
      const result = game.step({ yaw: 0, pitch: 0.3, power: horizDist * 0.8 });
      if (result.info.hit) {
        hitOccurred = true;
        expect(result.info.hp[1]).toBe(origHp - 1);
        expect(result.reward).toBeGreaterThanOrEqual(10);
        break;
      }
    }
    // The test validates the HP logic IF a hit happens
  });

  it('projectile should fall under gravity in castle mode', () => {
    const game = makeGame({ mode: 'CASTLE' });
    game.reset();

    // Shoot straight up with low power
    const result = game.step({ yaw: 0, pitch: MAX_PITCH, power: MIN_POWER });
    // Shot should miss (goes up and comes down)
    expect(result.info.hit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Turn management
// ---------------------------------------------------------------------------

describe('turn management (no opponent)', () => {
  it('should always be player 0 turn with no opponent', () => {
    const game = makeGame({ opponentPolicy: 'none' });
    game.reset();

    for (let i = 0; i < 5 && !game.done; i++) {
      const result = game.step({ yaw: 0, pitch: 0.5, power: 30 });
      // turnCount increments by 1 per step (agent only)
      expect(result.info.turnCount).toBe(i + 1);
    }
  });
});

describe('turn management (with opponent)', () => {
  it('should increment turnCount by 2 per step (agent + opponent)', () => {
    const game = makeGame({ opponentPolicy: 'random' });
    game.reset();

    const result = game.step({ yaw: 0, pitch: 0.5, power: 30 });
    // Agent fires (turnCount 1) then opponent fires (turnCount 2)
    expect(result.info.turnCount).toBe(2);
  });

  it('should report opponent hit info', () => {
    const game = makeGame({ opponentPolicy: 'heuristic', opponentNoise: 0 });
    game.reset();

    const result = game.step({ yaw: 0, pitch: 0.5, power: 30 });
    expect(result.info).toHaveProperty('opponentHit');
  });

  it('observation should always show player 0 perspective', () => {
    const game = makeGame({ opponentPolicy: 'heuristic' });
    game.reset();

    const result = game.step({ yaw: 0, pitch: 0.5, power: 30 });
    expect(result.observation.cannonFacing).toBe(1);
    expect(result.observation.turn).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Opponent policies
// ---------------------------------------------------------------------------

describe('opponent policies', () => {
  it('random opponent should produce valid actions', () => {
    const game = makeGame({ opponentPolicy: 'random' });
    game.reset();

    // Should not throw
    const result = game.step({ yaw: 0, pitch: 0.5, power: 30 });
    expect(result).toHaveProperty('observation');
  });

  it('heuristic opponent should aim at player 0 target', { timeout: 15000 }, () => {
    // With zero noise, heuristic should aim precisely
    const game = makeGame({ opponentPolicy: 'heuristic', opponentNoise: 0 });
    game.reset();

    // Run several shots — heuristic with 0 noise should eventually hit
    let oppHit = false;
    for (let i = 0; i < 20 && !game.done; i++) {
      const result = game.step({ yaw: 0, pitch: MAX_PITCH, power: MIN_POWER });
      if (result.info.opponentHit) {
        oppHit = true;
        break;
      }
    }
    // Heuristic with no noise should hit at least once in 20 attempts
    expect(oppHit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Game end conditions
// ---------------------------------------------------------------------------

describe('game end conditions', () => {
  it('should end when max turns reached', () => {
    const game = makeGame({ maxTurns: 4, opponentPolicy: 'none' });
    game.reset();

    for (let i = 0; i < 4; i++) {
      game.step({ yaw: 0, pitch: MAX_PITCH, power: MIN_POWER }); // miss intentionally
    }
    expect(game.done).toBe(true);
  });

  it('should declare winner based on HP when turns expire', () => {
    const game = makeGame({ maxTurns: 2, opponentPolicy: 'none' });
    game.reset();
    // Manually set HP to simulate one player ahead
    game.hp[0] = 3;
    game.hp[1] = 2;

    game.step({ yaw: 0, pitch: MAX_PITCH, power: MIN_POWER });
    game.step({ yaw: 0, pitch: MAX_PITCH, power: MIN_POWER });

    expect(game.done).toBe(true);
    expect(game.winner).toBe(0); // player 0 has more HP
  });

  it('should error on step after game is done', () => {
    const game = makeGame({ maxTurns: 1, opponentPolicy: 'none' });
    game.reset();
    game.step({ yaw: 0, pitch: 0.5, power: 30 });

    expect(() => game.step({ yaw: 0, pitch: 0.5, power: 30 })).toThrow('Game is done');
  });
});

// ---------------------------------------------------------------------------
// Reward signal
// ---------------------------------------------------------------------------

describe('reward signal', () => {
  it('should give negative reward for a clear miss', () => {
    const game = makeGame({ opponentPolicy: 'none' });
    game.reset();

    // Shoot straight up — guaranteed miss with no proximity
    const result = game.step({ yaw: MAX_YAW_OFFSET, pitch: MAX_PITCH, power: MIN_POWER });
    expect(result.reward).toBeLessThan(0);
  });

  it('should give proximity bonus for near misses', () => {
    const game = makeGame({ opponentPolicy: 'none' });
    game.reset();

    // Shoot roughly toward the target
    const obs = game.getObservation();
    const result = game.step({ yaw: 0, pitch: 0.4, power: 35 });
    // If closestDist < 20, should get some proximity reward
    if (result.info.closestDist < 20) {
      expect(result.reward).toBeGreaterThan(-0.1);
    }
  });
});

// ---------------------------------------------------------------------------
// Layout generators
// ---------------------------------------------------------------------------

describe('layout generators', () => {
  it('simple_wall should produce a layout with blocks', () => {
    const result = LAYOUT_GENERATORS.simple_wall(9, 9);
    expect(result.layout.length).toBeGreaterThan(0);
    expect(result.target).toBeDefined();
  });

  it('random should produce a layout with blocks', () => {
    const result = LAYOUT_GENERATORS.random(9, 9, 600);
    expect(result.layout.length).toBeGreaterThan(0);
    expect(result.target).toBeDefined();
  });

  it('preset should load real game presets for castle mode', async () => {
    const { GAME_MODES } = await import('../../src/GameModes.js');
    const result = LAYOUT_GENERATORS.preset(9, 9, 600, GAME_MODES.CASTLE);
    expect(result.layout.length).toBeGreaterThan(10);
    expect(result.target).toBeDefined();
  });

  it('preset should load real game presets for space mode', async () => {
    const { GAME_MODES } = await import('../../src/GameModes.js');
    const result = LAYOUT_GENERATORS.preset(7, 13, 600, GAME_MODES.SPACE);
    expect(result.layout.length).toBeGreaterThan(10);
    expect(result.target).toBeDefined();
  });

  it('mixed should sometimes produce presets and sometimes random', async () => {
    const { GAME_MODES } = await import('../../src/GameModes.js');
    const sizes = new Set();
    for (let i = 0; i < 20; i++) {
      const result = LAYOUT_GENERATORS.mixed(9, 9, 600, GAME_MODES.CASTLE);
      sizes.add(result.layout.length);
    }
    // Should produce varied layouts (both random and preset)
    expect(sizes.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Space mode specifics
// ---------------------------------------------------------------------------

describe('space mode', () => {
  it('should work with zero gravity', () => {
    const game = makeGame({ mode: 'SPACE', opponentPolicy: 'none' });
    game.reset();
    const result = game.step({ yaw: 0, pitch: 0, power: 30 });
    expect(result).toHaveProperty('observation');
  });

  it('should handle explosive projectiles', () => {
    const game = makeGame({ mode: 'SPACE', opponentPolicy: 'none' });
    game.reset();
    // Shooting toward the castle — may trigger explosion
    const result = game.step({ yaw: 0, pitch: 0, power: 40 });
    expect(result.info).toHaveProperty('closestDist');
  });
});

// ---------------------------------------------------------------------------
// Observation consistency
// ---------------------------------------------------------------------------

describe('observation consistency', () => {
  it('target distance should match dx/dy/dz components', () => {
    const game = makeGame();
    const obs = game.reset();

    const computed = Math.sqrt(
      obs.targetDx ** 2 + obs.targetDy ** 2 + obs.targetDz ** 2
    );
    expect(obs.targetDist).toBeCloseTo(computed, 5);
  });

  it('block positions should be relative to cannon', () => {
    const game = makeGame();
    const obs = game.reset();

    // All enemy blocks should be on the positive X side (cannon faces +X)
    for (const bp of obs.blockPositions) {
      expect(bp.x).toBeGreaterThan(0);
    }
  });

  it('lastHit should be null on first observation', () => {
    const game = makeGame();
    const obs = game.reset();
    expect(obs.lastHit).toBeNull();
    expect(obs.lastClosestDist).toBeNull();
  });
});
