import {
  fillRowX, fillRect, fillHull,
  place, placeMany, buildKeel, buildMast,
} from './PresetHelpers.js';

export function getPiratePreset(name) {
  switch (name) {
    case 'GALLEON': return galleonPreset();
    case 'SLOOP': return sloopPreset();
    case 'FORTRESS': return fortressPreset();
    default: return galleonPreset();
  }
}

// 7×11 grid (x=0-6, z=0-10). Broadside combat.
// x = beam (faces opponent), z = keel (ship length). z=0 stern, z=10 bow.

function galleonPreset() {
  // Three-masted warship: deep hull, raised stern castle, gun deck, tall masts.
  const L = [];
  const F = [];

  const hullRows = [
    { z: 0,  xMin: 2, xMax: 4 },
    { z: 1,  xMin: 1, xMax: 5 },
    { z: 2,  xMin: 0, xMax: 6 },
    { z: 3,  xMin: 0, xMax: 6 },
    { z: 4,  xMin: 0, xMax: 6 },
    { z: 5,  xMin: 0, xMax: 6 },
    { z: 6,  xMin: 0, xMax: 6 },
    { z: 7,  xMin: 0, xMax: 6 },
    { z: 8,  xMin: 1, xMax: 5 },
    { z: 9,  xMin: 2, xMax: 4 },
    { z: 10, xMin: 3, xMax: 3 },
  ];

  fillHull(L, hullRows, 0, 'CUBE', 'RAMP', 'z');
  buildKeel(F, hullRows, 2);

  // Port/starboard gunwales (y=1-2)
  for (let z = 2; z <= 7; z++) {
    place(L, 0, 1, z, 'WALL', 1);
    place(L, 6, 1, z, 'WALL', 1);
    place(L, 0, 2, z, 'WALL', 1);
    place(L, 6, 2, z, 'WALL', 1);
  }

  // Bow
  placeMany(L, [
    [2,1,9,'RAMP',3], [4,1,9,'RAMP',3],
    [3,1,10,'RAMP',3],
    [1,1,8,'WALL',0], [5,1,8,'WALL',0],
    [1,2,8,'WALL',0], [5,2,8,'WALL',0],
    [2,1,9,'WALL',0], [4,1,9,'WALL',0],
  ]);

  // Stern castle (y=1-3, z=0-2)
  for (let x = 1; x <= 5; x++) {
    for (let z = 0; z <= 2; z++) {
      place(L, x, 1, z, 'CUBE');
      if (!(x === 3 && z === 1)) place(L, x, 2, z, 'CUBE');
    }
  }
  fillRowX(L, 1, 5, 0, 3, 'HALF_SLAB');
  placeMany(L, [
    [1,3,1,'WALL',1], [5,3,1,'WALL',1],
    [1,3,2,'WALL',1], [5,3,2,'WALL',1],
  ]);

  // Captain's quarters stern wall
  place(L, 3, 1, 0, 'WALL', 0);

  // Three masts with yard arms
  buildMast(L, 3, 3, 5);
  place(L, 3, 4, 3, 'PLANK', 1);
  place(L, 3, 3, 3, 'PLANK', 1);
  buildMast(L, 3, 5, 5);
  place(L, 3, 5, 5, 'PLANK', 1);
  place(L, 3, 4, 5, 'PLANK', 1);
  buildMast(L, 3, 7, 4);
  place(L, 3, 3, 7, 'PLANK', 1);

  // Forecastle raised deck (y=1, z=7-8)
  fillRowX(L, 1, 5, 7, 1, 'HALF_SLAB');
  fillRowX(L, 2, 4, 8, 1, 'HALF_SLAB');

  // Gun deck interior supports
  place(L, 2, 1, 4, 'COLUMN');
  place(L, 4, 1, 4, 'COLUMN');
  place(L, 2, 1, 6, 'COLUMN');
  place(L, 4, 1, 6, 'COLUMN');

  // Deck barrels and cargo
  placeMany(L, [
    [1,1,4,'BARREL'], [5,1,4,'BARREL'],
    [1,1,6,'BARREL'], [5,1,6,'BARREL'],
    [1,1,5,'BARREL'], [5,1,5,'BARREL'],
  ]);

  // Lattice gratings
  place(L, 3, 1, 4, 'LATTICE');
  place(L, 3, 1, 6, 'LATTICE');

  return { layout: L, target: { x: 3, y: 2, z: 1 }, cannonPos: { x: 6, z: 5 }, floor: F };
}

