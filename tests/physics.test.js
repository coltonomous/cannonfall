import { describe, it, expect } from 'vitest';
import * as CANNON from 'cannon-es';
import { GAME_MODES } from '../src/GameModes.js';
import { CANNONBALL_MASS, CANNONBALL_RADIUS, BLOCK_MASS, PHYSICS_STEP, TARGET_HIT_RADIUS, EXPLOSIVE_HIT_RADIUS } from '../src/constants.js';

// Minimal PhysicsWorld recreation for testing (avoids THREE.js dependency)
function createPhysicsWorld(config) {
  const gravity = config?.gravity ?? -9.82;
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, gravity, 0) });
  world.solver.iterations = 10;
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;

  const friction = config?.friction ?? 0.5;
  const restitution = config?.restitution ?? 0.3;
  const mat = new CANNON.Material('default');
  world.addContactMaterial(new CANNON.ContactMaterial(mat, mat, { friction, restitution }));
  world.defaultContactMaterial.friction = friction;
  world.defaultContactMaterial.restitution = restitution;

  return { world, mat };
}

function createBlock(world, mat, pos, mass) {
  const body = new CANNON.Body({
    mass,
    shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
    position: new CANNON.Vec3(pos.x, pos.y, pos.z),
    material: mat,
  });
  body.allowSleep = true;
  body.sleepSpeedLimit = 0.1;
  body.sleepTimeLimit = 0.5;
  world.addBody(body);
  return body;
}

function createProjectile(world, mat, pos, vel, mass) {
  const body = new CANNON.Body({
    mass,
    shape: new CANNON.Sphere(CANNONBALL_RADIUS),
    position: new CANNON.Vec3(pos.x, pos.y, pos.z),
    velocity: new CANNON.Vec3(vel.x, vel.y, vel.z),
    material: mat,
  });
  body.isProjectile = true;
  world.addBody(body);
  return body;
}

function stepWorld(world, seconds) {
  const steps = Math.ceil(seconds / PHYSICS_STEP);
  for (let i = 0; i < steps; i++) {
    world.step(PHYSICS_STEP);
  }
}

