import { describe, it, expect } from 'vitest';
import { getPreset } from '../src/Presets.js';
import { getPiratePreset } from '../src/PiratePresets.js';
import { getSpacePreset } from '../src/SpacePresets.js';
import { BLOCK_TYPES } from '../src/constants.js';
import { GAME_MODES } from '../src/GameModes.js';
import { validateCastle } from '../shared/rules.js';

function presetCost(layout) {
  return layout.reduce((sum, b) => sum + (BLOCK_TYPES[b.type]?.cost || 0), 0);
}

function validatePreset(preset, name) {
  describe(name, () => {
    it('should have a layout array', () => {
      expect(Array.isArray(preset.layout)).toBe(true);
      expect(preset.layout.length).toBeGreaterThan(0);
    });

    it('should have a target position', () => {
      expect(preset.target).toBeDefined();
      expect(preset.target).toHaveProperty('x');
      expect(preset.target).toHaveProperty('y');
      expect(preset.target).toHaveProperty('z');
    });

    it('should have a cannon position', () => {
      expect(preset.cannonPos).toBeDefined();
      expect(preset.cannonPos).toHaveProperty('x');
      expect(preset.cannonPos).toHaveProperty('z');
    });

    it('should only use valid block types', () => {
      for (const block of preset.layout) {
        expect(BLOCK_TYPES, `unknown block type: ${block.type}`).toHaveProperty(block.type);
      }
    });

    it('target should not be fully enclosed by a full cube', () => {
      const t = preset.target;
      const overlap = preset.layout.find(
        b => b.x === t.x && b.y === t.y && b.z === t.z && b.type === 'CUBE'
      );
      expect(overlap, 'target enclosed by a cube').toBeUndefined();
    });
  });
}

describe('Castle Presets', () => {
  for (const name of GAME_MODES.CASTLE.presets) {
    const preset = getPreset(name, 'castle');
    validatePreset(preset, name);

    it(`${name} should be within castle budget`, () => {
      expect(presetCost(preset.layout)).toBeLessThanOrEqual(GAME_MODES.CASTLE.budget);
    });
  }
});

describe('Pirate Presets', () => {
  for (const name of GAME_MODES.PIRATE.presets) {
    const preset = getPiratePreset(name);
    validatePreset(preset, name);

    it(`${name} should be within pirate budget`, () => {
      expect(presetCost(preset.layout)).toBeLessThanOrEqual(GAME_MODES.PIRATE.budget);
    });

    it(`${name} should have a floor array`, () => {
      expect(preset).toHaveProperty('floor');
      expect(Array.isArray(preset.floor)).toBe(true);
    });
  }
});

describe('Space Presets', () => {
  for (const name of GAME_MODES.SPACE.presets) {
    const preset = getSpacePreset(name);
    validatePreset(preset, name);

    it(`${name} should be within space budget`, () => {
      expect(presetCost(preset.layout)).toBeLessThanOrEqual(GAME_MODES.SPACE.budget);
    });

    it(`${name} should have an empty floor array`, () => {
      expect(preset).toHaveProperty('floor');
      expect(preset.floor).toEqual([]);
    });
  }
});

describe('Presets pass server validation', () => {
  // A preset the server rejects would leave an online player stuck waiting
  const sources = { CASTLE: getPreset, PIRATE: getPiratePreset, SPACE: getSpacePreset };
  for (const [modeKey, getter] of Object.entries(sources)) {
    const mode = GAME_MODES[modeKey];
    for (const name of mode.presets) {
      it(`${modeKey} ${name}`, () => {
        expect(validateCastle(getter(name, mode.id), mode.id)).not.toBeNull();
      });
    }
  }
});
