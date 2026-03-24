import {
  fillRowX, fillRowZ, fillRect, fillHull,
  place, placeMany,
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
//
// Rotation convention (Y-axis, 90-degree increments):
//   0 = default  1 = 90° CCW  2 = 180°  3 = 270° CCW
// WALL (1x1x0.5): rot=0 thin in Z, rot=1 thin in X
// WEDGE: rot=0 slope toward +Z, rot=2 slope toward -Z

function buildKeel(floor, hullRows, depth) {
  for (const row of hullRows) {
    const { z, xMin, xMax } = row;
    const span = xMax - xMin;
    if (span < 1) {
      floor.push({ x: xMin, z, type: 'WEDGE', yOffset: -depth, flip: true, rotation: 0 });
      continue;
    }
    const center = (xMin + xMax) / 2;
    for (let x = xMin; x <= xMax; x++) {
      const dist = Math.abs(x - center) / (span / 2);
      if (dist > 0.6) {
        const rot = x < center ? 0 : 2;
        floor.push({ x, z, type: 'RAMP', rotation: rot, yOffset: -depth, flip: true });
      } else if (dist > 0.2) {
        floor.push({ x, z, type: 'CUBE', yOffset: -Math.ceil(depth * 0.6) });
      } else {
        floor.push({ x, z, type: 'CUBE', yOffset: -depth });
      }
    }
  }
}

function buildMast(L, x, z, height) {
  place(L, x, 0, z, 'CYLINDER');
  for (let y = 1; y <= height; y++) {
    place(L, x, y, z, 'COLUMN');
  }
}

function galleonPreset() {
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

  fillHull(L, hullRows, 0, 'CUBE', 'HALF_SLAB', 'z');
  buildKeel(F, hullRows, 2);

  // Port/starboard gunwales (thin in X → rot=1)
  for (let z = 2; z <= 7; z++) {
    place(L, 0, 1, z, 'WALL', 1);
    place(L, 6, 1, z, 'WALL', 1);
  }

  // Bow — wedge prow (slope toward +Z → rot=0) + bow rail (thin in Z → rot=0)
  placeMany(L, [
    [2,1,9,'WEDGE',0], [4,1,9,'WEDGE',0],
    [3,1,10,'WEDGE',0],
    [1,1,8,'WALL',0], [5,1,8,'WALL',0],
  ]);

  // Stern castle (y=1-2, z=0-2) — leave gap at target position
  for (let x = 1; x <= 5; x++) {
    for (let z = 0; z <= 2; z++) {
      place(L, x, 1, z, 'CUBE');
      if (!(x === 3 && z === 1)) place(L, x, 2, z, 'CUBE'); // gap for target
    }
  }
  fillRowX(L, 1, 5, 0, 3, 'HALF_SLAB');
  // Stern castle railing (thin in X → rot=1)
  placeMany(L, [
    [1,3,1,'WALL',1], [5,3,1,'WALL',1],
    [1,3,2,'WALL',1], [5,3,2,'WALL',1],
  ]);

  // Captain's quarters windows
  placeMany(L, [[3,1,0,'HALF_ARCH',0], [3,1,0,'HALF_ARCH',2]]);

  // Three masts with yard arms
  buildMast(L, 3, 3, 5);
  place(L, 3, 4, 3, 'PLANK', 1);
  buildMast(L, 3, 5, 5);
  place(L, 3, 4, 5, 'PLANK', 1);
  buildMast(L, 3, 7, 4);
  place(L, 3, 3, 7, 'PLANK', 1);

  // Forecastle (y=1)
  fillRowX(L, 1, 5, 7, 1, 'HALF_SLAB');

  // Deck barrels
  placeMany(L, [
    [1,1,4,'BARREL'], [5,1,4,'BARREL'],
    [1,1,6,'BARREL'], [5,1,6,'BARREL'],
  ]);

  // Lattice grating over hold
  place(L, 3, 1, 4, 'LATTICE');

  return { layout: L, target: { x: 3, y: 2, z: 1 }, cannonPos: { x: 6, z: 5 }, floor: F };
}

function sloopPreset() {
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

  fillHull(L, hullRows, 0, 'CUBE', 'HALF_SLAB', 'z');
  buildKeel(F, hullRows, 2);

  // Ramp deflectors port/starboard (facing outward)
  for (let z = 3; z <= 6; z++) {
    place(L, 1, 1, z, 'RAMP', 2);
    place(L, 5, 1, z, 'RAMP', 0);
  }

  // Low gunwale
  for (const z of [2, 7]) {
    place(L, 1, 1, z, 'HALF_SLAB');
    place(L, 5, 1, z, 'HALF_SLAB');
  }

  // Helm cabin (z=0-1, y=1-2)
  fillRect(L, 2, 4, 0, 1, 1, 'CUBE');
  fillRowX(L, 2, 4, 0, 2, 'HALF_SLAB');
  // Cabin side walls (thin in X → rot=1)
  place(L, 2, 2, 1, 'WALL', 1);
  place(L, 4, 2, 1, 'WALL', 1);

  // Tall mast with yard arms (span X → rot=1)
  buildMast(L, 3, 5, 5);
  place(L, 3, 3, 5, 'PLANK', 1);
  place(L, 3, 5, 5, 'PLANK', 1);

  // Bowsprit — wedge prow (slope toward +Z → rot=0)
  place(L, 3, 1, 9, 'WEDGE', 0);
  place(L, 3, 1, 10, 'WEDGE', 0);

  // Deck details
  placeMany(L, [
    [2,1,4,'BARREL'], [4,1,4,'BARREL'],
    [3,1,3,'LATTICE'],
  ]);

  return { layout: L, target: { x: 3, y: 1, z: 4 }, cannonPos: { x: 5, z: 5 }, floor: F };
}

function fortressPreset() {
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

  fillHull(L, hullRows, 0, 'CUBE', 'HALF_SLAB', 'z');
  buildKeel(F, hullRows, 1);

  // Heavy perimeter walls (y=1-2)
  // Port/starboard (thin in X → rot=1)
  for (let y = 1; y <= 2; y++) {
    for (let z = 1; z <= 8; z++) {
      place(L, 0, y, z, 'CUBE');
      place(L, 6, y, z, 'CUBE');
    }
    // Bow/stern walls (thin in Z → rot=0)
    fillRowX(L, 1, 5, 0, y, 'CUBE');
    fillRowX(L, 1, 5, 9, y, 'CUBE');
  }

  // Crenellations (y=3)
  for (let z = 1; z <= 8; z++) {
    if (z % 2 === 0) { place(L, 0, 3, z, 'HALF_SLAB'); place(L, 6, 3, z, 'HALF_SLAB'); }
  }
  for (let x = 1; x <= 5; x++) {
    if (x % 2 === 0) { place(L, x, 3, 0, 'HALF_SLAB'); place(L, x, 3, 9, 'HALF_SLAB'); }
  }

  // Watchtower with mast
  place(L, 3, 1, 5, 'CYLINDER');
  place(L, 3, 2, 5, 'CYLINDER');
  place(L, 3, 3, 5, 'LATTICE');
  buildMast(L, 3, 5, 5);
  place(L, 3, 4, 5, 'PLANK', 1); // yard arm spans X

  // Bow wedge reinforcement (slope toward +Z → rot=0)
  placeMany(L, [
    [2,1,10,'WEDGE',0], [3,1,10,'WEDGE',0], [4,1,10,'WEDGE',0],
  ]);

  // Ammunition barrels
  placeMany(L, [
    [1,1,2,'BARREL'], [5,1,2,'BARREL'],
    [1,1,7,'BARREL'], [5,1,7,'BARREL'],
  ]);

  return { layout: L, target: { x: 3, y: 1, z: 3 }, cannonPos: { x: 6, z: 5 }, floor: F };
}
