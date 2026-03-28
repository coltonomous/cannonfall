/**
 * HeadlessGame — Pure cannon-es game simulation for RL training.
 *
 * Replicates Cannonfall's core physics and game logic without any
 * THREE.js dependency.  Designed to be driven step-by-step from an
 * external agent (Python via bridge.js).
 *
 * One instance = one full game (two castles, two cannons, turn-based).
 * The agent always controls player 0.  Player 1 is driven by the
 * configured opponent policy (random, heuristic, or none).
 */

import * as CANNON from 'cannon-es';
import { GAME_MODES } from '../../src/GameModes.js';
import { getPreset } from '../../src/Presets.js';
import {
  BLOCK_SIZE, BLOCK_MASS, BLOCK_TYPES, CANNONBALL_RADIUS, CANNONBALL_MASS,
  TARGET_HIT_RADIUS, EXPLOSIVE_HIT_RADIUS,
  MIN_PITCH, MAX_PITCH, MAX_YAW_OFFSET,
  MIN_POWER, MAX_POWER, PHYSICS_STEP,
  CANNON_HEIGHT, CANNON_BARREL_LENGTH,
  SETTLE_SPEED, SETTLE_TIME, MAX_HP,
} from '../../src/constants.js';

// Re-export for bridge.js convenience
export { GAME_MODES, MIN_PITCH, MAX_PITCH, MAX_YAW_OFFSET, MIN_POWER, MAX_POWER };

// ---------------------------------------------------------------------------
// Physics shape factories (mirrors Castle.js / BlockGeometry.js, CANNON-only)
// ---------------------------------------------------------------------------

function createRampShape() {
  const vertices = [
    new CANNON.Vec3(-0.5, -0.5, -0.5),
    new CANNON.Vec3( 0.5, -0.5, -0.5),
    new CANNON.Vec3(-0.5, -0.5,  0.5),
    new CANNON.Vec3( 0.5, -0.5,  0.5),
    new CANNON.Vec3(-0.5,  0.5, -0.5),
    new CANNON.Vec3(-0.5,  0.5,  0.5),
  ];
  const faces = [
    [0, 1, 3, 2],
    [0, 2, 5, 4],
    [0, 4, 1],
    [2, 3, 5],
    [1, 4, 5, 3],
  ];
  return new CANNON.ConvexPolyhedron({ vertices, faces });
}

function createQuarterDomeShape() {
  const verts = [
    new CANNON.Vec3(-0.5, -0.5, -0.5),
    new CANNON.Vec3( 0.0, -0.5, -0.5),
    new CANNON.Vec3(-0.5, -0.5,  0.0),
    new CANNON.Vec3(-0.5,  0.0, -0.5),
    new CANNON.Vec3( 0.0,  0.0, -0.5),
    new CANNON.Vec3(-0.5,  0.0,  0.0),
    new CANNON.Vec3( 0.0, -0.5,  0.0),
  ];
  const faces = [
    [3, 4, 1, 0],
    [2, 5, 3, 0],
    [1, 6, 2, 0],
    [1, 6, 4],
    [2, 5, 6],
    [3, 4, 5],
    [4, 6, 5],
  ];
  return new CANNON.ConvexPolyhedron({ vertices: verts, faces });
}

const PHYSICS_SHAPES = {
  CUBE:         () => new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
  HALF_SLAB:    () => new CANNON.Box(new CANNON.Vec3(0.5, 0.25, 0.5)),
  WALL:         () => new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.25)),
  COLUMN:       () => new CANNON.Cylinder(0.25, 0.25, BLOCK_SIZE, 8),
  BULLNOSE:     () => new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
  HALF_BULLNOSE:() => new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
  THRUSTER:     () => new CANNON.Cylinder(0.25, 0.3, 0.8, 8),
  SHIELD:       () => new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.25)),
  RAMP:         createRampShape,
  QUARTER_DOME: createQuarterDomeShape,
  PLANK:        () => new CANNON.Box(new CANNON.Vec3(1.0, 0.125, 0.25)),
  CYLINDER:     () => new CANNON.Cylinder(0.5, 0.5, BLOCK_SIZE, 12),
  LATTICE:      () => new CANNON.Box(new CANNON.Vec3(0.5, 0.05, 0.5)),
  BARREL:       () => new CANNON.Cylinder(0.25, 0.25, 0.5, 8),
};

// ---------------------------------------------------------------------------
// Layout generators
// ---------------------------------------------------------------------------

