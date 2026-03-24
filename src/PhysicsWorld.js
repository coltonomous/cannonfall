import * as CANNON from 'cannon-es';
import { PHYSICS_STEP } from './constants.js';

export class PhysicsWorld {
  constructor(config) {
    const gravity = config?.gravity ?? -9.82;
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, gravity, 0),
    });
    this.world.solver.iterations = 10;
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

    // Exposed for camera rocking
    this.currentShipRoll = 0;

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

  // Sample the wave height at a world position — same formula as SceneManager water
  // The swell parameter slowly modulates amplitude over time
  _waveHeight(x, z, t, swell) {
    return Math.sin(x * 0.15 + t * 0.8) * 0.4 * swell
         + Math.cos(z * 0.12 + t * 0.6) * 0.25 * swell
         + Math.sin(x * 0.08 + z * 0.06 + t * 0.4) * 0.15;
  }

  _applyWaterForces(dt) {
    this._waterTime += dt;
    const t = this._waterTime;

    // Swell: slowly varies wave intensity — calm periods and rough periods
    // Oscillates between 0.6 and 1.4 over ~30 seconds
    const swell = 1.0 + 0.4 * Math.sin(t * 0.2);

    // Sample wave at each ship's center (not per-block) so the whole ship moves as one.
    // Use castleCenterX to compute per-ship wave response, with a time offset
    // so the two ships bob out of phase.
    if (!this._shipWaveCache) this._shipWaveCache = new Map();
    this._shipWaveCache.clear();

    for (const entry of this.kinematicFloors) {
      const { body, basePos, castleCenterX } = entry;

      if (!this._shipWaveCache.has(castleCenterX)) {
        // Sample at the ship center, with a time phase offset per ship
        const shipPhase = castleCenterX > 0 ? 0 : 3.5; // offset so ships bob differently
        const st = t + shipPhase;
        const sampleDist = 5;
        const cx = castleCenterX;
        const hCenter = this._waveHeight(cx, 0, st, swell);
        const hBow    = this._waveHeight(cx, sampleDist, st, swell);
        const hStern  = this._waveHeight(cx, -sampleDist, st, swell);
        const hPort   = this._waveHeight(cx - sampleDist, 0, st, swell);
        const hStbd   = this._waveHeight(cx + sampleDist, 0, st, swell);

        const roll  = Math.atan2(hStbd - hPort, sampleDist * 2) * 3.5;
        const pitch = Math.atan2(hBow - hStern, sampleDist * 2) * 2.5;
        const heave = hCenter * 1.0;

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
        const buoyancy = submersion * 15;
        body.applyForce(new CANNON.Vec3(0, buoyancy, 0));

        // Water drag: slow horizontal + vertical movement
        body.velocity.x *= 0.98;
        body.velocity.z *= 0.98;
        body.velocity.y *= 0.95;

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
