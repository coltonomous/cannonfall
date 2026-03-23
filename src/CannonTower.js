import * as THREE from 'three';
import { CANNON_BARREL_LENGTH, MIN_PITCH, MAX_PITCH, MAX_YAW_OFFSET } from './constants.js';

export class CannonTower {
  constructor(scene, position, facingDirection, colors) {
    // position: THREE.Vector3 — world position to place the cannon
    // facingDirection: 1 means facing +X (player 1), -1 means facing -X (player 2)
    // colors: optional { baseColor, barrelColor }
    this.scene = scene;
    this.centerX = position.x;
    this.facingDirection = facingDirection;
    this.yaw = 0;
    this.pitch = Math.PI / 6; // 30 degrees default

    // Root group positioned on the castle
    this.group = new THREE.Group();
    this.group.position.copy(position);

    // Base platform (dark metallic disc)
    const baseGeo = new THREE.CylinderGeometry(1, 1.2, 0.5, 16);
    const baseMat = new THREE.MeshStandardMaterial({ color: colors?.baseColor ?? 0x444444, metalness: 0.7, roughness: 0.3 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.castShadow = true;
    this.group.add(base);

    // Yaw pivot (rotates around Y axis)
    this.yawPivot = new THREE.Group();
    this.group.add(this.yawPivot);

    // Pitch pivot (rotates around local X axis)
    this.pitchPivot = new THREE.Group();
    this.pitchPivot.position.y = 0.3;
    this.yawPivot.add(this.pitchPivot);

    // Barrel (cylinder oriented along Z axis)
    const barrelGeo = new THREE.CylinderGeometry(0.25, 0.35, CANNON_BARREL_LENGTH, 12);
    const barrelMat = new THREE.MeshStandardMaterial({ color: colors?.barrelColor ?? 0x333333, metalness: 0.8, roughness: 0.2 });
    this.barrel = new THREE.Mesh(barrelGeo, barrelMat);
    this.barrel.castShadow = true;
    // Rotate cylinder (default Y-up) to point along Z
    this.barrel.rotation.x = Math.PI / 2;
    this.barrel.position.z = CANNON_BARREL_LENGTH / 2;
    this.pitchPivot.add(this.barrel);

    // Tip marker (invisible, used to get world position of barrel end)
    this.tip = new THREE.Object3D();
    this.tip.position.z = CANNON_BARREL_LENGTH;
    this.pitchPivot.add(this.tip);

    // Set initial facing direction
    // Barrel extends along local +Z; rotate so it points along +X (P1) or -X (P2)
    this.yawPivot.rotation.y = facingDirection === 1 ? Math.PI / 2 : -Math.PI / 2;

    scene.add(this.group);
    this.updateAim();
  }

  adjustYaw(delta) {
    this.yaw = Math.max(-MAX_YAW_OFFSET, Math.min(MAX_YAW_OFFSET, this.yaw + delta));
    this.updateAim();
  }

  adjustPitch(delta) {
    this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch + delta));
    this.updateAim();
  }

  updateAim() {
    const baseYaw = this.facingDirection === 1 ? Math.PI / 2 : -Math.PI / 2;
    this.yawPivot.rotation.y = baseYaw + this.yaw;
    this.pitchPivot.rotation.x = -this.pitch;
  }

  getFirePosition() {
    const pos = new THREE.Vector3();
    this.tip.getWorldPosition(pos);
    return pos;
  }

  getFireDirection() {
    const tipPos = new THREE.Vector3();
    const pivotPos = new THREE.Vector3();
    this.tip.getWorldPosition(tipPos);
    this.pitchPivot.getWorldPosition(pivotPos);
    return tipPos.clone().sub(pivotPos).normalize();
  }

  resetAim() {
    this.yaw = 0;
    this.pitch = Math.PI / 6;
    this.updateAim();
  }

  destroy() {
    this.scene.remove(this.group);
  }
}
