import {
  fillRowX, fillRowZ, fillHull, fillTaperedDeck,
  place, placeMany,
} from './PresetHelpers.js';

export function getSpacePreset(name) {
  switch (name) {
    case 'CORVETTE': return corvettePreset();
    case 'FRIGATE': return frigatePreset();
    case 'CRUISER': return cruiserPreset();
    default: return corvettePreset();
  }
}

// 7×13 grid (x=0-6, z=0-12). Broadside combat.
// x = beam (faces opponent), z = keel (ship length). z=0 stern, z=12 bow.

const HULL_Z = [
  { z: 0,  xMin: 2, xMax: 4 },
  { z: 1,  xMin: 1, xMax: 5 },
  { z: 2,  xMin: 2, xMax: 4 },
];

function corvettePreset() {
  // Sleek fighter: narrow spine, swept wings, big engines, cockpit dome.
  const hullRows = [
    { z: 0,  xMin: 2, xMax: 4 },
    { z: 1,  xMin: 1, xMax: 5 },
    ...Array.from({ length: 9 }, (_, i) => ({ z: i + 2, xMin: 2, xMax: 4 })),
    { z: 11, xMin: 3, xMax: 3 },
    { z: 12, xMin: 3, xMax: 3 },
  ];
  const L = [];
  fillHull(L, hullRows, 0, 'CUBE', 'HALF_SLAB', 'z');

  // y=1: Engine section
  fillRowX(L, 1, 5, 1, 1, 'HALF_SLAB');
  fillRowX(L, 2, 4, 0, 1, 'HALF_SLAB');
  placeMany(L, [[2,1,0,'THRUSTER',1], [3,1,0,'THRUSTER',1], [4,1,0,'THRUSTER',1]]);
  place(L, 3, 1, 1, 'CUBE');

  // Fuselage spine (y=1)
  for (let z = 2; z <= 10; z++) placeMany(L, [[2,1,z,'RAMP',2], [3,1,z,'CUBE'], [4,1,z,'RAMP',0]]);
  placeMany(L, [[3,1,11,'CUBE'], [3,1,12,'HALF_SLAB']]);

  // y=2: Dorsal ridge
  for (let z = 2; z <= 9; z++) place(L, 3, 2, z, 'BULLNOSE', 0);
  placeMany(L, [[3,2,10,'HALF_BULLNOSE',0], [3,2,11,'QUARTER_DOME',0]]);

  // Wings
  for (let z = 3; z <= 8; z++) { place(L, 1, 1, z, 'WALL', 0); place(L, 5, 1, z, 'WALL', 0); }
  placeMany(L, [
    [0,1,5,'SHIELD',0], [0,1,6,'SHIELD',0], [0,1,7,'SHIELD',0],
    [6,1,5,'SHIELD',0], [6,1,6,'SHIELD',0], [6,1,7,'SHIELD',0],
  ]);

  // Tail fin
  placeMany(L, [[3,2,0,'WALL',1], [3,3,0,'RAMP',1], [3,2,1,'WALL',1]]);

  return { layout: L, target: { x: 3, y: 1, z: 6 }, cannonPos: { x: 6, z: 6 }, floor: [] };
}