/** Generate a simple wall castle for training. */
function simpleWallLayout(gridWidth, gridDepth, layers = 3) {
  const layout = [];
  for (let y = 0; y < layers; y++) {
    for (let x = 0; x < gridWidth; x++) {
      for (let z = 0; z < gridDepth; z++) {
        const isPerimeter = x === 0 || x === gridWidth - 1 || z === 0 || z === gridDepth - 1;
        if (isPerimeter || (y === 0 && Math.random() < 0.3)) {
          layout.push({ x, y, z, type: 'CUBE', rotation: 0 });
        }
      }
    }
  }
  return { layout, target: { x: Math.floor(gridWidth / 2), y: 0, z: Math.floor(gridDepth / 2) } };
}

/** Random castle with mixed block types. */
function randomLayout(gridWidth, gridDepth, budget) {
  const layout = [];
  let spent = 0;
  const types = Object.keys(BLOCK_TYPES);

  for (let x = 0; x < gridWidth; x++) {
    for (let z = 0; z < gridDepth; z++) {
      if (Math.random() < 0.6) {
        const type = types[Math.floor(Math.random() * types.length)];
        const cost = BLOCK_TYPES[type].cost;
        if (spent + cost <= budget) {
          layout.push({ x, y: 0, z, type, rotation: Math.floor(Math.random() * 4) });
          spent += cost;
        }
      }
    }
  }

  for (let y = 1; y < 4; y++) {
    for (let x = 0; x < gridWidth; x++) {
      for (let z = 0; z < gridDepth; z++) {
        if (Math.random() < 0.2) {
          const type = types[Math.floor(Math.random() * types.length)];
          const cost = BLOCK_TYPES[type].cost;
          if (spent + cost <= budget) {
            layout.push({ x, y, z, type, rotation: Math.floor(Math.random() * 4) });
            spent += cost;
          }
        }
      }
    }
  }

  const tx = 1 + Math.floor(Math.random() * (gridWidth - 2));
  const tz = 1 + Math.floor(Math.random() * (gridDepth - 2));
  return { layout, target: { x: tx, y: 0, z: tz } };
}

/** Pick a random game preset for the current mode. */
function presetLayout(gameMode) {
  const presetNames = gameMode.presets;
  const name = presetNames[Math.floor(Math.random() * presetNames.length)];
  return getPreset(name, gameMode.id);
}

/** Mix of presets and random layouts for training variety. */
function mixedLayout(gridWidth, gridDepth, budget, gameMode) {
  if (Math.random() < 0.5) {
    return presetLayout(gameMode);
  }
  return randomLayout(gridWidth, gridDepth, budget);
}

export const LAYOUT_GENERATORS = {
  simple_wall: (gw, gd) => simpleWallLayout(gw, gd, 3),
  random: (gw, gd, budget) => randomLayout(gw, gd, budget),
  preset: (_gw, _gd, _budget, gm) => presetLayout(gm),
  mixed: (gw, gd, budget, gm) => mixedLayout(gw, gd, budget, gm),
};

// ---------------------------------------------------------------------------
// Heuristic opponent (mirrors src/AI.js trajectory solver)
// ---------------------------------------------------------------------------

function heuristicAim(cannon, targetPos, gameMode, noise = 0.1) {
  const dx = targetPos.x - cannon.x;
  const dy = targetPos.y - cannon.y;
  const dz = targetPos.z - cannon.z;
  const horizDist = Math.sqrt(dx * dx + dz * dz);

  // Yaw
  const baseAngle = cannon.facing === 1 ? Math.PI / 2 : -Math.PI / 2;
  let yaw = Math.atan2(dx, dz) - baseAngle;
  while (yaw > Math.PI) yaw -= 2 * Math.PI;
  while (yaw < -Math.PI) yaw += 2 * Math.PI;

  const g = Math.abs(gameMode.gravity);
  let pitch, power;

  if (g === 0) {
    // Zero-G: direct line
    pitch = Math.asin(Math.max(-1, Math.min(1, dy / Math.max(horizDist, 0.01))));
    power = Math.min(MAX_POWER, Math.max(MIN_POWER, Math.sqrt(dx * dx + dy * dy + dz * dz) * 1.2));
  } else {
    // Gravity: solve ballistic equation
    pitch = Math.PI / 4;
    power = (MIN_POWER + MAX_POWER) / 2;

    for (let p = MAX_POWER; p >= MIN_POWER; p -= 2) {
      const d = horizDist;
      const h = dy;
      const a = (g * d * d) / (2 * p * p);
      if (a === 0) continue;
      const disc = d * d - 4 * a * (h + a);
      if (disc < 0) continue;

      const tanLow = (d - Math.sqrt(disc)) / (2 * a);
      const pitchLow = Math.atan(tanLow);

      if (pitchLow >= MIN_PITCH && pitchLow <= MAX_PITCH) {
        pitch = pitchLow;
        power = p;
        break;
      }

      const tanHigh = (d + Math.sqrt(disc)) / (2 * a);
      const pitchHigh = Math.atan(tanHigh);
      if (pitchHigh >= MIN_PITCH && pitchHigh <= MAX_PITCH) {
        pitch = pitchHigh;
        power = p;
        break;
      }
    }
  }

  // Apply noise
  yaw   += (Math.random() - 0.5) * 2 * noise;
  pitch += (Math.random() - 0.5) * 2 * noise;
  power += (Math.random() - 0.5) * 2 * noise * 20;

  return {
    yaw:   Math.max(-MAX_YAW_OFFSET, Math.min(MAX_YAW_OFFSET, yaw)),
    pitch: Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch)),
    power: Math.max(MIN_POWER, Math.min(MAX_POWER, power)),
  };
}

