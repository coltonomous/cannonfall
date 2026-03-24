import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BLOCK_SIZE, BLOCK_MASS, BLOCK_TYPES } from './constants.js';
import { createAllBlockGeometries, createRampPhysicsShape, createQuarterDomePhysicsShape } from './BlockGeometry.js';

export class Castle {
  constructor(sceneManager, physicsWorld, centerX, color, gridConfig) {
    this.sceneManager = sceneManager;
    this.physicsWorld = physicsWorld;
    this.centerX = centerX;
    this.color = new THREE.Color(color);
    this.gridWidth = gridConfig?.gridWidth || 9;
    this.gridDepth = gridConfig?.gridDepth || 9;
    this.blocks = []; // { mesh, body }
    this.target = null; // THREE.Mesh
    this.targetBody = null; // CANNON.Body
  }

  // Build from a layout array: [{ x, y, z, type, rotation }]
  // and a targetPosition: { x, y, z }
  // x, z are grid coords, y is layer index
  // Grid origin is the castle center
  buildFromLayout(layout, targetPosition, customFloor) {
    this.clear();
    this.layoutData = layout;

    const halfW = Math.floor(this.gridWidth / 2);
    const halfD = Math.floor(this.gridDepth / 2);

    // Shared geometries for each block type (create once, reuse)
    const geometries = createAllBlockGeometries();

    // Physics shapes
    const shapes = {
      CUBE: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
      HALF_SLAB: new CANNON.Box(new CANNON.Vec3(0.5, 0.25, 0.5)),
      WALL: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.25)),
      COLUMN: new CANNON.Cylinder(0.25, 0.25, BLOCK_SIZE, 8),
      BULLNOSE: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
      THRUSTER: new CANNON.Cylinder(0.25, 0.3, 0.8, 8),
      SHIELD: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.25)),
      HALF_BULLNOSE: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
      RAMP: createRampPhysicsShape(),
      QUARTER_DOME: createQuarterDomePhysicsShape(),
      PLANK: new CANNON.Box(new CANNON.Vec3(1.0, 0.125, 0.25)),
      CYLINDER: new CANNON.Cylinder(0.5, 0.5, BLOCK_SIZE, 12),
      LATTICE: new CANNON.Box(new CANNON.Vec3(0.5, 0.05, 0.5)),
      BARREL: new CANNON.Cylinder(0.25, 0.25, 0.5, 8),
    };

    const baseMat = new THREE.MeshStandardMaterial({ color: this.color });

    // Build floor layer (static)
    if (customFloor && customFloor.length > 0) {
      // Custom shaped floor — uses block types for hull contouring
      for (const fb of customFloor) {
        const geo = geometries[fb.type] || geometries.CUBE;
        const worldX = this.centerX + (fb.x - halfW) * BLOCK_SIZE;
        const worldY = BLOCK_SIZE / 2 + (fb.yOffset || 0) * BLOCK_SIZE;
        const worldZ = (fb.z - halfD) * BLOCK_SIZE;

        const mat = baseMat.clone();
        mat.color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(worldX, worldY, worldZ);
        mesh.rotation.y = (fb.rotation || 0) * Math.PI / 2;
        // Flip upside down for ventral hull contouring
        if (fb.flip) {
          mesh.rotation.x = Math.PI;
        }
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.sceneManager.scene.add(mesh);

        const shape = shapes[fb.type] || shapes.CUBE;

        const body = new CANNON.Body({
          mass: 0,
          shape: shape,
          position: new CANNON.Vec3(worldX, worldY, worldZ),
          material: this.physicsWorld.defaultMaterial,
        });
        body.quaternion.setFromEuler(
          fb.flip ? Math.PI : 0,
          (fb.rotation || 0) * Math.PI / 2,
          0
        );
        this.physicsWorld.world.addBody(body);
        this.physicsWorld.addPair(mesh, body);
        this.blocks.push({ mesh, body });
        if (this.physicsWorld.waterSurface) {
          this.physicsWorld.registerFloorBody(body, this.centerX);
        }
      }
    } else {
      // Default flat floor
      for (let gx = 0; gx < this.gridWidth; gx++) {
        for (let gz = 0; gz < this.gridDepth; gz++) {
          const worldX = this.centerX + (gx - halfW) * BLOCK_SIZE;
          const worldY = BLOCK_SIZE / 2;
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
      const worldX = this.centerX + (block.x - halfW) * BLOCK_SIZE;
      const yOffset = typeInfo.size[1] < BLOCK_SIZE ? typeInfo.size[1] / 2 : BLOCK_SIZE / 2;
      const worldY = block.y * BLOCK_SIZE + yOffset + BLOCK_SIZE; // +BLOCK_SIZE for floor layer
      const worldZ = (block.z - halfD) * BLOCK_SIZE;

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
      const rotX = (block.rotX || 0) * Math.PI / 2;
      const rotY = (block.rotation || 0) * Math.PI / 2;
      const rotZ = (block.rotZ || 0) * Math.PI / 2 + (typeInfo.rotZ || 0);
      mesh.rotation.set(rotX, rotY, rotZ);

      this.sceneManager.scene.add(mesh);

      // Physics body
      const shape = shapes[block.type] || shapes.CUBE;
      const blockMass = typeInfo.mass ?? BLOCK_MASS;
      const body = new CANNON.Body({
        mass: blockMass,
        shape: shape,
        position: new CANNON.Vec3(worldX, worldY, worldZ),
        material: this.physicsWorld.defaultMaterial,
      });

      body.quaternion.setFromEuler(rotX, rotY, rotZ);

      // Enable sleep for performance
      body.allowSleep = true;
      body.sleepSpeedLimit = 0.1;
      body.sleepTimeLimit = 0.5;
      body.sleep(); // Start sleeping since blocks are at rest

      this.physicsWorld.world.addBody(body);
      this.physicsWorld.addPair(mesh, body);
      this.blocks.push({ mesh, body });
    }

    // Create target
    this.createTarget(targetPosition, halfW, halfD);
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
    const worldY = gridPos.y * BLOCK_SIZE + BLOCK_SIZE + 0.5; // on top of floor + half sphere
    const worldZ = (gridPos.z - halfD) * BLOCK_SIZE;

    this.target.position.set(worldX, worldY, worldZ);
    this.sceneManager.scene.add(this.target);

    // Add a point light to make target glow and be visible through gaps
    this.targetLight = new THREE.PointLight(0xff4444, 1, 8);
    this.targetLight.position.copy(this.target.position);
    this.sceneManager.scene.add(this.targetLight);

    // Physics body (sensor - detects collision but doesn't block)
    this.targetBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Sphere(0.5),
      position: new CANNON.Vec3(worldX, worldY, worldZ),
      collisionResponse: false,
    });
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

    // World Y: floor (BLOCK_SIZE) + stacked block height + cannon base offset
    const worldY = BLOCK_SIZE + maxLayerTop * BLOCK_SIZE + 0.25;
    return new THREE.Vector3(worldX, worldY, worldZ);
  }

  removeTarget() {
    if (this.target) {
      this.sceneManager.scene.remove(this.target);
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
      this.sceneManager.scene.remove(mesh);
      this.physicsWorld.world.removeBody(body);
    }
    // Also remove from pairs
    for (const { mesh } of this.blocks) {
      const idx = this.physicsWorld.pairs.findIndex(p => p.mesh === mesh);
      if (idx >= 0) this.physicsWorld.pairs.splice(idx, 1);
    }
    this.blocks = [];

    if (this.target) {
      this.sceneManager.scene.remove(this.target);
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
