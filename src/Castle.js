import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BLOCK_SIZE, BLOCK_MASS, BLOCK_TYPES, CASTLE_WIDTH, CASTLE_DEPTH } from './constants.js';

export class Castle {
  constructor(sceneManager, physicsWorld, centerX, color) {
    this.sceneManager = sceneManager;
    this.physicsWorld = physicsWorld;
    this.centerX = centerX;
    this.color = new THREE.Color(color);
    this.blocks = []; // { mesh, body }
    this.target = null; // THREE.Mesh
    this.targetBody = null; // CANNON.Body
  }

  // Build from a layout array: [{ x, y, z, type: 'CUBE'|'HALF_SLAB'|'WALL'|'RAMP', rotation: 0-3 }]
  // and a targetPosition: { x, y, z }
  // x, z are in grid coords (0-6), y is layer (0-5)
  // Grid origin is the castle center, so offset by -3 to +3
  buildFromLayout(layout, targetPosition) {
    this.clear();
    this.layoutData = layout; // store for cannon placement queries

    const halfW = Math.floor(CASTLE_WIDTH / 2);

    // Shared geometries for each block type (create once, reuse)
    const geometries = {
      CUBE: new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE),
      HALF_SLAB: new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE * 0.5, BLOCK_SIZE),
      WALL: new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE * 0.5),
      RAMP: this.createRampGeometry(),
      COLUMN: new THREE.CylinderGeometry(0.25, 0.25, BLOCK_SIZE, 8),
      QUARTER_DOME: this.createQuarterDomeGeometry(),
    };

    // Physics shapes
    const shapes = {
      CUBE: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
      HALF_SLAB: new CANNON.Box(new CANNON.Vec3(0.5, 0.25, 0.5)),
      WALL: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.25)),
      COLUMN: new CANNON.Cylinder(0.25, 0.25, BLOCK_SIZE, 8),
      // RAMP and QUARTER_DOME use ConvexPolyhedron
    };

    const baseMat = new THREE.MeshStandardMaterial({ color: this.color });

    // Build floor layer (static, always present, y=0)
    for (let gx = 0; gx < CASTLE_WIDTH; gx++) {
      for (let gz = 0; gz < CASTLE_DEPTH; gz++) {
        const worldX = this.centerX + (gx - halfW) * BLOCK_SIZE;
        const worldY = BLOCK_SIZE / 2;
        const worldZ = (gz - halfW) * BLOCK_SIZE;

        const mat = baseMat.clone();
        mat.color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);

        const mesh = new THREE.Mesh(geometries.CUBE, mat);
        mesh.position.set(worldX, worldY, worldZ);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.sceneManager.scene.add(mesh);

        const body = new CANNON.Body({
          mass: 0, // static
          shape: shapes.CUBE,
          position: new CANNON.Vec3(worldX, worldY, worldZ),
          material: this.physicsWorld.defaultMaterial,
        });
        this.physicsWorld.world.addBody(body);
        this.physicsWorld.addPair(mesh, body);
        this.blocks.push({ mesh, body });
      }
    }

    // Build player-placed blocks
    for (const block of layout) {
      const typeInfo = BLOCK_TYPES[block.type];
      if (!typeInfo) continue;

      const geo = geometries[block.type];
      const worldX = this.centerX + (block.x - halfW) * BLOCK_SIZE;
      const yOffset = block.type === 'HALF_SLAB' ? typeInfo.size[1] / 2 : BLOCK_SIZE / 2;
      const worldY = block.y * BLOCK_SIZE + yOffset + BLOCK_SIZE; // +BLOCK_SIZE for floor layer
      const worldZ = (block.z - halfW) * BLOCK_SIZE;

      const mat = baseMat.clone();
      mat.color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(worldX, worldY, worldZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Apply rotation (around Y axis, 90-degree increments)
      const rotY = (block.rotation || 0) * Math.PI / 2;
      mesh.rotation.y = rotY;

      this.sceneManager.scene.add(mesh);

      // Physics body
      let shape;
      if (block.type === 'RAMP') {
        shape = this.createRampShape();
      } else if (block.type === 'QUARTER_DOME') {
        shape = this.createQuarterDomeShape();
      } else {
        shape = shapes[block.type];
      }

      const body = new CANNON.Body({
        mass: BLOCK_MASS,
        shape: shape,
        position: new CANNON.Vec3(worldX, worldY, worldZ),
        material: this.physicsWorld.defaultMaterial,
      });

      // Apply same rotation to physics body
      body.quaternion.setFromEuler(0, rotY, 0);

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
    this.createTarget(targetPosition, halfW);
  }

  createRampGeometry() {
    // Wedge/ramp: triangular prism
    // Base is 1x1 on XZ, height 1 on Y
    // Creates a right-triangle cross-section
    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      // Front face (triangle)
      -0.5, -0.5,  0.5,
       0.5, -0.5,  0.5,
      -0.5,  0.5,  0.5,
      // Back face (triangle)
      -0.5, -0.5, -0.5,
      -0.5,  0.5, -0.5,
       0.5, -0.5, -0.5,
      // Bottom face (quad as 2 tris)
      -0.5, -0.5, -0.5,
       0.5, -0.5, -0.5,
       0.5, -0.5,  0.5,
      -0.5, -0.5, -0.5,
       0.5, -0.5,  0.5,
      -0.5, -0.5,  0.5,
      // Left face (quad as 2 tris)
      -0.5, -0.5, -0.5,
      -0.5, -0.5,  0.5,
      -0.5,  0.5,  0.5,
      -0.5, -0.5, -0.5,
      -0.5,  0.5,  0.5,
      -0.5,  0.5, -0.5,
      // Slope face (quad as 2 tris)
       0.5, -0.5, -0.5,
      -0.5,  0.5, -0.5,
      -0.5,  0.5,  0.5,
       0.5, -0.5, -0.5,
      -0.5,  0.5,  0.5,
       0.5, -0.5,  0.5,
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.computeVertexNormals();
    return geo;
  }

  createRampShape() {
    // cannon-es ConvexPolyhedron for the ramp
    const vertices = [
      new CANNON.Vec3(-0.5, -0.5, -0.5),
      new CANNON.Vec3( 0.5, -0.5, -0.5),
      new CANNON.Vec3(-0.5, -0.5,  0.5),
      new CANNON.Vec3( 0.5, -0.5,  0.5),
      new CANNON.Vec3(-0.5,  0.5, -0.5),
      new CANNON.Vec3(-0.5,  0.5,  0.5),
    ];
    const faces = [
      [0, 1, 3, 2], // bottom
      [0, 2, 5, 4], // left
      [0, 4, 1],    // back triangle
      [2, 3, 5],    // front triangle (corrected winding)
      [1, 4, 5, 3], // slope
    ];
    return new CANNON.ConvexPolyhedron({ vertices, faces });
  }

  createQuarterDomeGeometry() {
    // Quarter sphere dome — sits in one corner of the block space
    const segments = 6;
    const vertices = [];
    const indices = [];

    // Generate quarter sphere vertices
    for (let i = 0; i <= segments; i++) {
      const phi = (i / segments) * Math.PI / 2; // 0 to PI/2
      for (let j = 0; j <= segments; j++) {
        const theta = (j / segments) * Math.PI / 2; // 0 to PI/2
        const x = 0.5 * Math.cos(phi) * Math.cos(theta) - 0.5;
        const y = 0.5 * Math.sin(phi) - 0.5;
        const z = 0.5 * Math.cos(phi) * Math.sin(theta) - 0.5;
        vertices.push(x, y, z);
      }
    }

    // Generate faces
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < segments; j++) {
        const a = i * (segments + 1) + j;
        const b = a + segments + 1;
        indices.push(a, b, a + 1);
        indices.push(a + 1, b, b + 1);
      }
    }

    // Add flat faces to close the shape
    // Bottom face
    for (let j = 0; j < segments; j++) {
      indices.push(0, j + 1, j);
    }
    // Side face (phi=0 edge)
    const stride = segments + 1;
    for (let i = 0; i < segments; i++) {
      indices.push(0, i * stride, (i + 1) * stride);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  createQuarterDomeShape() {
    // Approximate quarter dome as a convex hull for physics
    const verts = [
      new CANNON.Vec3(-0.5, -0.5, -0.5), // origin corner
      new CANNON.Vec3( 0.0, -0.5, -0.5), // bottom edge X
      new CANNON.Vec3(-0.5, -0.5,  0.0), // bottom edge Z
      new CANNON.Vec3(-0.5,  0.0, -0.5), // side edge Y
      new CANNON.Vec3( 0.0,  0.0, -0.5), // curve approx
      new CANNON.Vec3(-0.5,  0.0,  0.0), // curve approx
      new CANNON.Vec3( 0.0, -0.5,  0.0), // curve approx
    ];
    const faces = [
      [0, 1, 4, 3], // back face (XY plane)
      [0, 3, 5, 2], // left face (YZ plane)
      [0, 2, 6, 1], // bottom face (XZ plane)
      [1, 6, 4],     // front-right
      [2, 5, 6],     // front-left
      [3, 4, 5],     // top
      [4, 6, 5],     // curved face approx
    ];
    return new CANNON.ConvexPolyhedron({ vertices: verts, faces });
  }

  createTarget(gridPos, halfW) {
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
    const worldZ = (gridPos.z - halfW) * BLOCK_SIZE;

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
    const halfW = Math.floor(CASTLE_WIDTH / 2);
    const worldX = this.centerX + (gridX - halfW) * BLOCK_SIZE;
    const worldZ = (gridZ - halfW) * BLOCK_SIZE;

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
    const halfW = Math.floor(CASTLE_WIDTH / 2);
    this.createTarget(gridPos, halfW);
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
