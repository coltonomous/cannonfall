/**
 * HeadlessGame — Pure cannon-es game simulation for RL training.
 *
 * Replicates Cannonfall's core physics and game logic without any
 * THREE.js dependency.  Designed to be driven step-by-step from an
 * external agent (Python via bridge.js).
 *
 * One instance = one full game (two castles, two cannons, turn-based).
 */

import * as CANNON from 'cannon-es';
import { GAME_MODES } from '../../src/GameModes.js';
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
// Simple preset layouts for training variety
// ---------------------------------------------------------------------------

/** Generate a simple wall castle for training. */
function simpleWallLayout(gridWidth, gridDepth, layers = 3) {
  const layout = [];
  for (let y = 0; y < layers; y++) {
    for (let x = 0; x < gridWidth; x++) {
      for (let z = 0; z < gridDepth; z++) {
        // Build outer walls only (perimeter + partial fill)
        const isPerimeter = x === 0 || x === gridWidth - 1 || z === 0 || z === gridDepth - 1;
        if (isPerimeter || (y === 0 && Math.random() < 0.3)) {
          layout.push({ x, y, z, type: 'CUBE', rotation: 0 });
        }
      }
    }
  }
  return layout;
}

/** Random castle with mixed block types. */
function randomLayout(gridWidth, gridDepth, budget) {
  const layout = [];
  let spent = 0;
  const types = Object.keys(BLOCK_TYPES);

  // Ground layer — mostly filled
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

  // Upper layers — sparser
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

  return layout;
}

export const LAYOUT_GENERATORS = {
  simple_wall: (gw, gd) => simpleWallLayout(gw, gd, 3),
  random: (gw, gd, budget) => randomLayout(gw, gd, budget),
};

// ---------------------------------------------------------------------------
// HeadlessGame
// ---------------------------------------------------------------------------

export class HeadlessGame {
  constructor(options = {}) {
    const modeName = options.mode || 'CASTLE';
    this.gameMode = GAME_MODES[modeName];
    if (!this.gameMode) throw new Error(`Unknown game mode: ${modeName}`);

    this.maxTurns = options.maxTurns || 30;
    this.layoutGenerator = options.layoutGenerator || 'random';

    // Per-player state
    this.hp = [MAX_HP, MAX_HP];
    this.turn = 0;           // 0 = player 0 fires, 1 = player 1 fires
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

    this.lastShotResult = null;  // { hit, closestDist, impactPos }
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

    return this.getObservation();
  }

  /**
   * Agent takes a shot.
   * @param {{yaw: number, pitch: number, power: number}} action
   * @returns {{ observation, reward, done, info }}
   */
  step(action) {
    if (this.done) throw new Error('Game is done — call reset()');

    const { yaw, pitch, power } = this._clampAction(action);
    const cannon = this.cannons[this.turn];
    cannon.yaw = yaw;
    cannon.pitch = pitch;

    // Fire
    const result = this._simulateShot(this.turn, yaw, pitch, power);
    this.lastShotResult = result;

    // Reward shaping
    let reward = -0.1;  // small cost per shot
    if (result.hit) {
      reward = 10;
      const defender = 1 - this.turn;
      this.hp[defender]--;
      if (this.hp[defender] <= 0) {
        this.done = true;
        this.winner = this.turn;
        reward = 100;
      }
    } else {
      // Proximity bonus: closer to target = higher reward (0 to 1)
      const maxRewardDist = 20;
      if (result.closestDist < maxRewardDist) {
        reward += (1 - result.closestDist / maxRewardDist);
      }
    }

    // Advance turn
    this.turnCount++;
    if (!this.done && this.turnCount >= this.maxTurns) {
      this.done = true;
      // Winner = player with more HP, or defender advantage
      if (this.hp[0] !== this.hp[1]) {
        this.winner = this.hp[0] > this.hp[1] ? 0 : 1;
      }
    }

    if (!this.done) {
      this.turn = 1 - this.turn;
    }

    return {
      observation: this.getObservation(),
      reward,
      done: this.done,
      info: {
        hit: result.hit,
        closestDist: result.closestDist,
        turnCount: this.turnCount,
        hp: [...this.hp],
        winner: this.winner,
      },
    };
  }

  // -------------------------------------------------------------------
  // Observation
  // -------------------------------------------------------------------

