import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BLOCK_SIZE, BLOCK_MASS, BLOCK_TYPES, TARGET_HIT_RADIUS } from './constants.js';
import { createAllBlockGeometries } from './BlockGeometry.js';
import { createAllPhysicsShapes } from './PhysicsShapes.js';

export class Castle {
  constructor(sceneManager, physicsWorld, centerX, color, gridConfig) {
    this.sceneManager = sceneManager;
    this.physicsWorld = physicsWorld;
    this.centerX = centerX;
    this.color = new THREE.Color(color);
    this.gridWidth = gridConfig?.gridWidth || 9;
    this.gridDepth = gridConfig?.gridDepth || 9;
    this.blockMassMultiplier = gridConfig?.blockMassMultiplier || 1;
    this.blockDamping = gridConfig?.blockDamping || 0.01;
    this.blocks = []; // { mesh, body }
    this.thrusters = []; // { mesh, exhaustDir: THREE.Vector3 }
    this.target = null; // THREE.Mesh
    this.targetBody = null; // CANNON.Body
  }

  // Build from a layout array: [{ x, y, z, type, rotation }]
  // and a targetPosition: { x, y, z }
  // x, z are grid coords, y is layer index
  // Grid origin is the castle center
  buildFromLayout(layout, targetPosition, customFloor, mirrorZ = false) {
    this.clear();
    this.layoutData = layout;
    this.mirrorZ = mirrorZ;

    const halfW = Math.floor(this.gridWidth / 2);
    const halfD = Math.floor(this.gridDepth / 2);

    // Shared geometries for each block type (create once, reuse, dispose in clear())
    const geometries = createAllBlockGeometries();
    this._sharedGeometries = geometries;

    // Physics shapes (shared with headless training env)
    const shapes = createAllPhysicsShapes();

    const baseMat = new THREE.MeshStandardMaterial({ color: this.color });

    // Build floor layer (static) — skip for water/space modes with no custom floor
    const hasCustomFloor = customFloor && customFloor.length > 0;
    const needsDefaultFloor = this.physicsWorld.hasGround && !hasCustomFloor;
    this._floorOffset = needsDefaultFloor ? BLOCK_SIZE / 2 : 0;

    if (hasCustomFloor) {
      // Custom shaped floor — physics-only for water modes, visible for others
      const hideFloor = !needsDefaultFloor;
      for (const fb of customFloor) {
        const fbz = mirrorZ ? (this.gridDepth - 1 - fb.z) : fb.z;
        const worldX = this.centerX + (fb.x - halfW) * BLOCK_SIZE;
        const worldY = BLOCK_SIZE / 2 + (fb.yOffset || 0) * BLOCK_SIZE;
        const worldZ = (fbz - halfD) * BLOCK_SIZE;

        let fbRotY = fb.rotation || 0;
        if (mirrorZ) {
          if (fbRotY === 1) fbRotY = 3;
          else if (fbRotY === 3) fbRotY = 1;
        }

        let mesh = null;
        if (!hideFloor) {
          const geo = geometries[fb.type] || geometries.CUBE;
          const mat = baseMat.clone();
          mat.color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
          mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(worldX, worldY, worldZ);
          mesh.rotation.y = fbRotY * Math.PI / 2;
          if (fb.flip) mesh.rotation.x = Math.PI;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.sceneManager.scene.add(mesh);
        }

        const shape = shapes[fb.type] || shapes.CUBE;
        const body = new CANNON.Body({
          mass: 0,
          shape: shape,
          position: new CANNON.Vec3(worldX, worldY, worldZ),
          material: this.physicsWorld.defaultMaterial,
        });
        body.quaternion.setFromEuler(
          fb.flip ? Math.PI : 0,
          fbRotY * Math.PI / 2,
          0
        );
        this.physicsWorld.world.addBody(body);
        if (mesh) this.physicsWorld.addPair(mesh, body);
        this.blocks.push({ mesh, body });
        if (this.physicsWorld.waterSurface) {
          this.physicsWorld.registerFloorBody(body, this.centerX);
        }
      }
    } else if (needsDefaultFloor) {
      // Default flat floor (castle mode only) — sunk into ground so top is flush at y=0.5
      for (let gx = 0; gx < this.gridWidth; gx++) {
        for (let gz = 0; gz < this.gridDepth; gz++) {
          const worldX = this.centerX + (gx - halfW) * BLOCK_SIZE;
          const worldY = 0;
          const worldZ = (gz - halfD) * BLOCK_SIZE;

          const mat = baseMat.clone();
          mat.color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);

          const mesh = new THREE.Mesh(geometries.CUBE, mat);
          mesh.position.set(worldX, worldY, worldZ);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.sceneManager.scene.add(mesh);

          const body = new CANNON.Body({
            mass: 0,
            shape: shapes.CUBE,
            position: new CANNON.Vec3(worldX, worldY, worldZ),
            material: this.physicsWorld.defaultMaterial,
          });
          this.physicsWorld.world.addBody(body);
          this.physicsWorld.addPair(mesh, body);
          this.blocks.push({ mesh, body });
          if (this.physicsWorld.waterSurface) {
            this.physicsWorld.registerFloorBody(body, this.centerX);
          }
        }
      }
    }

