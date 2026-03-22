import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CANNONBALL_RADIUS, CANNONBALL_MASS } from './constants.js';

export class Projectile {
  constructor(sceneManager, physicsWorld, position, velocity) {
    this.sceneManager = sceneManager;
    this.physicsWorld = physicsWorld;
    this.alive = true;

    // Visual: dark metallic sphere
    const geo = new THREE.SphereGeometry(CANNONBALL_RADIUS, 12, 12);
    const mat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9, roughness: 0.1 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.position.copy(position);
    sceneManager.scene.add(this.mesh);

    // Physics body
    this.body = new CANNON.Body({
      mass: CANNONBALL_MASS,
      shape: new CANNON.Sphere(CANNONBALL_RADIUS),
      position: new CANNON.Vec3(position.x, position.y, position.z),
      velocity: new CANNON.Vec3(velocity.x, velocity.y, velocity.z),
      material: physicsWorld.defaultMaterial,
    });
    this.body.linearDamping = 0.01;
    physicsWorld.world.addBody(this.body);
    physicsWorld.addPair(this.mesh, this.body);
  }

  getPosition() {
    return this.mesh.position.clone();
  }

  getSpeed() {
    const v = this.body.velocity;
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  }

  isOutOfBounds() {
    const p = this.body.position;
    return p.y < -5 || Math.abs(p.x) > 60 || Math.abs(p.z) > 60;
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this.sceneManager.scene.remove(this.mesh);
    this.physicsWorld.removePair(this.mesh);
  }
}
