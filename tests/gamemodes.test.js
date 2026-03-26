import { describe, it, expect } from 'vitest';
import { GAME_MODES } from '../src/GameModes.js';

const REQUIRED_FIELDS = [
  'id', 'label', 'structureLabel',
  'backgroundColor', 'hasGround',
  'ambientIntensity', 'dirIntensity', 'dirPosition',
  'gravity', 'friction', 'restitution', 'explosiveProjectile',
  'player0Color', 'player1Color', 'floorColor',
  'cannonBaseColor', 'cannonBarrelColor',
  'projectileColor', 'projectileMetalness', 'projectileRoughness',
  'perfectColor', 'perfectEmissive', 'perfectEmissiveIntensity',
  'muzzleColor', 'perfectMuzzleColor', 'impactColor', 'trailColor',
  'presets', 'outOfBoundsY', 'gridWidth', 'gridDepth',
  'budget', 'maxLayers',
  'blastRadius', 'blastForce', 'perfectBlastRadius', 'perfectBlastForce', 'explosionDelay',
  'castleOffsetX',
];

describe('Game Modes', () => {
  const modes = Object.entries(GAME_MODES);

  it('should have at least 3 modes', () => {
    expect(modes.length).toBeGreaterThanOrEqual(3);
  });

  for (const [name, mode] of modes) {
    describe(name, () => {
      it('should have all required fields', () => {
        for (const field of REQUIRED_FIELDS) {
          expect(mode, `missing field: ${field}`).toHaveProperty(field);
        }
      });

      it('should have valid presets array', () => {
        expect(Array.isArray(mode.presets)).toBe(true);
        expect(mode.presets.length).toBeGreaterThanOrEqual(3);
      });

      it('should have consistent perfect shot colors (gold)', () => {
        expect(mode.perfectColor).toBe(0xffd700);
        expect(mode.perfectEmissive).toBe(0xaa8800);
      });

      it('should have positive budget', () => {
        expect(mode.budget).toBeGreaterThan(0);
      });

      it('should have valid grid dimensions', () => {
        expect(mode.gridWidth).toBeGreaterThan(0);
        expect(mode.gridDepth).toBeGreaterThan(0);
        expect(mode.maxLayers).toBeGreaterThan(0);
      });

      it('should have castleOffsetX', () => {
        expect(mode.castleOffsetX).toBeGreaterThan(0);
      });
    });
  }

  describe('difficulty progression', () => {
    it('pirate should be closest', () => {
      expect(GAME_MODES.PIRATE.castleOffsetX).toBeLessThan(GAME_MODES.CASTLE.castleOffsetX);
    });

    it('space should be furthest', () => {
      expect(GAME_MODES.SPACE.castleOffsetX).toBeGreaterThan(GAME_MODES.CASTLE.castleOffsetX);
    });
  });

  describe('mode-specific features', () => {
    it('pirate should have water surface', () => {
      expect(GAME_MODES.PIRATE.waterSurface).toBe(true);
    });

    it('pirate should have punch-through physics', () => {
      expect(GAME_MODES.PIRATE.blockMassMultiplier).toBeGreaterThan(1);
      expect(GAME_MODES.PIRATE.maxBlockSpeed).toBeGreaterThan(0);
      expect(GAME_MODES.PIRATE.blockDamping).toBeGreaterThan(0);
    });

    it('space should have zero gravity', () => {
      expect(GAME_MODES.SPACE.gravity).toBe(0);
    });

    it('space should have debris field', () => {
      expect(GAME_MODES.SPACE.debrisField).toBe(true);
    });

    it('space should have explosive projectiles', () => {
      expect(GAME_MODES.SPACE.explosiveProjectile).toBe(true);
    });

    it('space should have sci-fi cannon', () => {
      expect(GAME_MODES.SPACE.cannonStyle).toBe('scifi');
    });

    it('space should mirror Z for ship facing', () => {
      expect(GAME_MODES.SPACE.mirrorZ).toBe(true);
    });

    it('pirate should mirror Z for ship facing', () => {
      expect(GAME_MODES.PIRATE.mirrorZ).toBe(true);
    });

    it('castle should not mirror Z', () => {
      expect(GAME_MODES.CASTLE.mirrorZ).toBeFalsy();
    });

    it('castle should not have explosive projectiles', () => {
      expect(GAME_MODES.CASTLE.explosiveProjectile).toBe(false);
    });
  });
});