    // Build player-placed blocks
    for (const block of layout) {
      const typeInfo = BLOCK_TYPES[block.type];
      if (!typeInfo) continue;

      const geo = geometries[block.type];
      const bz = mirrorZ ? (this.gridDepth - 1 - block.z) : block.z;
      const worldX = this.centerX + (block.x - halfW) * BLOCK_SIZE;
      const yOffset = typeInfo.size[1] < BLOCK_SIZE ? typeInfo.size[1] / 2 : BLOCK_SIZE / 2;
      const worldY = block.y * BLOCK_SIZE + yOffset + this._floorOffset;
      const worldZ = (bz - halfD) * BLOCK_SIZE;

      // Material: use block type override if defined, otherwise base castle color
      let mat;
      if (typeInfo.material) {
        mat = new THREE.MeshStandardMaterial(typeInfo.material);
      } else {
        mat = baseMat.clone();
        mat.color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
      }

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(worldX, worldY, worldZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Rotation: per-block axes + any extra Z rotation from block type definition
      // When Z-mirrored, flip Y rotation (1↔3) and negate rotX to maintain correct facing
      let blockRotY = block.rotation || 0;
      let blockRotX = block.rotX || 0;
      if (mirrorZ) {
        if (blockRotY === 1) blockRotY = 3;
        else if (blockRotY === 3) blockRotY = 1;
        blockRotX = blockRotX ? (4 - blockRotX) % 4 : 0;
      }
      const rotX = blockRotX * Math.PI / 2;
      const rotY = blockRotY * Math.PI / 2;
      const rotZ = (block.rotZ || 0) * Math.PI / 2 + (typeInfo.rotZ || 0);
      mesh.rotation.set(rotX, rotY, rotZ);

      this.sceneManager.scene.add(mesh);

      // Physics body
      const shape = shapes[block.type] || shapes.CUBE;
      const blockMass = (typeInfo.mass ?? BLOCK_MASS) * this.blockMassMultiplier;
      const body = new CANNON.Body({
        mass: blockMass,
        shape: shape,
        position: new CANNON.Vec3(worldX, worldY, worldZ),
        material: this.physicsWorld.defaultMaterial,
      });

      body.quaternion.setFromEuler(rotX, rotY, rotZ);
      if (block.type === 'SHIELD') body.isShield = true;

      body.linearDamping = this.blockDamping;
      body.angularDamping = this.blockDamping;

      body.allowSleep = true;
      if (this.blockDamping > 0.1) {
        body.sleepSpeedLimit = 1.2;
        body.sleepTimeLimit = 0.05;
      } else {
        body.sleepSpeedLimit = 0.1;
        body.sleepTimeLimit = 0.5;
      }
      body.sleep();

      this.physicsWorld.world.addBody(body);
      this.physicsWorld.addPair(mesh, body);
      this.blocks.push({ mesh, body });

      // Track thrusters for exhaust particles
      if (block.type === 'THRUSTER') {
        // Exhaust direction: +Y in local space (narrow end), rotated by block rotation
        const exhaustDir = new THREE.Vector3(0, 1, 0);
        exhaustDir.applyEuler(new THREE.Euler(rotX, rotY, rotZ));
        this.thrusters.push({ mesh, body, exhaustDir });
      }
    }

    // Create target
    const tp = mirrorZ
      ? { ...targetPosition, z: this.gridDepth - 1 - targetPosition.z }
      : targetPosition;
    this.createTarget(tp, halfW, halfD);
  }

