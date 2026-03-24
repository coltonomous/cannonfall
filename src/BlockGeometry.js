import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BLOCK_SIZE } from './constants.js';

/**
 * Shared block geometry factories used by both Castle.js (runtime) and
 * CastleBuilder.js (build-phase preview).  Keeps the shape definitions
 * in one place so they can't drift out of sync.
 */

export function createRampGeometry() {
  const geo = new THREE.BufferGeometry();
  const vertices = new Float32Array([
    // Front face (triangle)
    -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,  -0.5,  0.5,  0.5,
    // Back face (triangle)
    -0.5, -0.5, -0.5,  -0.5,  0.5, -0.5,   0.5, -0.5, -0.5,
    // Bottom face (quad as 2 triangles)
    -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5, -0.5,  0.5,
    -0.5, -0.5, -0.5,   0.5, -0.5,  0.5,  -0.5, -0.5,  0.5,
    // Left face (quad as 2 triangles)
    -0.5, -0.5, -0.5,  -0.5, -0.5,  0.5,  -0.5,  0.5,  0.5,
    -0.5, -0.5, -0.5,  -0.5,  0.5,  0.5,  -0.5,  0.5, -0.5,
    // Slope face (quad as 2 triangles)
     0.5, -0.5, -0.5,  -0.5,  0.5, -0.5,  -0.5,  0.5,  0.5,
     0.5, -0.5, -0.5,  -0.5,  0.5,  0.5,   0.5, -0.5,  0.5,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.computeVertexNormals();
  return geo;
}

export function createHalfArchGeometry() {
  const segs = 8;
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(0.5, 0.5);
  for (let i = 1; i <= segs; i++) {
    const a = (Math.PI / 2) * (i / segs);
    shape.lineTo(0.5 * Math.cos(a), 0.5 * Math.sin(a));
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  geo.translate(-0.25, 0, -0.5);
  geo.computeVertexNormals();
  return geo;
}

export function createBullnoseGeometry(full) {
  const segs = 6;
  const shape = new THREE.Shape();
  if (full) {
    shape.moveTo(-0.5, -0.5);
    shape.lineTo(0.5, -0.5);
    shape.lineTo(0.5, 0);
    for (let i = 1; i <= segs; i++) {
      const a = (Math.PI / 2) * (i / segs);
      shape.lineTo(0.5 * Math.cos(a), 0.5 * Math.sin(a));
    }
    for (let i = 1; i <= segs; i++) {
      const a = (Math.PI / 2) + (Math.PI / 2) * (i / segs);
      shape.lineTo(0.5 * Math.cos(a), 0.5 * Math.sin(a));
    }
  } else {
    shape.moveTo(-0.5, -0.5);
    shape.lineTo(0.5, -0.5);
    shape.lineTo(0.5, 0.5);
    shape.lineTo(0, 0.5);
    for (let i = 1; i <= segs; i++) {
      const a = (Math.PI / 2) * (i / segs);
      shape.lineTo(-0.5 * Math.sin(a), 0.5 * Math.cos(a));
    }
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  geo.translate(0, 0, -0.5);
  geo.computeVertexNormals();
  return geo;
}

export function createQuarterDomeGeometry() {
  const segments = 6;
  const vertices = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const phi = (i / segments) * Math.PI / 2;
    for (let j = 0; j <= segments; j++) {
      const theta = (j / segments) * Math.PI / 2;
      const x = 0.5 * Math.cos(phi) * Math.cos(theta) - 0.5;
      const y = 0.5 * Math.sin(phi) - 0.5;
      const z = 0.5 * Math.cos(phi) * Math.sin(theta) - 0.5;
      vertices.push(x, y, z);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j;
      const b = a + segments + 1;
      indices.push(a, b, a + 1);
      indices.push(a + 1, b, b + 1);
    }
  }
  for (let j = 0; j < segments; j++) {
    indices.push(0, j + 1, j);
  }
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

export function createThrusterGeometry() {
  return new THREE.CylinderGeometry(0.2, 0.3, 0.8, 8);
}

export function createWedgeGeometry() {
  // Triangular prism: flat vertical back face, slopes to a point at the front.
  // Like a ramp but the sloped face meets the bottom at z=+0.5 (front).
  const geo = new THREE.BufferGeometry();
  const v = new Float32Array([
    // Back face (quad, full height at z=-0.5)
    -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5,  0.5, -0.5,
    -0.5, -0.5, -0.5,   0.5,  0.5, -0.5,  -0.5,  0.5, -0.5,
    // Bottom face (quad)
    -0.5, -0.5, -0.5,  -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,
    -0.5, -0.5, -0.5,   0.5, -0.5,  0.5,   0.5, -0.5, -0.5,
    // Left slope (triangle)
    -0.5, -0.5, -0.5,  -0.5,  0.5, -0.5,  -0.5, -0.5,  0.5,
    // Right slope (triangle)
     0.5, -0.5, -0.5,   0.5, -0.5,  0.5,   0.5,  0.5, -0.5,
    // Top slope (quad from top-back edge down to bottom-front edge)
    -0.5,  0.5, -0.5,   0.5,  0.5, -0.5,   0.5, -0.5,  0.5,
    -0.5,  0.5, -0.5,   0.5, -0.5,  0.5,  -0.5, -0.5,  0.5,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.computeVertexNormals();
  return geo;
}

export function createLatticeGeometry() {
  // Flat grate — thin plane with slight thickness
  return new THREE.BoxGeometry(BLOCK_SIZE, 0.1, BLOCK_SIZE);
}

/**
 * Returns a complete geometries map for all block types.
 * Callers can use this instead of building the map themselves.
 */
export function createAllBlockGeometries() {
  return {
    CUBE: new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE),
    HALF_SLAB: new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE * 0.5, BLOCK_SIZE),
    WALL: new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE * 0.5),
    RAMP: createRampGeometry(),
    COLUMN: new THREE.CylinderGeometry(0.25, 0.25, BLOCK_SIZE, 8),
    QUARTER_DOME: createQuarterDomeGeometry(),
    HALF_ARCH: createHalfArchGeometry(),
    BULLNOSE: createBullnoseGeometry(true),
    HALF_BULLNOSE: createBullnoseGeometry(false),
    THRUSTER: createThrusterGeometry(),
    SHIELD: new THREE.BoxGeometry(BLOCK_SIZE * 1.05, BLOCK_SIZE * 1.05, BLOCK_SIZE * 0.5),
    PLANK: new THREE.BoxGeometry(BLOCK_SIZE * 2, BLOCK_SIZE * 0.25, BLOCK_SIZE * 0.5),
    CYLINDER: new THREE.CylinderGeometry(0.5, 0.5, BLOCK_SIZE, 12),
    WEDGE: createWedgeGeometry(),
    LATTICE: createLatticeGeometry(),
    BARREL: new THREE.CylinderGeometry(0.25, 0.25, 0.5, 8),
  };
}

// === Physics shapes (CANNON.js) ===

export function createRampPhysicsShape() {
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

export function createWedgePhysicsShape() {
  // Triangular prism: full-height back face, slopes to bottom-front edge
  const vertices = [
    new CANNON.Vec3(-0.5, -0.5, -0.5), // 0: back-bottom-left
    new CANNON.Vec3( 0.5, -0.5, -0.5), // 1: back-bottom-right
    new CANNON.Vec3(-0.5,  0.5, -0.5), // 2: back-top-left
    new CANNON.Vec3( 0.5,  0.5, -0.5), // 3: back-top-right
    new CANNON.Vec3(-0.5, -0.5,  0.5), // 4: front-bottom-left
    new CANNON.Vec3( 0.5, -0.5,  0.5), // 5: front-bottom-right
  ];
  const faces = [
    [0, 1, 3, 2], // back (CCW from outside = looking at -Z face)
    [1, 0, 4, 5], // bottom
    [0, 2, 4],     // left triangle
    [3, 1, 5],     // right triangle
    [2, 3, 5, 4],  // slope
  ];
  return new CANNON.ConvexPolyhedron({ vertices, faces });
}

export function createQuarterDomePhysicsShape() {
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
    [3, 4, 1, 0], // back face (XY plane)
    [2, 5, 3, 0], // left face (YZ plane)
    [1, 6, 2, 0], // bottom face (XZ plane)
    [1, 6, 4],     // front-right
    [2, 5, 6],     // front-left
    [3, 4, 5],     // top
    [4, 6, 5],     // curved face approx
  ];
  return new CANNON.ConvexPolyhedron({ vertices: verts, faces });
}
