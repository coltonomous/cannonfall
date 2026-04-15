import * as CANNON from 'cannon-es';
import {
  PHYSICS_STEP, SOLVER_ITERATIONS, BUOYANCY_FACTOR,
  WATER_DRAG_XZ, WATER_DRAG_Y, SHIP_PHASE_OFFSET,
  SHIP_ROLL_SCALE, SHIP_PITCH_SCALE, SHIP_SAMPLE_DIST,
} from './constants.js';
import { waveHeight, swellAtTime } from './waveUtils.js';

export class PhysicsWorld {
  constructor(config) {
    const gravity = config?.gravity ?? -9.82;
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, gravity, 0),
    });
    this.world.solver.iterations = SOLVER_ITERATIONS;
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;

    const friction = config?.friction ?? 0.5;
    const restitution = config?.restitution ?? 0.3;
    this.defaultMaterial = new CANNON.Material('default');
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.defaultMaterial,
      this.defaultMaterial,
      { friction, restitution }
    ));
    this.world.defaultContactMaterial.friction = friction;
    this.world.defaultContactMaterial.restitution = restitution;

    // Water mode: no solid ground, buoyancy + wave forces instead
    this.waterSurface = !!config?.waterSurface;
    this.waterLevel = 0;
    this._waterTime = 0;

    // Static ground plane at y=0 (only for non-water ground modes)
    this.groundBody = null;
    this.hasGround = config?.hasGround !== false && !this.waterSurface;
    if (this.hasGround) {
      this.groundBody = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Plane(),
        material: this.defaultMaterial,
      });
      this.groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      this.world.addBody(this.groundBody);
    }

    // Per-mode block speed cap (0 = no cap)
    this._maxBlockSpeed = config?.maxBlockSpeed || 0;

    // Mesh-body pairs for syncing
    this.pairs = [];

    // Kinematic floor bodies (for ship rocking in water mode)
    this.kinematicFloors = []; // [{ body, basePos, castleCenterX }]
  }

  addPair(mesh, body) {
    this.pairs.push({ mesh, body });
  }

  removePair(mesh) {
    const idx = this.pairs.findIndex(p => p.mesh === mesh);
    if (idx >= 0) {
      this.world.removeBody(this.pairs[idx].body);
      this.pairs.splice(idx, 1);
    }
  }

  step(dt) {
    if (this.waterSurface) this._applyWaterForces(dt);
    this.world.step(PHYSICS_STEP, dt, 3);

    // Post-step velocity clamping for high-damping modes
    if (this._maxBlockSpeed > 0) {
      for (const { body } of this.pairs) {
        if (body.mass === 0 || body.sleepState === 2 || body.isProjectile) continue;
        const speed = body.velocity.length();
        if (speed > this._maxBlockSpeed) {
          const scale = this._maxBlockSpeed / speed;
          body.velocity.scale(scale, body.velocity);
          body.angularVelocity.scale(scale, body.angularVelocity);
        }
      }
    }
  }

  registerFloorBody(body, castleCenterX) {
    body.type = CANNON.Body.KINEMATIC;
    this.kinematicFloors.push({
      body,
      basePos: body.position.clone(),
      castleCenterX,
    });
  }

  _waveHeight(x, z, t, swell) {
    return waveHeight(x, z, t, swell);
  }

  _applyWaterForces(dt) {
    this._waterTime += dt;
    const t = this._waterTime;

    const swell = swellAtTime(t);

    // Sample wave at each ship's center (not per-block) so the whole ship moves as one.
    // Use castleCenterX to compute per-ship wave response, with a time offset
    // so the two ships bob out of phase.
    if (!this._shipWaveCache) this._shipWaveCache = new Map();
    this._shipWaveCache.clear();

    for (const entry of this.kinematicFloors) {
      const { body, basePos, castleCenterX } = entry;

      if (!this._shipWaveCache.has(castleCenterX)) {
        // Sample at the ship center, with a time phase offset per ship
        const shipPhase = castleCenterX > 0 ? 0 : SHIP_PHASE_OFFSET; // offset so ships bob differently
        const st = t + shipPhase;
        const sampleDist = SHIP_SAMPLE_DIST;
        const cx = castleCenterX;
        const hCenter = this._waveHeight(cx, 0, st, swell);
        const hBow    = this._waveHeight(cx, sampleDist, st, swell);
        const hStern  = this._waveHeight(cx, -sampleDist, st, swell);
        const hPort   = this._waveHeight(cx - sampleDist, 0, st, swell);
        const hStbd   = this._waveHeight(cx + sampleDist, 0, st, swell);

        const roll  = Math.atan2(hStbd - hPort, sampleDist * 2) * SHIP_ROLL_SCALE;
        const pitch = Math.atan2(hBow - hStern, sampleDist * 2) * SHIP_PITCH_SCALE;
        const heave = hCenter;

        this._shipWaveCache.set(castleCenterX, { roll, pitch, heave });
      }

      const wave = this._shipWaveCache.get(castleCenterX);
      body.position.set(basePos.x, basePos.y + wave.heave, basePos.z);
      body.quaternion.setFromEuler(wave.pitch, 0, wave.roll);
    }

    // Buoyancy + wave forces on dynamic bodies
    for (const { body } of this.pairs) {
      if (body.mass === 0) continue;

      const y = body.position.y;
      if (y < this.waterLevel) {
        // Buoyancy: stronger the deeper the body is submerged
        const submersion = Math.max(0, this.waterLevel - y);
        const buoyancy = submersion * BUOYANCY_FACTOR;
        body.applyForce(new CANNON.Vec3(0, buoyancy, 0));

        // Water drag: slow horizontal + vertical movement
        body.velocity.x *= WATER_DRAG_XZ;
        body.velocity.z *= WATER_DRAG_XZ;
        body.velocity.y *= WATER_DRAG_Y;

        // Wake the body so it doesn't freeze mid-water
        body.wakeUp();
      }
    }
  }

  sync() {
    for (const { mesh, body } of this.pairs) {
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
    }
  }

  clear() {
    for (const { body } of this.pairs) {
      this.world.removeBody(body);
    }
    this.pairs = [];
    this.kinematicFloors = [];
    this._waterTime = 0;
  }
}