  createTarget(gridPos, halfW, halfD) {
    // Glowing red sphere
    const geo = new THREE.SphereGeometry(0.5, 16, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff4444,
      emissive: 0xff0000,
      emissiveIntensity: 0.5,
    });
    this.target = new THREE.Mesh(geo, mat);

    const worldX = this.centerX + (gridPos.x - halfW) * BLOCK_SIZE;
    const worldY = gridPos.y * BLOCK_SIZE + this._floorOffset + 0.5;
    const worldZ = (gridPos.z - halfD) * BLOCK_SIZE;

    this.target.position.set(worldX, worldY, worldZ);
    // Layer 1: visible to main camera but hidden from minimap
    this.target.layers.set(1);
    this.sceneManager.scene.add(this.target);

    // Add a point light to make target glow and be visible through gaps
    this.targetLight = new THREE.PointLight(0xff4444, 1, 8);
    this.targetLight.position.copy(this.target.position);
    this.targetLight.layers.set(1);
    this.sceneManager.scene.add(this.targetLight);

    // Physics body (sensor — detects collision but doesn't block)
    // Sphere radius matches TARGET_HIT_RADIUS for consistent hit detection
    this.targetBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Sphere(TARGET_HIT_RADIUS),
      position: new CANNON.Vec3(worldX, worldY, worldZ),
      collisionResponse: false,
    });
    this.targetBody.isTarget = true;
    this.physicsWorld.world.addBody(this.targetBody);
  }

  getCannonWorldPosition(gridX, gridZ) {
    const halfW = Math.floor(this.gridWidth / 2);
    const halfD = Math.floor(this.gridDepth / 2);
    const worldX = this.centerX + (gridX - halfW) * BLOCK_SIZE;
    const worldZ = (gridZ - halfD) * BLOCK_SIZE;

    // Find highest block at this grid position
    let maxLayerTop = 0;
    for (const block of (this.layoutData || [])) {
      if (block.x === gridX && block.z === gridZ) {
        const typeInfo = BLOCK_TYPES[block.type];
        const blockHeight = typeInfo ? typeInfo.size[1] : 1;
        const top = block.y + blockHeight;
        if (top > maxLayerTop) maxLayerTop = top;
      }
    }

    const worldY = this._floorOffset + maxLayerTop * BLOCK_SIZE + 0.25;
    return new THREE.Vector3(worldX, worldY, worldZ);
  }

  removeTarget() {
    if (this.target) {
      this.sceneManager.scene.remove(this.target);
      this.target.geometry.dispose();
      this.target.material.dispose();
      this.target = null;
    }
    if (this.targetLight) {
      this.sceneManager.scene.remove(this.targetLight);
      this.targetLight = null;
    }
    if (this.targetBody) {
      this.physicsWorld.world.removeBody(this.targetBody);
      this.targetBody = null;
    }
  }

  repositionTarget(gridPos) {
    this.removeTarget();
    const halfW = Math.floor(this.gridWidth / 2);
    const halfD = Math.floor(this.gridDepth / 2);
    this.createTarget(gridPos, halfW, halfD);
  }

  getTargetPosition() {
    return this.target ? this.target.position.clone() : null;
  }

  clear() {
    for (const { mesh, body } of this.blocks) {
      if (mesh) {
        this.sceneManager.scene.remove(mesh);
        if (mesh.material) mesh.material.dispose();
      }
      this.physicsWorld.world.removeBody(body);
    }
    // Also remove from pairs
    for (const { mesh } of this.blocks) {
      const idx = this.physicsWorld.pairs.findIndex(p => p.mesh === mesh);
      if (idx >= 0) this.physicsWorld.pairs.splice(idx, 1);
    }
    this.blocks = [];
    this.thrusters = [];

    // Dispose shared block geometries (one per block type, reused across meshes)
    if (this._sharedGeometries) {
      for (const geo of Object.values(this._sharedGeometries)) {
        geo.dispose();
      }
      this._sharedGeometries = null;
    }

    if (this.target) {
      this.sceneManager.scene.remove(this.target);
      this.target.geometry.dispose();
      this.target.material.dispose();
      this.target = null;
    }
    if (this.targetLight) {
      this.sceneManager.scene.remove(this.targetLight);
      this.targetLight = null;
    }
    if (this.targetBody) {
      this.physicsWorld.world.removeBody(this.targetBody);
      this.targetBody = null;
    }
  }
}