function frigatePreset() {
  // Star Destroyer wedge: full width at stern, tapers to bow point.
  const hullRows = [
    ...Array.from({ length: 4 }, (_, i) => ({ z: i, xMin: 0, xMax: 6 })),
    ...Array.from({ length: 4 }, (_, i) => ({ z: i + 4, xMin: 1, xMax: 5 })),
    ...Array.from({ length: 4 }, (_, i) => ({ z: i + 8, xMin: 2, xMax: 4 })),
    { z: 12, xMin: 3, xMax: 3 },
  ];
  const L = [];
  fillHull(L, hullRows, 0, 'CUBE', 'HALF_SLAB', 'z');

  // y=1: Main deck with ramp edges
  fillTaperedDeck(L, hullRows, 1, 'z');
  place(L, 3, 1, 12, 'HALF_SLAB');

  // y=2: Upper hull + dorsal ridge
  const upper = [
    ...Array.from({ length: 4 }, (_, i) => ({ z: i, xMin: 1, xMax: 5 })),
    ...Array.from({ length: 4 }, (_, i) => ({ z: i + 4, xMin: 2, xMax: 4 })),
    { z: 8, xMin: 3, xMax: 3 }, { z: 9, xMin: 3, xMax: 3 },
  ];
  for (const r of upper)
    for (let x = r.xMin; x <= r.xMax; x++)
      place(L, x, 2, r.z, x === 3 ? 'BULLNOSE' : 'HALF_SLAB', 0);

  // Bridge tower (z=2-3, y=2-3)
  for (let y = 2; y <= 3; y++) for (let z = 2; z <= 3; z++) fillRowX(L, 2, 4, z, y, 'CUBE');
  placeMany(L, [
    [2,4,2,'RAMP',2], [3,4,2,'BULLNOSE',0], [4,4,2,'RAMP',0],
    [2,4,3,'RAMP',2], [3,4,3,'BULLNOSE',0], [4,4,3,'RAMP',0],
    [3,5,2,'HALF_SLAB'], [3,5,3,'HALF_SLAB'],
  ]);

  // Thrusters + details
  placeMany(L, [
    [0,1,0,'THRUSTER',1], [2,1,0,'THRUSTER',1], [4,1,0,'THRUSTER',1], [6,1,0,'THRUSTER',1],
    [1,2,6,'COLUMN'], [5,2,6,'COLUMN'],
    [2,1,11,'SHIELD',0], [4,1,11,'SHIELD',0], [2,1,12,'SHIELD',0], [4,1,12,'SHIELD',0],
  ]);

  return { layout: L, target: { x: 3, y: 1, z: 5 }, cannonPos: { x: 6, z: 6 }, floor: [] };
}

function cruiserPreset() {
  // Mon Cal oval: elongated along Z, widest at center, shield belt.
  const hullRows = [
    { z: 0,  xMin: 2, xMax: 4 },
    { z: 1,  xMin: 1, xMax: 5 }, { z: 2, xMin: 1, xMax: 5 },
    ...Array.from({ length: 7 }, (_, i) => ({ z: i + 3, xMin: 0, xMax: 6 })),
    { z: 10, xMin: 1, xMax: 5 }, { z: 11, xMin: 1, xMax: 5 },
    { z: 12, xMin: 2, xMax: 4 },
  ];
  const L = [];
  fillHull(L, hullRows, 0, 'CUBE', 'HALF_SLAB', 'z');

  // y=1: Main deck
  fillTaperedDeck(L, hullRows, 1, 'z');

  // y=2: Upper hull + dorsal ridge
  const upper = [
    { z: 1, xMin: 2, xMax: 4 },
    { z: 2, xMin: 1, xMax: 5 }, { z: 3, xMin: 1, xMax: 5 },
    ...Array.from({ length: 5 }, (_, i) => ({ z: i + 4, xMin: 0, xMax: 6 })),
    { z: 9, xMin: 1, xMax: 5 }, { z: 10, xMin: 1, xMax: 5 },
    { z: 11, xMin: 2, xMax: 4 },
  ];
  for (const r of upper)
    for (let x = r.xMin; x <= r.xMax; x++)
      place(L, x, 2, r.z, x === 3 ? 'BULLNOSE' : 'HALF_SLAB', 0);

  // Bridge dome (z=5-7)
  for (let z = 5; z <= 7; z++) fillRowX(L, 2, 4, z, 3, 'HALF_SLAB');
  placeMany(L, [
    [3,3,6,'CUBE'], [3,4,6,'BULLNOSE',0],
    [2,4,6,'RAMP',2], [4,4,6,'RAMP',0], [3,4,5,'RAMP',3], [3,4,7,'RAMP',1],
  ]);

  // Bow/stern contours
  placeMany(L, [
    [2,1,12,'QUARTER_DOME',3], [4,1,12,'QUARTER_DOME',1],
    [2,1,0,'QUARTER_DOME',0], [4,1,0,'QUARTER_DOME',2],
  ]);

  // Shield belt (y=2)
  for (let z = 3; z <= 9; z++) { place(L, 0, 2, z, 'SHIELD', 1); place(L, 6, 2, z, 'SHIELD', 1); }
  placeMany(L, [[3,2,12,'SHIELD',1], [1,2,0,'SHIELD',1], [5,2,0,'SHIELD',1]]);

  // Thrusters + turrets
  placeMany(L, [
    [2,2,0,'THRUSTER',1], [3,2,0,'THRUSTER',1], [4,2,0,'THRUSTER',1],
    [0,2,6,'THRUSTER',0], [6,2,6,'THRUSTER',2],
  ]);

  return { layout: L, target: { x: 3, y: 1, z: 6 }, cannonPos: { x: 6, z: 6 }, floor: [] };
}