function randomAim() {
  return {
    yaw:   (Math.random() - 0.5) * 2 * MAX_YAW_OFFSET,
    pitch: MIN_PITCH + Math.random() * (MAX_PITCH - MIN_PITCH),
    power: MIN_POWER + Math.random() * (MAX_POWER - MIN_POWER),
  };
}

// ---------------------------------------------------------------------------
// HeadlessGame
// ---------------------------------------------------------------------------

export class HeadlessGame {
  constructor(options = {}) {
    const modeName = options.mode || 'CASTLE';
    this.gameMode = GAME_MODES[modeName];
    if (!this.gameMode) throw new Error(`Unknown game mode: ${modeName}`);

    this.maxTurns = options.maxTurns || 30;
    this.layoutGenerator = options.layoutGenerator || 'mixed';
    this.opponentPolicy = options.opponentPolicy || 'heuristic';
    this.opponentNoise = options.opponentNoise ?? 0.1;

    // Per-player state
    this.hp = [MAX_HP, MAX_HP];
    this.turn = 0;           // always 0 when agent acts
    this.turnCount = 0;
    this.done = false;
    this.winner = null;

    // Physics world
    this.world = null;
    this.defaultMaterial = null;

    // Castle data: blocks[], targetBody, targetPos {x,y,z}
    this.castles = [null, null];

    // Cannon state per player
    this.cannons = [
      { x: 0, y: CANNON_HEIGHT, z: 0, yaw: 0, pitch: Math.PI / 6, facing: 1 },
      { x: 0, y: CANNON_HEIGHT, z: 0, yaw: 0, pitch: Math.PI / 6, facing: -1 },
    ];

    this.lastShotResult = null;       // agent's last shot
    this.lastOpponentResult = null;   // opponent's last shot
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  reset() {
    this._initPhysics();
    this._buildCastles();
    this._placeCannons();

    this.hp = [MAX_HP, MAX_HP];
    this.turn = 0;
    this.turnCount = 0;
    this.done = false;
    this.winner = null;
    this.lastShotResult = null;
    this.lastOpponentResult = null;

    return this.getObservation();
  }

  /**
   * Agent (player 0) takes a shot, then opponent (player 1) auto-fires.
   * @param {{yaw: number, pitch: number, power: number}} action
   * @returns {{ observation, reward, done, info }}
   */
  step(action) {
    if (this.done) throw new Error('Game is done — call reset()');

    // --- Agent's turn (player 0) ---
    const { yaw, pitch, power } = this._clampAction(action);
    const cannon = this.cannons[0];
    cannon.yaw = yaw;
    cannon.pitch = pitch;

    const result = this._simulateShot(0, yaw, pitch, power);
    this.lastShotResult = result;
    this.turnCount++;

    let reward = -0.1;
    if (result.hit) {
      reward = 10;
      this.hp[1]--;
      if (this.hp[1] <= 0) {
        this.done = true;
        this.winner = 0;
        reward = 100;
      }
    } else {
      const maxRewardDist = 20;
      if (result.closestDist < maxRewardDist) {
        reward += (1 - result.closestDist / maxRewardDist);
      }
    }

    // Check turn limit after agent's shot
    if (!this.done && this.turnCount >= this.maxTurns) {
      this.done = true;
      if (this.hp[0] !== this.hp[1]) {
        this.winner = this.hp[0] > this.hp[1] ? 0 : 1;
      }
    }

    // --- Opponent's turn (player 1) ---
    if (!this.done && this.opponentPolicy !== 'none') {
      const oppAction = this._getOpponentAction();
      const oppResult = this._simulateShot(1, oppAction.yaw, oppAction.pitch, oppAction.power);
      this.lastOpponentResult = oppResult;
      this.turnCount++;

      if (oppResult.hit) {
        this.hp[0]--;
        reward -= 5;  // penalty for getting hit
        if (this.hp[0] <= 0) {
          this.done = true;
          this.winner = 1;
          reward = -100;
        }
      }

      if (!this.done && this.turnCount >= this.maxTurns) {
        this.done = true;
        if (this.hp[0] !== this.hp[1]) {
          this.winner = this.hp[0] > this.hp[1] ? 0 : 1;
        }
      }
    }

    return {
      observation: this.getObservation(),
      reward,
      done: this.done,
      info: {
        hit: result.hit,
        closestDist: result.closestDist,
        opponentHit: this.lastOpponentResult?.hit ?? false,
        turnCount: this.turnCount,
        hp: [...this.hp],
        winner: this.winner,
      },
    };
  }

  // -------------------------------------------------------------------
  // Opponent policy
  // -------------------------------------------------------------------

  _getOpponentAction() {
    if (this.opponentPolicy === 'random') {
      return randomAim();
    }
    // heuristic (default)
    const targetPos = this.castles[0].targetPos;
    return heuristicAim(this.cannons[1], targetPos, this.gameMode, this.opponentNoise);
  }

  // -------------------------------------------------------------------
  // Observation (always from player 0's perspective)
  // -------------------------------------------------------------------

  getObservation() {
    const cannon = this.cannons[0];
    const targetPos = this.castles[1].targetPos;
    const cannonPos = { x: cannon.x, y: cannon.y, z: cannon.z };

    const dx = targetPos.x - cannonPos.x;
    const dy = targetPos.y - cannonPos.y;
    const dz = targetPos.z - cannonPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const blockPositions = this.castles[1].blocks
      .filter(b => !b.isFloor)
      .map(b => ({
        x: b.body.position.x - cannonPos.x,
        y: b.body.position.y - cannonPos.y,
        z: b.body.position.z - cannonPos.z,
      }));

    return {
      cannonPos,
      cannonFacing: cannon.facing,
      cannonYaw: cannon.yaw,
      cannonPitch: cannon.pitch,

      targetDx: dx,
      targetDy: dy,
      targetDz: dz,
      targetDist: dist,

      blockCount: blockPositions.length,
      blockPositions,

      hp: [...this.hp],
      turn: 0,
      turnCount: this.turnCount,

      lastHit: this.lastShotResult?.hit ?? null,
      lastClosestDist: this.lastShotResult?.closestDist ?? null,
      opponentLastHit: this.lastOpponentResult?.hit ?? null,
    };
  }

  // -------------------------------------------------------------------
  // Physics setup
  // -------------------------------------------------------------------

  _initPhysics() {
    const gravity = this.gameMode.gravity;
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, gravity, 0),
    });
    this.world.solver.iterations = 10;
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;

    const friction = this.gameMode.friction ?? 0.5;
    const restitution = this.gameMode.restitution ?? 0.3;
    this.defaultMaterial = new CANNON.Material('default');
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.defaultMaterial, this.defaultMaterial,
      { friction, restitution },
    ));
    this.world.defaultContactMaterial.friction = friction;
    this.world.defaultContactMaterial.restitution = restitution;

    // Ground plane (castle mode)
    if (this.gameMode.hasGround && !this.gameMode.waterSurface) {
      const ground = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Plane(),
        material: this.defaultMaterial,
      });
      ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      this.world.addBody(ground);
    }
  }

  _buildCastles() {
    const gw = this.gameMode.gridWidth;
    const gd = this.gameMode.gridDepth;
    const offsetX = this.gameMode.castleOffsetX;
    const budget = this.gameMode.budget;
    const massMultiplier = this.gameMode.blockMassMultiplier || 1;
    const damping = this.gameMode.blockDamping || 0.01;
    const hasGround = this.gameMode.hasGround && !this.gameMode.waterSurface;

    const gen = LAYOUT_GENERATORS[this.layoutGenerator] || LAYOUT_GENERATORS.mixed;

    for (let player = 0; player < 2; player++) {
      const centerX = player === 0 ? -offsetX : offsetX;
      const { layout, target } = gen(gw, gd, budget, this.gameMode);
      const halfW = Math.floor(gw / 2);
      const halfD = Math.floor(gd / 2);
      const floorOffset = hasGround ? BLOCK_SIZE / 2 : 0;

      const blocks = [];

      // Build a default floor for castle mode
      if (hasGround) {
        for (let gx = 0; gx < gw; gx++) {
          for (let gz = 0; gz < gd; gz++) {
            const body = new CANNON.Body({
              mass: 0,
              shape: PHYSICS_SHAPES.CUBE(),
              position: new CANNON.Vec3(
                centerX + (gx - halfW) * BLOCK_SIZE,
                0,
                (gz - halfD) * BLOCK_SIZE,
              ),
              material: this.defaultMaterial,
            });
            this.world.addBody(body);
            blocks.push({ body, type: 'FLOOR', isFloor: true });
          }
        }
      }

      // Build player-placed blocks
      for (const block of layout) {
        const typeInfo = BLOCK_TYPES[block.type];
        if (!typeInfo) continue;

        const shapeFactory = PHYSICS_SHAPES[block.type] || PHYSICS_SHAPES.CUBE;
        const yOffset = typeInfo.size[1] < BLOCK_SIZE ? typeInfo.size[1] / 2 : BLOCK_SIZE / 2;
        const worldX = centerX + (block.x - halfW) * BLOCK_SIZE;
        const worldY = block.y * BLOCK_SIZE + yOffset + floorOffset;
        const worldZ = (block.z - halfD) * BLOCK_SIZE;

        const blockMass = (typeInfo.mass ?? BLOCK_MASS) * massMultiplier;
        const body = new CANNON.Body({
          mass: blockMass,
          shape: shapeFactory(),
          position: new CANNON.Vec3(worldX, worldY, worldZ),
          material: this.defaultMaterial,
        });

        const rotX = (block.rotX || 0) * Math.PI / 2;
        const rotY = (block.rotation || 0) * Math.PI / 2;
        body.quaternion.setFromEuler(rotX, rotY, 0);

        if (block.type === 'SHIELD') body.isShield = true;
        body.linearDamping = damping;
        body.angularDamping = damping;
        body.allowSleep = true;
        body.sleepSpeedLimit = 0.1;
        body.sleepTimeLimit = 0.5;
        body.sleep();

        this.world.addBody(body);
        blocks.push({ body, type: block.type });
      }

      // Place target
      const tp = target || { x: Math.floor(gw / 2), y: 0, z: Math.floor(gd / 2) };
      const targetWorldX = centerX + (tp.x - halfW) * BLOCK_SIZE;
      const targetWorldY = (tp.y || 0) * BLOCK_SIZE + floorOffset + 0.5;
      const targetWorldZ = (tp.z - halfD) * BLOCK_SIZE;

      const targetBody = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Sphere(TARGET_HIT_RADIUS),
        position: new CANNON.Vec3(targetWorldX, targetWorldY, targetWorldZ),
        collisionResponse: false,
      });
      targetBody.isTarget = true;
      this.world.addBody(targetBody);

      this.castles[player] = {
        blocks,
        targetBody,
        targetPos: { x: targetWorldX, y: targetWorldY, z: targetWorldZ },
        centerX,
        gridWidth: gw,
        gridDepth: gd,
      };
    }
  }

  _placeCannons() {
    const offsetX = this.gameMode.castleOffsetX;
    const defaultPitch = this.gameMode.defaultPitch ?? Math.PI / 6;

    this.cannons[0] = {
      x: -offsetX - 4,
      y: CANNON_HEIGHT,
      z: 0,
      yaw: 0,
      pitch: defaultPitch,
      facing: 1,
    };

    this.cannons[1] = {
      x: offsetX + 4,
      y: CANNON_HEIGHT,
      z: 0,
      yaw: 0,
      pitch: defaultPitch,
      facing: -1,
    };
  }

  // -------------------------------------------------------------------
  // Shot simulation
  // -------------------------------------------------------------------

  _clampAction(action) {
    return {
      yaw:   Math.max(-MAX_YAW_OFFSET, Math.min(MAX_YAW_OFFSET, action.yaw)),
      pitch: Math.max(MIN_PITCH, Math.min(MAX_PITCH, action.pitch)),
      power: Math.max(MIN_POWER, Math.min(MAX_POWER, action.power)),
    };
  }

  _simulateShot(attacker, yaw, pitch, power) {
    const cannon = this.cannons[attacker];
    const defender = 1 - attacker;
    const targetPos = this.castles[defender].targetPos;

    // Compute fire position and direction (mirrors CannonTower logic)
    const baseAngle = cannon.facing === 1 ? Math.PI / 2 : -Math.PI / 2;
    const totalYaw = baseAngle + yaw;

    const cosPitch = Math.cos(pitch);
    const dirX = Math.sin(totalYaw) * cosPitch;
    const dirY = Math.sin(pitch);
    const dirZ = Math.cos(totalYaw) * cosPitch;

    const fireX = cannon.x + dirX * CANNON_BARREL_LENGTH;
    const fireY = cannon.y + dirY * CANNON_BARREL_LENGTH;
    const fireZ = cannon.z + dirZ * CANNON_BARREL_LENGTH;

    const vx = dirX * power;
    const vy = dirY * power;
    const vz = dirZ * power;

    const projBody = new CANNON.Body({
      mass: CANNONBALL_MASS,
      shape: new CANNON.Sphere(CANNONBALL_RADIUS),
      position: new CANNON.Vec3(fireX, fireY, fireZ),
      velocity: new CANNON.Vec3(vx, vy, vz),
      material: this.defaultMaterial,
    });
    projBody.linearDamping = 0.01;
    projBody.isProjectile = true;
    projBody.ccdSpeedThreshold = 5;
    projBody.ccdIterations = 10;
    this.world.addBody(projBody);

    let hit = false;
    let hitBlock = false;
    let explosionPos = null;

    projBody.addEventListener('collide', (e) => {
      if (e.body.isTarget) {
        hit = true;
      } else if (this.gameMode.explosiveProjectile && !hitBlock) {
        hitBlock = true;
        explosionPos = {
          x: projBody.position.x,
          y: projBody.position.y,
          z: projBody.position.z,
        };
      }
    });

    let closestDist = Infinity;
    let settleTimer = 0;
    const maxSteps = 600;
    const outOfBoundsY = this.gameMode.outOfBoundsY;

    for (let i = 0; i < maxSteps; i++) {
      this.world.step(PHYSICS_STEP);

      const dx = projBody.position.x - targetPos.x;
      const dy = projBody.position.y - targetPos.y;
      const dz = projBody.position.z - targetPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < closestDist) closestDist = dist;

      if (hit) break;

      if (explosionPos) {
        this._applyExplosion(explosionPos, defender, power);
        const edx = explosionPos.x - targetPos.x;
        const edy = explosionPos.y - targetPos.y;
        const edz = explosionPos.z - targetPos.z;
        const eDist = Math.sqrt(edx * edx + edy * edy + edz * edz);
        if (eDist < EXPLOSIVE_HIT_RADIUS) hit = true;
        break;
      }

      if (projBody.position.y < outOfBoundsY) break;
      if (Math.abs(projBody.position.x) > 80 || Math.abs(projBody.position.z) > 80) break;

      const speed = projBody.velocity.length();
      if (speed < SETTLE_SPEED) {
        settleTimer += PHYSICS_STEP;
        if (settleTimer > SETTLE_TIME) break;
      } else {
        settleTimer = 0;
      }
    }

    this.world.removeBody(projBody);

    return {
      hit,
      closestDist,
      impactPos: {
        x: projBody.position.x,
        y: projBody.position.y,
        z: projBody.position.z,
      },
    };
  }

  _applyExplosion(pos, defender, power) {
    const powerFrac = (power - MIN_POWER) / (MAX_POWER - MIN_POWER);
    const radius = this.gameMode.blastRadius * powerFrac;
    const force = this.gameMode.blastForce * powerFrac;

    for (const { body } of this.castles[defender].blocks) {
      if (body.mass === 0) continue;

      const dx = body.position.x - pos.x;
      const dy = body.position.y - pos.y;
      const dz = body.position.z - pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < radius && dist > 0) {
        const scale = force * (1 - dist / radius);
        const dampener = body.isShield ? 0.2 : 1;
        const impulse = new CANNON.Vec3(
          (dx / dist) * scale * dampener,
          (dy / dist) * scale * dampener,
          (dz / dist) * scale * dampener,
        );
        body.wakeUp();
        body.applyImpulse(impulse);
      }
    }
  }
}