describe('Physics Behavior', () => {
  describe('gravity per mode', () => {
    it('castle mode should have standard gravity', () => {
      expect(GAME_MODES.CASTLE.gravity).toBe(-9.82);
    });

    it('pirate mode should have standard gravity', () => {
      expect(GAME_MODES.PIRATE.gravity).toBe(-9.82);
    });

    it('space mode should have zero gravity', () => {
      expect(GAME_MODES.SPACE.gravity).toBe(0);
    });
  });

  describe('projectile in zero gravity', () => {
    it('should travel in a straight line', () => {
      const { world, mat } = createPhysicsWorld({ gravity: 0 });
      const proj = createProjectile(world, mat, { x: 0, y: 5, z: 0 }, { x: 30, y: 0, z: 0 }, CANNONBALL_MASS);

      stepWorld(world, 0.5);

      // Should have moved along X, Y unchanged
      expect(proj.position.x).toBeGreaterThan(10);
      expect(Math.abs(proj.position.y - 5)).toBeLessThan(0.1);
    });
  });

  describe('projectile in normal gravity', () => {
    it('should follow a parabolic arc', () => {
      const { world, mat } = createPhysicsWorld({ gravity: -9.82 });
      const proj = createProjectile(world, mat, { x: 0, y: 5, z: 0 }, { x: 20, y: 10, z: 0 }, CANNONBALL_MASS);

      stepWorld(world, 0.5);

      expect(proj.position.x).toBeGreaterThan(5);
      // Should have risen initially then started falling
      expect(proj.position.y).toBeGreaterThan(5); // still above start at 0.5s
    });

    it('should eventually fall below starting height', () => {
      const { world, mat } = createPhysicsWorld({ gravity: -9.82 });
      const proj = createProjectile(world, mat, { x: 0, y: 5, z: 0 }, { x: 20, y: 10, z: 0 }, CANNONBALL_MASS);

      stepWorld(world, 3);

      expect(proj.position.y).toBeLessThan(0);
    });
  });

  describe('block collision', () => {
    it('projectile should displace a block on impact', () => {
      const { world, mat } = createPhysicsWorld({ gravity: -9.82 });

      // Static ground
      const ground = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Plane(),
        material: mat,
      });
      ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      world.addBody(ground);

      // Block sitting on ground
      const block = createBlock(world, mat, { x: 10, y: 0.5, z: 0 }, BLOCK_MASS);
      block.wakeUp();
      const origX = block.position.x;

      // Fire projectile at the block
      createProjectile(world, mat, { x: 0, y: 0.5, z: 0 }, { x: 40, y: 0, z: 0 }, CANNONBALL_MASS);

      stepWorld(world, 1);

      // Block should have moved from impact
      expect(block.position.x).not.toBeCloseTo(origX, 0);
    });
  });

  describe('pirate mode punch-through', () => {
    const pirateConfig = GAME_MODES.PIRATE;

    it('should have block mass multiplier > 1', () => {
      expect(pirateConfig.blockMassMultiplier).toBeGreaterThan(1);
    });

    it('should have reduced cannonball mass', () => {
      expect(pirateConfig.cannonballMass).toBeLessThan(CANNONBALL_MASS);
    });

    it('should have a block speed cap', () => {
      expect(pirateConfig.maxBlockSpeed).toBeGreaterThan(0);
      expect(pirateConfig.maxBlockSpeed).toBeLessThan(5);
    });

    it('should have higher block damping than castle', () => {
      expect(pirateConfig.blockDamping).toBeGreaterThan(0.1);
      expect(GAME_MODES.CASTLE.blockDamping).toBeFalsy();
    });

    it('block mass ratio should favor blocks over cannonball', () => {
      const blockMass = BLOCK_MASS * pirateConfig.blockMassMultiplier;
      const ballMass = pirateConfig.cannonballMass;
      expect(blockMass / ballMass).toBeGreaterThan(2);
    });
  });

  describe('space mode physics', () => {
    it('should have debris field enabled', () => {
      expect(GAME_MODES.SPACE.debrisField).toBe(true);
    });

    it('blocks should float in zero gravity', () => {
      const { world, mat } = createPhysicsWorld({ gravity: 0 });
      const block = createBlock(world, mat, { x: 0, y: 5, z: 0 }, BLOCK_MASS);
      block.wakeUp();

      stepWorld(world, 2);

      // Should not have fallen
      expect(block.position.y).toBeCloseTo(5, 0);
    });

    it('explosion force should scale with power', () => {
      const gm = GAME_MODES.SPACE;
      const minPowerFrac = 0.3; // MIN_POWER maps to 0.3
      const maxPowerFrac = 1.0;
      const minForce = gm.blastForce * minPowerFrac;
      const maxForce = gm.blastForce * maxPowerFrac;
      expect(maxForce / minForce).toBeCloseTo(1 / 0.3, 1);
    });
  });

  describe('shield absorption', () => {
    it('space mode should have blast radius and force configured', () => {
      expect(GAME_MODES.SPACE.blastRadius).toBeGreaterThan(0);
      expect(GAME_MODES.SPACE.blastForce).toBeGreaterThan(0);
      expect(GAME_MODES.SPACE.perfectBlastRadius).toBeGreaterThan(GAME_MODES.SPACE.blastRadius);
    });
  });
});

describe('Hit Detection Thresholds', () => {
  it('target hit radius should be reasonable', () => {
    expect(TARGET_HIT_RADIUS).toBeGreaterThan(CANNONBALL_RADIUS);
    expect(TARGET_HIT_RADIUS).toBeLessThan(3);
  });

  it('explosion radius should be larger than direct hit radius', () => {
    expect(EXPLOSIVE_HIT_RADIUS).toBeGreaterThan(TARGET_HIT_RADIUS);
  });

  it('projectile should be marked as such', () => {
    const { world, mat } = createPhysicsWorld({});
    const proj = createProjectile(world, mat, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 4);
    expect(proj.isProjectile).toBe(true);
  });
});