  getObservation() {
    const attacker = this.turn;
    const defender = 1 - this.turn;
    const cannon = this.cannons[attacker];
    const targetPos = this.castles[defender].targetPos;
    const cannonPos = { x: cannon.x, y: cannon.y, z: cannon.z };

    // Relative target position (from cannon)
    const dx = targetPos.x - cannonPos.x;
    const dy = targetPos.y - cannonPos.y;
    const dz = targetPos.z - cannonPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Block positions of defender castle (relative to cannon)
    const blockPositions = this.castles[defender].blocks
      .filter(b => !b.body.isSleeping || true)  // include all
      .map(b => ({
        x: b.body.position.x - cannonPos.x,
        y: b.body.position.y - cannonPos.y,
        z: b.body.position.z - cannonPos.z,
      }));

    return {
      // Agent's cannon
      cannonPos,
      cannonFacing: cannon.facing,
      cannonYaw: cannon.yaw,
      cannonPitch: cannon.pitch,

      // Target relative to cannon
      targetDx: dx,
      targetDy: dy,
      targetDz: dz,
      targetDist: dist,

      // Defender castle blocks (relative positions)
      blockCount: blockPositions.length,
      blockPositions,

      // Game state
      hp: [...this.hp],
      turn: this.turn,
      turnCount: this.turnCount,

      // Last shot feedback
      lastHit: this.lastShotResult?.hit ?? null,
      lastClosestDist: this.lastShotResult?.closestDist ?? null,
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

    // Generate layouts
    const gen = LAYOUT_GENERATORS[this.layoutGenerator] || LAYOUT_GENERATORS.random;

    for (let player = 0; player < 2; player++) {
      const centerX = player === 0 ? -offsetX : offsetX;
      const layout = gen(gw, gd, budget);
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

        const rotY = (block.rotation || 0) * Math.PI / 2;
        body.quaternion.setFromEuler(0, rotY, 0);

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

      // Place target at a random interior grid position
      const tx = 1 + Math.floor(Math.random() * (gw - 2));
      const tz = 1 + Math.floor(Math.random() * (gd - 2));
      const targetWorldX = centerX + (tx - halfW) * BLOCK_SIZE;
      const targetWorldY = floorOffset + 0.5;
      const targetWorldZ = (tz - halfD) * BLOCK_SIZE;

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

    // Player 0 cannon: to the left of castle 0 (facing +X toward castle 1)
    this.cannons[0] = {
      x: -offsetX - 4,
      y: CANNON_HEIGHT,
      z: 0,
      yaw: 0,
      pitch: defaultPitch,
      facing: 1,
    };

    // Player 1 cannon: to the right of castle 1 (facing -X toward castle 0)
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
    const targetBody = this.castles[defender].targetBody;
    const targetPos = this.castles[defender].targetPos;

    // Compute fire position and direction (mirrors CannonTower logic)
    const baseAngle = cannon.facing === 1 ? Math.PI / 2 : -Math.PI / 2;
    const totalYaw = baseAngle + yaw;

    // Fire direction from yaw + pitch
    const cosPitch = Math.cos(pitch);
    const dirX = Math.sin(totalYaw) * cosPitch;
    const dirY = Math.sin(pitch);
    const dirZ = Math.cos(totalYaw) * cosPitch;

    // Fire position = cannon pos + barrel offset in fire direction
    const fireX = cannon.x + dirX * CANNON_BARREL_LENGTH;
    const fireY = cannon.y + dirY * CANNON_BARREL_LENGTH;
    const fireZ = cannon.z + dirZ * CANNON_BARREL_LENGTH;

    // Velocity
    const vx = dirX * power;
    const vy = dirY * power;
    const vz = dirZ * power;

    // Create projectile body
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

    // Track collisions
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

    // Step physics until projectile settles or goes OOB
    let closestDist = Infinity;
    let settleTimer = 0;
    const maxSteps = 600;  // 10 seconds at 60fps
    const outOfBoundsY = this.gameMode.outOfBoundsY;

    for (let i = 0; i < maxSteps; i++) {
      this.world.step(PHYSICS_STEP);

      // Track closest approach to target
      const dx = projBody.position.x - targetPos.x;
      const dy = projBody.position.y - targetPos.y;
      const dz = projBody.position.z - targetPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < closestDist) closestDist = dist;

      // Direct hit via collision
      if (hit) break;

      // Explosion hit check (space mode)
      if (explosionPos) {
        this._applyExplosion(explosionPos, defender, power);
        // Check if explosion hit target
        const edx = explosionPos.x - targetPos.x;
        const edy = explosionPos.y - targetPos.y;
        const edz = explosionPos.z - targetPos.z;
        const eDist = Math.sqrt(edx * edx + edy * edy + edz * edz);
        if (eDist < EXPLOSIVE_HIT_RADIUS) hit = true;
        break;
      }

      // Out of bounds
      if (projBody.position.y < outOfBoundsY) break;
      if (Math.abs(projBody.position.x) > 80 || Math.abs(projBody.position.z) > 80) break;

      // Settled (stopped moving)
      const speed = projBody.velocity.length();
      if (speed < SETTLE_SPEED) {
        settleTimer += PHYSICS_STEP;
        if (settleTimer > SETTLE_TIME) break;
      } else {
        settleTimer = 0;
      }
    }

    // Clean up projectile
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
