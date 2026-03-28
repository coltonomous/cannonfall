/**
 * CANNON-only physics shape factories.
 *
 * Shared between the game (Castle.js / BlockGeometry.js) and the
 * headless training environment.  No THREE.js dependency.
 */

import * as CANNON from 'cannon-es';
import { BLOCK_SIZE } from './constants.js';

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

/** All physics shapes keyed by BLOCK_TYPES name. */
export function createAllPhysicsShapes() {
  return {
    CUBE:         new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
    HALF_SLAB:    new CANNON.Box(new CANNON.Vec3(0.5, 0.25, 0.5)),
    WALL:         new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.25)),
    COLUMN:       new CANNON.Cylinder(0.25, 0.25, BLOCK_SIZE, 8),
    BULLNOSE:     new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
    HALF_BULLNOSE:new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
    THRUSTER:     new CANNON.Cylinder(0.25, 0.3, 0.8, 8),
    SHIELD:       new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.25)),
    RAMP:         createRampPhysicsShape(),
    QUARTER_DOME: createQuarterDomePhysicsShape(),
    PLANK:        new CANNON.Box(new CANNON.Vec3(1.0, 0.125, 0.25)),
    CYLINDER:     new CANNON.Cylinder(0.5, 0.5, BLOCK_SIZE, 12),
    LATTICE:      new CANNON.Box(new CANNON.Vec3(0.5, 0.05, 0.5)),
    BARREL:       new CANNON.Cylinder(0.25, 0.25, 0.5, 8),
  };
}
