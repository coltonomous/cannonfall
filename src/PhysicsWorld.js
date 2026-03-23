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

    // Static ground plane at y=0 (only if mode has ground)
    this.groundBody = null;
    if (config?.hasGround !== false) {
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
    this.world.step(PHYSICS_STEP, dt, 3);
  }

  sync() {
    for (const { mesh, body } of this.pairs) {
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
    }
  }

  clear() {
    // Remove all pairs and their bodies
    for (const { body } of this.pairs) {
      this.world.removeBody(body);
    }
    this.pairs = [];
  }
}
