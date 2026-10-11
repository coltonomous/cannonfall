/**
 * @vitest-environment jsdom
 *
 * Integration tests: simulate full game matches headlessly.
 * Uses a mock THREE.js to avoid WebGL, but runs real cannon-es physics,
 * real Castle building, real Projectile creation, and real hit detection.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock THREE.js before any game imports
vi.mock('three', async () => await import('./helpers/mock-three.js'));

// Mock socket.io-client
vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => {},
    emit: () => {},
    disconnect: () => {},
  }),
}));

// Now import game modules (they'll get mocked THREE)
const { Game } = await import('../src/Game.js');
const { GAME_MODES } = await import('../src/GameModes.js');
const { getPreset } = await import('../src/Presets.js');
const { getPiratePreset } = await import('../src/PiratePresets.js');
const { getSpacePreset } = await import('../src/SpacePresets.js');
import * as C from '../src/constants.js';
import { loadIndexHtml } from './helpers/dom.js';

function createGame() {
  loadIndexHtml();
  const canvas = document.getElementById('game-canvas');
  return new Game(canvas);
}

function startBattle(game, mode, preset0, preset1) {
  game.gameMode = GAME_MODES[mode];
  game.applyGameMode();
  game.mode = 'local';
  game.buildBothCastles(preset0, preset1);
  game.hp = [C.MAX_HP, C.MAX_HP];
  game.currentTurn = 0;
  game.playerIndex = 0;
  game.state = 'my_turn';
  game.syncBattle();
}

function fireAt(game, pitch, power) {
  const cannon = game.cannons[game.currentTurn];
  cannon.pitch = pitch;
  cannon.yaw = 0;
  if (cannon.updateAim) cannon.updateAim();
  game.battle.power = power;
  game.battle.fire(false);
  game.state = 'firing';
}

function stepUntilSettled(game, maxSeconds = 10) {
  const dt = 1 / 60;
  const maxSteps = maxSeconds * 60;
  for (let i = 0; i < maxSteps; i++) {
    game.physicsWorld.step(dt);
    game.physicsWorld.sync();

    if (game.battle.projectile?.alive) {
      const resolved = game.battle.checkProjectile(dt);
      if (resolved) break;
    } else {
      break;
    }
  }
}

describe('Integration: Full Match Simulation', () => {
  describe('Castle Mode', () => {
    let game;

    beforeEach(() => {
      game = createGame();
      const keep = getPreset('KEEP', 'castle');
      startBattle(game, 'CASTLE', keep, keep);
    });

    it('should create both castles with blocks', () => {
      expect(game.castles[0].blocks.length).toBeGreaterThan(50);
      expect(game.castles[1].blocks.length).toBeGreaterThan(50);
    });

    it('should create both cannons', () => {
      expect(game.cannons[0]).toBeDefined();
      expect(game.cannons[1]).toBeDefined();
    });

    it('should have castles at correct offsets', () => {
      expect(game.castles[0].centerX).toBe(-GAME_MODES.CASTLE.castleOffsetX);
      expect(game.castles[1].centerX).toBe(GAME_MODES.CASTLE.castleOffsetX);
    });

    it('should have floor offset for castle mode', () => {
      expect(game.castles[0]._floorOffset).toBeGreaterThan(0);
    });

    it('should start with full HP', () => {
      expect(game.hp).toEqual([C.MAX_HP, C.MAX_HP]);
    });

    it('should have targets at correct positions', () => {
      const t0 = game.castles[0].getTargetPosition();
      const t1 = game.castles[1].getTargetPosition();
      expect(t0).toBeDefined();
      expect(t1).toBeDefined();
      expect(t0.x).toBeLessThan(0); // player 0 castle is at -X
      expect(t1.x).toBeGreaterThan(0); // player 1 castle is at +X
    });
  });

  describe('Pirate Mode', () => {
    let game;

    beforeEach(() => {
      game = createGame();
      const galleon = getPiratePreset('GALLEON');
      startBattle(game, 'PIRATE', galleon, galleon);
    });

    it('should have no floor offset', () => {
      expect(game.castles[0]._floorOffset).toBe(0);
    });

    it('should have water surface physics', () => {
      expect(game.physicsWorld.waterSurface).toBe(true);
    });

    it('should have kinematic floor bodies for rocking', () => {
      expect(game.physicsWorld.kinematicFloors.length).toBeGreaterThan(0);
    });

    it('should have block speed cap', () => {
      expect(game.physicsWorld._maxBlockSpeed).toBeGreaterThan(0);
    });

    it('blocks should have pirate mass multiplier', () => {
      const dynamicBlock = game.castles[0].blocks.find(b => b.body.mass > 0);
      expect(dynamicBlock.body.mass).toBe(
        C.BLOCK_MASS * GAME_MODES.PIRATE.blockMassMultiplier
      );
    });

    it('blocks should have high damping', () => {
      const dynamicBlock = game.castles[0].blocks.find(b => b.body.mass > 0);
      expect(dynamicBlock.body.linearDamping).toBe(GAME_MODES.PIRATE.blockDamping);
    });

    it('player 0 ship should be Z-mirrored', () => {
      expect(game.castles[0].mirrorZ).toBe(true);
    });

    it('player 1 ship should not be Z-mirrored', () => {
      expect(game.castles[1].mirrorZ).toBeFalsy();
    });

    it('keel floor blocks should have no mesh (hidden)', () => {
      const nullMeshBlocks = game.castles[0].blocks.filter(b => !b.mesh && b.body.mass === 0);
      expect(nullMeshBlocks.length).toBeGreaterThan(0);
    });
  });

  describe('Space Mode', () => {
    let game;

    beforeEach(() => {
      game = createGame();
      const corvette = getSpacePreset('CORVETTE');
      startBattle(game, 'SPACE', corvette, corvette);
    });

    it('should have zero gravity', () => {
      expect(game.physicsWorld.world.gravity.y).toBe(0);
    });

    it('should not have ground plane', () => {
      expect(game.physicsWorld.hasGround).toBe(false);
      expect(game.physicsWorld.groundBody).toBeNull();
    });

    it('should have no floor offset', () => {
      expect(game.castles[0]._floorOffset).toBe(0);
    });

    it('shield blocks should be tagged', () => {
      const shields = game.castles[0].blocks.filter(b => b.body.isShield);
      // Corvette has shield blocks
      expect(shields.length).toBeGreaterThan(0);
    });

    it('thruster blocks should track exhaust direction', () => {
      expect(game.castles[0].thrusters.length).toBeGreaterThan(0);
      for (const t of game.castles[0].thrusters) {
        expect(t.exhaustDir).toBeDefined();
        expect(t.exhaustDir.length()).toBeCloseTo(1, 1); // unit vector
      }
    });

    it('should have wider cleanup bounds for debris', () => {
      expect(GAME_MODES.SPACE.debrisField).toBe(true);
    });
  });
});

describe('Integration: Projectile Physics', () => {
  let game;

  beforeEach(() => {
    game = createGame();
    const keep = getPreset('KEEP', 'castle');
    startBattle(game, 'CASTLE', keep, keep);
  });

  it('firing should create a projectile', () => {
    fireAt(game, 0.3, 30);
    expect(game.battle.projectile).toBeDefined();
    expect(game.battle.projectile.alive).toBe(true);
  });

  it('projectile should move after physics step', () => {
    fireAt(game, 0.1, 40);
    // Manually give the projectile velocity since mock cannon returns zero direction
    game.battle.projectile.body.velocity.set(30, 5, 0);
    const startX = game.battle.projectile.body.position.x;

    game.physicsWorld.step(1 / 60);

    expect(game.battle.projectile.body.position.x).not.toBeCloseTo(startX, 1);
  });

  it('projectile should follow gravity arc in castle mode', () => {
    fireAt(game, 0.3, 30);
    const startY = game.battle.projectile.body.position.y;

    // Step enough for gravity to take effect
    for (let i = 0; i < 120; i++) game.physicsWorld.step(1 / 60);

    // Should have risen then fallen — check it's moved vertically
    expect(game.battle.projectile.body.position.y).not.toBeCloseTo(startY, 0);
  });

  it('projectile should be tagged as isProjectile', () => {
    fireAt(game, 0.1, 20);
    expect(game.battle.projectile.body.isProjectile).toBe(true);
  });
});

describe('Integration: Hit Detection', () => {
  let game;

  beforeEach(() => {
    game = createGame();
    const keep = getPreset('KEEP', 'castle');
    startBattle(game, 'CASTLE', keep, keep);
  });

  it('should detect hit when projectile reaches target via collision', () => {
    fireAt(game, 0.1, 1);
    const target = game.castles[1].getTargetPosition();

    let hitDetected = false;
    game.events.on('target-hit', () => { hitDetected = true; });

    // Place projectile near target and step physics so collision fires
    game.battle.projectile.body.position.set(target.x - 0.5, target.y, target.z);
    game.battle.projectile.body.velocity.set(10, 0, 0);

    // Step physics to trigger collision, then checkProjectile to process deferred hit
    for (let i = 0; i < 30; i++) {
      game.physicsWorld.step(1 / 60);
      game.physicsWorld.sync();
      if (game.battle._pendingTargetHit) {
        game.battle.checkProjectile(1 / 60);
        break;
      }
    }
    expect(hitDetected).toBe(true);
  });

  it('should not detect hit when projectile is far from target', () => {
    fireAt(game, 0.1, 1);
    // Move projectile far away
    game.battle.projectile.body.position.set(0, 50, 0);

    let hitDetected = false;
    game.events.on('target-hit', () => { hitDetected = true; });

    game.battle.checkProjectile(1 / 60);
    expect(hitDetected).toBe(false);
  });

  it('should detect out of bounds', () => {
    fireAt(game, 0.1, 1);
    game.battle.projectile.body.position.set(0, -100, 0);

    let missDetected = false;
    game.events.on('shot-miss', () => { missDetected = true; });

    game.battle.checkProjectile(1 / 60);
    expect(missDetected).toBe(true);
  });
});

describe('Integration: Turn Flow', () => {
  let game;

  beforeEach(() => {
    game = createGame();
    const keep = getPreset('KEEP', 'castle');
    startBattle(game, 'CASTLE', keep, keep);
  });

  it('onShotMiss should advance turn in local mode', () => {
    expect(game.currentTurn).toBe(0);
    game.state = 'firing'; // onShotMiss transitions from firing
    game.onShotMiss();
    expect(game.state).toBe('turn_transition');
  });

  it('onTargetHit should reduce HP', () => {
    game.state = 'firing';
    game.battle._perfectShot = false;
    game.onTargetHit();
    expect(game.hp[1]).toBe(C.MAX_HP - 1);
  });

  it('perfect hit should deal double damage', () => {
    game.state = 'firing';
    game.battle._perfectShot = true;
    game.onTargetHit();
    expect(game.hp[1]).toBe(C.MAX_HP - 2);
  });

  it('lethal hit should end game', () => {
    game.state = 'firing';
    game.hp[1] = 1;
    game.battle._perfectShot = false;
    game.onTargetHit();
    expect(game.state).toBe('game_over');
  });
});

describe('Integration: Z-Mirror', () => {
  it('pirate mode should mirror player 0 layout', () => {
    const game = createGame();
    const galleon = getPiratePreset('GALLEON');

    // Original target Z
    const origZ = galleon.target.z;
    const gridDepth = GAME_MODES.PIRATE.gridDepth;

    startBattle(game, 'PIRATE', galleon, galleon);

    // Player 0's target should be Z-mirrored
    const t0 = game.castles[0].getTargetPosition();
    const t1 = game.castles[1].getTargetPosition();

    // The two targets should be at different Z positions (mirrored)
    // unless the preset target was exactly at center
    if (origZ !== Math.floor(gridDepth / 2)) {
      expect(t0.z).not.toBeCloseTo(t1.z, 0);
    }
  });

  it('castle mode should not mirror', () => {
    const game = createGame();
    const keep = getPreset('KEEP', 'castle');
    startBattle(game, 'CASTLE', keep, keep);

    // Both castles should have same relative target Z (no mirror)
    expect(game.castles[0].mirrorZ).toBeFalsy();
    expect(game.castles[1].mirrorZ).toBeFalsy();
  });
});

describe('Integration: Speed Cap (Pirate)', () => {
  it('should clamp block velocities but not projectile', () => {
    const game = createGame();
    const galleon = getPiratePreset('GALLEON');
    startBattle(game, 'PIRATE', galleon, galleon);

    // Find a dynamic block and give it high velocity
    const block = game.castles[0].blocks.find(b => b.body.mass > 0);
    block.body.velocity.set(50, 0, 0);
    block.body.wakeUp();

    // Create projectile with high velocity
    fireAt(game, 0.1, 40);
    const projSpeed = game.battle.projectile.body.velocity.length();

    // Step physics (includes speed clamping)
    game.physicsWorld.step(1 / 60);

    // Block should be clamped
    const blockSpeed = block.body.velocity.length();
    expect(blockSpeed).toBeLessThanOrEqual(GAME_MODES.PIRATE.maxBlockSpeed + 0.1);

    // Projectile should NOT be clamped
    const newProjSpeed = game.battle.projectile.body.velocity.length();
    expect(newProjSpeed).toBeGreaterThan(GAME_MODES.PIRATE.maxBlockSpeed);
  });
});
