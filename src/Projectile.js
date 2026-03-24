import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CANNONBALL_RADIUS, CANNONBALL_MASS } from './constants.js';

export class Projectile {
  constructor(sceneManager, physicsWorld, position, velocity, perfect = false, modeConfig) {
    this.sceneManager = sceneManager;
    this.physicsWorld = physicsWorld;
    this.alive = true;

    const geo = new THREE.SphereGeometry(CANNONBALL_RADIUS, 12, 12);
    let mat;
    if (perfect) {
      mat = new THREE.MeshStandardMaterial({
        color: modeConfig?.perfectColor ?? 0xffd700,
        metalness: modeConfig?.projectileMetalness ?? 0.95,
        roughness: modeConfig?.projectileRoughness ?? 0.05,
        emissive: modeConfig?.perfectEmissive ?? 0xaa8800,
        emissiveIntensity: modeConfig?.perfectEmissiveIntensity ?? 0.3,
      });
    } else {
      mat = new THREE.MeshStandardMaterial({
        color: modeConfig?.projectileColor ?? 0x222222,
        metalness: modeConfig?.projectileMetalness ?? 0.9,
        roughness: modeConfig?.projectileRoughness ?? 0.1,
      });
      if (modeConfig?.projectileEmissive) {
        mat.emissive = new THREE.Color(modeConfig.projectileEmissive);
        mat.emissiveIntensity = modeConfig.projectileEmissiveIntensity || 0;
      }
    }
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.position.copy(position);
    sceneManager.scene.add(this.mesh);

    // Glow light for emissive projectiles
    if (perfect || modeConfig?.projectileGlow) {
      const glowColor = perfect ? (modeConfig?.perfectEmissive ?? 0xaa8800) : (modeConfig?.projectileEmissive ?? 0xffffff);
      const light = new THREE.PointLight(glowColor, 2, 6);
      this.mesh.add(light);
    }

    // Physics body
    this.body = new CANNON.Body({
      mass: modeConfig?.cannonballMass ?? CANNONBALL_MASS,
      shape: new CANNON.Sphere(CANNONBALL_RADIUS),
      position: new CANNON.Vec3(position.x, position.y, position.z),
      velocity: new CANNON.Vec3(velocity.x, velocity.y, velocity.z),
      material: physicsWorld.defaultMaterial,
    });
    this.body.linearDamping = 0.01;
    // Enable CCD to prevent tunneling through blocks at high speed
    this.body.ccdSpeedThreshold = 5;
    this.body.ccdIterations = 10;
    physicsWorld.world.addBody(this.body);
    physicsWorld.addPair(this.mesh, this.body);

    this._outOfBoundsY = modeConfig?.outOfBoundsY ?? -5;
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
    return p.y < this._outOfBoundsY || Math.abs(p.x) > 60 || Math.abs(p.z) > 60;
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this.sceneManager.scene.remove(this.mesh);
    this.physicsWorld.removePair(this.mesh);
  }
}
