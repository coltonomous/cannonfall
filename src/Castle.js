import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BLOCK_SIZE, BLOCK_MASS, BLOCK_TYPES, CASTLE_WIDTH, CASTLE_DEPTH } from './constants.js';

export class Castle {
  constructor(sceneManager, physicsWorld, centerX, color, gridConfig) {
    this.sceneManager = sceneManager;
    this.physicsWorld = physicsWorld;
    this.centerX = centerX;
    this.color = new THREE.Color(color);
    this.gridWidth = gridConfig?.gridWidth || CASTLE_WIDTH;
    this.gridDepth = gridConfig?.gridDepth || CASTLE_DEPTH;
    this.blocks = []; // { mesh, body }
    this.target = null; // THREE.Mesh
    this.targetBody = null; // CANNON.Body
  }

  // Build from a layout array: [{ x, y, z, type: 'CUBE'|'HALF_SLAB'|'WALL'|'RAMP', rotation: 0-3 }]
  // and a targetPosition: { x, y, z }
  // x, z are in grid coords (0-6), y is layer (0-5)
  // Grid origin is the castle center, so offset by -3 to +3
  buildFromLayout(layout, targetPosition, customFloor) {
    this.clear();
    this.layoutData = layout;

    const halfW = Math.floor(this.gridWidth / 2);
    const halfD = Math.floor(this.gridDepth / 2);

    // Shared geometries for each block type (create once, reuse)
    const geometries = {
      CUBE: new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE),
      HALF_SLAB: new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE * 0.5, BLOCK_SIZE),
      WALL: new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE * 0.5),
      RAMP: this.createRampGeometry(),
      COLUMN: new THREE.CylinderGeometry(0.25, 0.25, BLOCK_SIZE, 8),
      QUARTER_DOME: this.createQuarterDomeGeometry(),
      HALF_ARCH: this.createHalfArchGeometry(),
      BULLNOSE: this.createBullnoseGeometry(true),
      HALF_BULLNOSE: this.createBullnoseGeometry(false),
      THRUSTER: this.createThrusterGeometry(),
      SHIELD: new THREE.BoxGeometry(BLOCK_SIZE * 1.05, BLOCK_SIZE * 1.05, BLOCK_SIZE * 0.5),
    };

    // Physics shapes
    const shapes = {
      CUBE: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
      HALF_SLAB: new CANNON.Box(new CANNON.Vec3(0.5, 0.25, 0.5)),
      WALL: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.25)),
      COLUMN: new CANNON.Cylinder(0.25, 0.25, BLOCK_SIZE, 8),
      HALF_ARCH: new CANNON.Box(new CANNON.Vec3(0.25, 0.5, 0.5)),
      BULLNOSE: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
      THRUSTER: new CANNON.Cylinder(0.25, 0.3, 0.8, 8),
      SHIELD: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.25)),
      HALF_BULLNOSE: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
      // RAMP and QUARTER_DOME use ConvexPolyhedron
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

        let shape;
        if (fb.type === 'RAMP') shape = this.createRampShape();
        else if (fb.type === 'QUARTER_DOME') shape = this.createQuarterDomeShape();
        else shape = shapes[fb.type] || shapes.CUBE;

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
        }
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
      const worldZ = (block.z - halfD) * BLOCK_SIZE;

      let mat;
      if (block.type === 'SHIELD') {
        mat = new THREE.MeshStandardMaterial({
          color: 0x4488ff,
          transparent: true,
          opacity: 0.35,
          emissive: 0x2244aa,
          emissiveIntensity: 0.3,
        });
      } else {
        mat = baseMat.clone();
        mat.color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
      }

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(worldX, worldY, worldZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Apply rotation (around Y axis, 90-degree increments)
      const rotY = (block.rotation || 0) * Math.PI / 2;
      mesh.rotation.y = rotY;

      // Thruster is a horizontal cylinder — tilt 90° around Z
      if (block.type === 'THRUSTER') {
        mesh.rotation.z = Math.PI / 2;
      }

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

      const blockMass = block.type === 'SHIELD' ? 0.3 : BLOCK_MASS;
      const body = new CANNON.Body({
        mass: blockMass,
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
    this.createTarget(targetPosition, halfW, halfD);
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

  createThrusterGeometry() {
    // Horizontal cylinder (engine nacelle) — cone shape, wider at back
    const geo = new THREE.CylinderGeometry(0.2, 0.3, 0.8, 8);
    // Oriented along Y by default; rotation.z = PI/2 applied in buildFromLayout
    return geo;
  }

  createHalfArchGeometry() {
    // Half-arch: half-cube-width pillar with quarter-circle curve at top inner edge.
    // Place two side by side (one rotated 180°) to form a full arch 1 cube wide.
    // Width: 0.5, Height: 1, Depth: 1
    const segs = 8;
    const verts = [];
    const idx = [];

    // Outer face (x=0.5): full rectangle
    verts.push(0.5, -0.5, -0.5); // 0
    verts.push(0.5, -0.5, 0.5);  // 1
    verts.push(0.5, 0.5, 0.5);   // 2
    verts.push(0.5, 0.5, -0.5);  // 3
    idx.push(0, 1, 2, 0, 2, 3);

    // Bottom face
    verts.push(0.0, -0.5, -0.5); // 4
    verts.push(0.0, -0.5, 0.5);  // 5
    idx.push(4, 0, 1, 4, 1, 5);

    // Front face (z=0.5): rectangle + curve
    // Inner edge has curve from (0, 0, 0.5) up to (0.5, 0.5, 0.5)
    const frontCurveStart = verts.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const angle = t * Math.PI / 2;
      const x = 0.5 * (1 - Math.cos(angle)); // 0 → 0.5
      const y = 0.5 * Math.sin(angle) - 0.5 + 0.5; // 0 → 0.5, shifted to -0.5+0.5=0 → 0.5
      // Actually: spring at y=0, curve to y=0.5
      verts.push(x, -0.5 + (1.0 * Math.sin(angle)), 0.5);
    }
    // Front lower rect: from (0,-0.5) to (0.5,-0.5) to curve start
    // The curve starts at (0, -0.5, 0.5) when i=0: x=0, y=-0.5+0=-0.5. Hmm that's the bottom.
    // Let me redo: curve from (0, 0, z) to (0.5, 0.5, z)
    // At i=0: angle=0, x=0, y=sin(0)=0. At i=segs: angle=π/2, x=0.5, y=0.5.
    // But the pillar below needs to go from y=-0.5 to y=0 at x=0.

    // Restart front face approach:
    // Bottom-inner (0, -0.5, 0.5) = vertex 5
    // Bottom-outer (0.5, -0.5, 0.5) = vertex 1
    // Top-outer (0.5, 0.5, 0.5) = vertex 2
    // Curve points from (0, 0, 0.5) to (0.5, 0.5, 0.5)

    // Clear and redo properly
    verts.length = 0;
    idx.length = 0;

    const hw = 0.25; // half of 0.5 width
    // Use x from -hw to hw (centered), or 0 to 0.5?
    // Let's use 0 to 0.5 for the width

    // 8 corners of the base box (0 to 0.5 in X, -0.5 to 0.5 in Y, -0.5 to 0.5 in Z)
    // But the inner top edge is curved, not straight
    // Simpler: use ExtrudeGeometry with a shape

    const shape = new THREE.Shape();
    // Start at bottom-outer
    shape.moveTo(0.5, -0.5);
    shape.lineTo(0.5, 0.5);  // up outer edge
    // Curve from top-outer to inner spring point
    for (let i = 0; i <= segs; i++) {
      const angle = (i / segs) * Math.PI / 2;
      const x = 0.5 * Math.cos(angle);
      const y = 0.5 * Math.sin(angle);
      shape.lineTo(x, y);
    }
    // At end of curve: x=0, y=0.5... no.
    // cos(π/2)=0, sin(π/2)=1. So x=0, y=0.5. That goes from (0.5,0.5) to (0,0.5). That's a flat top, not an arch.
    // I need the curve to go from (0.5, 0.5) down to (0, 0) — the inner edge.
    // Quarter circle: from top-outer corner to inner-mid point
    // Curve: x = 0.5*cos(θ), y = 0.5*sin(θ) for θ from π/2 to 0
    // At θ=π/2: (0, 0.5). At θ=0: (0.5, 0). Hmm, that's the wrong direction.

    // OK let me think about this shape in profile (XY cross section):
    // Outer wall at x=0.5: full height from y=-0.5 to y=0.5
    // Inner edge at x=0: from y=-0.5 up to y=0 (spring point)
    // Curve from (x=0, y=0) to (x=0.5, y=0.5): quarter circle
    // This creates a pillar on the left half with a curved top right

    const shape2 = new THREE.Shape();
    shape2.moveTo(0, -0.5);       // bottom-inner
    shape2.lineTo(0.5, -0.5);     // bottom-outer
    shape2.lineTo(0.5, 0.5);      // top-outer
    // Quarter circle from (0.5, 0.5) to (0, 0)
    for (let i = 1; i <= segs; i++) {
      const angle = (Math.PI / 2) * (i / segs);
      const x = 0.5 * Math.cos(angle);
      const y = 0.5 * Math.sin(angle);
      shape2.lineTo(x, y);
    }
    // Close: from (0, 0) back to (0, -0.5) is implicit

    const extrudeSettings = { depth: 1, bevelEnabled: false };
    const geo = new THREE.ExtrudeGeometry(shape2, extrudeSettings);
    // Center on Z axis (extrude goes 0 to 1, shift to -0.5 to 0.5)
    geo.translate(0, 0, -0.5);
    // Shift X so it's centered: currently 0 to 0.5, shift to -0.25 to 0.25
    geo.translate(-0.25, 0, 0);
    geo.computeVertexNormals();
    return geo;
  }

  createBullnoseGeometry(full) {
    // Bullnose: a cube with rounded top edges along the Z axis.
    // full=true: both top edges rounded (top becomes a half-cylinder).
    // full=false: only one top edge rounded (half-bullnose).
    const segs = 6;
    const r = 0.5; // radius = half the block size
    const shape = new THREE.Shape();

    if (full) {
      // Profile in YZ: rectangle with both top corners rounded
      shape.moveTo(-0.5, -0.5);
      shape.lineTo(0.5, -0.5);
      shape.lineTo(0.5, 0);
      // Right rounded corner: quarter circle from (0.5, 0) to (0, 0.5)
      for (let i = 1; i <= segs; i++) {
        const a = (Math.PI / 2) * (i / segs);
        shape.lineTo(0.5 * Math.cos(a), 0.5 * Math.sin(a));
      }
      // Left rounded corner: quarter circle from (0, 0.5) to (-0.5, 0)
      for (let i = 1; i <= segs; i++) {
        const a = (Math.PI / 2) + (Math.PI / 2) * (i / segs);
        shape.lineTo(0.5 * Math.cos(a), 0.5 * Math.sin(a));
      }
      // Close to (-0.5, -0.5)
    } else {
      // Half-bullnose: only one top corner rounded
      shape.moveTo(-0.5, -0.5);
      shape.lineTo(0.5, -0.5);
      shape.lineTo(0.5, 0.5);
      // Rounded corner from (0.5, 0.5) toward (0, 0.5)... actually let me do top-right
      // Flat top from (0.5, 0.5) to (-0.5, 0.5) but with one corner rounded
      // Round the top-left corner: from (-0.5, 0.5) to (-0.5, 0)
      shape.lineTo(0, 0.5);
      for (let i = 1; i <= segs; i++) {
        const a = (Math.PI / 2) * (i / segs);
        shape.lineTo(-0.5 * Math.sin(a), 0.5 * Math.cos(a));
      }
      // Now at (-0.5, 0), close to (-0.5, -0.5)
    }

    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    geo.translate(0, 0, -0.5);
    geo.computeVertexNormals();
    return geo;
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
