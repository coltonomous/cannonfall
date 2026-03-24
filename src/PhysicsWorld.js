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
    if (config?.hasGround !== false && !this.waterSurface) {
      this.groundBody = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Plane(),
        material: this.defaultMaterial,
      });
      this.groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      this.world.addBody(this.groundBody);
    }

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
  }

  registerFloorBody(body, castleCenterX) {
    body.type = CANNON.Body.KINEMATIC;
    this.kinematicFloors.push({
      body,
      basePos: body.position.clone(),
      castleCenterX,
    });
  }

  _applyWaterForces(dt) {
    this._waterTime += dt;
    const t = this._waterTime;

    // Rock kinematic floor bodies (ship hull rocking on waves)
    for (const entry of this.kinematicFloors) {
      const { body, basePos, castleCenterX } = entry;
      // Gentle roll (rotation around Z-axis, perpendicular to facing direction)
      const roll = Math.sin(t * 0.7 + castleCenterX * 0.1) * 0.015;
      // Gentle pitch (rotation around X-axis)
      const pitch = Math.sin(t * 0.5 + castleCenterX * 0.3) * 0.01;
      // Heave (vertical bob)
      const heave = Math.sin(t * 0.6 + castleCenterX * 0.2) * 0.08;

      body.position.set(basePos.x, basePos.y + heave, basePos.z);
      body.quaternion.setFromEuler(pitch, 0, roll);
    }

    // Buoyancy + wave forces on dynamic bodies
    for (const { body } of this.pairs) {
      if (body.mass === 0) continue;

      const y = body.position.y;
      if (y < this.waterLevel + 1) {
        // Buoyancy: stronger the deeper the body is submerged
        const submersion = Math.max(0, this.waterLevel + 1 - y);
        const buoyancy = submersion * 12;
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