function sloopPreset() {
  // Fast two-masted: narrow hull, ramp deflectors, cabin, rigging.
  const L = [];
  const F = [];

  const hullRows = [
    { z: 0,  xMin: 2, xMax: 4 },
    { z: 1,  xMin: 2, xMax: 4 },
    { z: 2,  xMin: 1, xMax: 5 },
    { z: 3,  xMin: 1, xMax: 5 },
    { z: 4,  xMin: 1, xMax: 5 },
    { z: 5,  xMin: 1, xMax: 5 },
    { z: 6,  xMin: 1, xMax: 5 },
    { z: 7,  xMin: 1, xMax: 5 },
    { z: 8,  xMin: 2, xMax: 4 },
    { z: 9,  xMin: 2, xMax: 4 },
    { z: 10, xMin: 3, xMax: 3 },
  ];

  fillHull(L, hullRows, 0, 'CUBE', 'RAMP', 'z');
  buildKeel(F, hullRows, 2);

  // Ramp deflectors port/starboard (y=1)
  for (let z = 3; z <= 6; z++) {
    place(L, 1, 1, z, 'RAMP', 2);
    place(L, 5, 1, z, 'RAMP', 0);
  }

  // Low gunwale at transitions
  for (const z of [2, 7]) {
    place(L, 1, 1, z, 'HALF_SLAB');
    place(L, 5, 1, z, 'HALF_SLAB');
  }

  // Helm cabin (z=0-1, y=1-3) — taller cabin with lookout
  fillRect(L, 2, 4, 0, 1, 1, 'CUBE');
  fillRect(L, 2, 4, 0, 1, 2, 'CUBE');
  fillRowX(L, 2, 4, 0, 3, 'HALF_SLAB');
  place(L, 2, 3, 1, 'WALL', 1);
  place(L, 4, 3, 1, 'WALL', 1);

  // Two masts with yard arms
  buildMast(L, 3, 4, 5);
  place(L, 3, 3, 4, 'PLANK', 1);
  place(L, 3, 5, 4, 'PLANK', 1);
  buildMast(L, 3, 7, 4);
  place(L, 3, 3, 7, 'PLANK', 1);

  // Bowsprit
  place(L, 3, 1, 9, 'RAMP', 3);
  place(L, 3, 1, 10, 'RAMP', 3);

  // Deck structures
  placeMany(L, [
    [2,1,3,'BARREL'], [4,1,3,'BARREL'],
    [2,1,5,'BARREL'], [4,1,5,'BARREL'],
    [2,1,6,'BARREL'], [4,1,6,'BARREL'],
    [3,1,3,'LATTICE'],
    [3,1,6,'LATTICE'],
  ]);

  // Railing along cabin top
  place(L, 2, 3, 0, 'WALL', 0);
  place(L, 4, 3, 0, 'WALL', 0);

  return { layout: L, target: { x: 3, y: 1, z: 5 }, cannonPos: { x: 5, z: 5 }, floor: F };
}

function fortressPreset() {
  // Floating gun platform: wide barge, thick walls, watchtower, corner turrets.
  const L = [];
  const F = [];

  const hullRows = [
    { z: 0,  xMin: 1, xMax: 5 },
    { z: 1,  xMin: 0, xMax: 6 },
    { z: 2,  xMin: 0, xMax: 6 },
    { z: 3,  xMin: 0, xMax: 6 },
    { z: 4,  xMin: 0, xMax: 6 },
    { z: 5,  xMin: 0, xMax: 6 },
    { z: 6,  xMin: 0, xMax: 6 },
    { z: 7,  xMin: 0, xMax: 6 },
    { z: 8,  xMin: 0, xMax: 6 },
    { z: 9,  xMin: 1, xMax: 5 },
    { z: 10, xMin: 2, xMax: 4 },
  ];

  fillHull(L, hullRows, 0, 'CUBE', 'RAMP', 'z');
  buildKeel(F, hullRows, 1);

  // Perimeter walls — single height with half-slab lip
  for (let z = 1; z <= 8; z++) {
    place(L, 0, 1, z, 'WALL', 1);
    place(L, 6, 1, z, 'WALL', 1);
  }
  fillRowX(L, 1, 5, 0, 1, 'WALL', 0);
  fillRowX(L, 1, 5, 9, 1, 'WALL', 0);

  // Crenellations (y=2)
  for (let z = 1; z <= 8; z += 2) {
    place(L, 0, 2, z, 'HALF_SLAB');
    place(L, 6, 2, z, 'HALF_SLAB');
  }

  // Corner posts (y=1-2)
  for (const [x, z] of [[0, 1], [0, 8], [6, 1], [6, 8]]) {
    place(L, x, 2, z, 'CUBE');
  }

  // Central watchtower with mast
  place(L, 3, 1, 5, 'CYLINDER');
  place(L, 3, 2, 5, 'LATTICE');
  buildMast(L, 3, 5, 3);
  place(L, 3, 3, 5, 'PLANK', 1);

  // Bow reinforcement
  placeMany(L, [
    [2,1,10,'RAMP',3], [4,1,10,'RAMP',3],
  ]);

  // Interior supports
  place(L, 2, 1, 3, 'COLUMN');
  place(L, 4, 1, 3, 'COLUMN');
  place(L, 2, 1, 7, 'COLUMN');
  place(L, 4, 1, 7, 'COLUMN');

  // Ammunition barrels
  placeMany(L, [
    [1,1,3,'BARREL'], [5,1,3,'BARREL'],
    [1,1,6,'BARREL'], [5,1,6,'BARREL'],
  ]);

  return { layout: L, target: { x: 3, y: 1, z: 3 }, cannonPos: { x: 6, z: 5 }, floor: F };
}
