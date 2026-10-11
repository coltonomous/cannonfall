/**
 * @vitest-environment jsdom
 *
 * BattleController housekeeping on a real Game: debris cleanup, shield fade
 * and cancelling scheduled launches. Mock THREE, real cannon-es physics.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('three', async () => await import('./helpers/mock-three.js'));
vi.mock('socket.io-client', () => ({
  io: () => ({ on: () => {}, emit: () => {}, disconnect: () => {}, io: { on: () => {} } }),
}));

const { Game } = await import('../src/Game.js');
const { GAME_MODES } = await import('../src/GameModes.js');
const { getPreset } = await import('../src/Presets.js');
const { getSpacePreset } = await import('../src/SpacePresets.js');
import * as C from '../src/constants.js';
import { loadIndexHtml } from './helpers/dom.js';

function localBattle(modeKey, castleData) {
  loadIndexHtml();
  const game = new Game(document.getElementById('game-canvas'));
  game.gameMode = GAME_MODES[modeKey];
  game.applyGameMode();
  game.mode = 'local';
  game.buildBothCastles(castleData, castleData);
  game.syncBattle();
  return game;
}

function isGone(game, castle, { mesh, body }) {
  return !castle.blocks.some(b => b.body === body)
    && !game.physicsWorld.world.bodies.includes(body)
    && !game.physicsWorld.pairs.some(p => p.body === body)
    && !game.sceneManager.scene.children.includes(mesh);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('cleanupFallenBlocks', () => {
  it('removes blocks that fall out of bounds from the castle, physics world and scene', () => {
    const game = localBattle('CASTLE', getPreset('KEEP', 'castle'));
    const castle = game.castles[0];
    const block = castle.blocks.find(b => b.body.mass > 0);
    const count = castle.blocks.length;

    block.body.position.y = game.gameMode.outOfBoundsY - 1;
    game.battle.cleanupFallenBlocks();

    expect(castle.blocks).toHaveLength(count - 1);
    expect(isGone(game, castle, block)).toBe(true);
  });

  it('removes blocks that drift past the side bounds', () => {
    const game = localBattle('CASTLE', getPreset('KEEP', 'castle'));
    const castle = game.castles[1];
    const block = castle.blocks.find(b => b.body.mass > 0);
    block.body.position.z = C.DEFAULT_BOUNDS + 1;
    game.battle.cleanupFallenBlocks();
    expect(isGone(game, castle, block)).toBe(true);
  });

  it('fades out a shield once it is knocked, then removes it', () => {
    const game = localBattle('SPACE', getSpacePreset('FRIGATE'));
    const castle = game.castles[0];
    const shield = castle.blocks.find(b => b.body.isShield);
    const startOpacity = shield.mesh.material.opacity;

    game.battle.cleanupFallenBlocks();
    expect(shield.mesh.material.opacity).toBe(startOpacity); // untouched shields stay solid

    shield.body.velocity.set(5, 0, 0);
    game.battle.cleanupFallenBlocks();
    expect(shield.mesh.material.opacity).toBeLessThan(startOpacity);

    shield.body.velocity.set(0, 0, 0); // keeps fading once hit
    for (let i = 0; i < 50 && !isGone(game, castle, shield); i++) game.battle.cleanupFallenBlocks();
    expect(isGone(game, castle, shield)).toBe(true);
  });

  it('keeps drifting blocks awake in debris-field mode', () => {
    const game = localBattle('SPACE', getSpacePreset('FRIGATE'));
    game.battle.cleanupFallenBlocks();
    const dynamic = game.castles[0].blocks.filter(b => b.body.mass > 0);
    expect(dynamic.length).toBeGreaterThan(0);
    expect(dynamic.every(b => b.body.allowSleep === false)).toBe(true);
  });
});

describe('scheduled launches', () => {
  it('fires a perfect shot after the wind-up delay', () => {
    vi.useFakeTimers();
    const game = localBattle('CASTLE', getPreset('KEEP', 'castle'));
    game.battle.fire(true);
    expect(game.battle.projectile).toBeNull();
    vi.advanceTimersByTime(C.PERFECT_FIRE_DELAY);
    expect(game.battle.projectile).not.toBeNull();
  });

  it('cancels a pending perfect shot on reset', () => {
    vi.useFakeTimers();
    const game = localBattle('CASTLE', getPreset('KEEP', 'castle'));
    game.battle.fire(true);
    game.battle.reset();
    vi.advanceTimersByTime(C.PERFECT_FIRE_DELAY * 2);
    expect(game.battle.projectile).toBeNull();
  });
});
