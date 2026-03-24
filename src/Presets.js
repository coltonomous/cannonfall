import { getSpacePreset } from './SpacePresets.js';
import { getPiratePreset } from './PiratePresets.js';
import {
  fillRect, fillRowX, fillRowZ, fillPerimeter, fillPerimeterLayers,
  fillTower, fillCrenellations, place, placeMany, fillHull,
} from './PresetHelpers.js';

export function getPreset(name, mode = 'castle') {
  if (mode === 'space') return getSpacePreset(name);
  if (mode === 'pirate') return getPiratePreset(name);
  switch (name) {
    case 'KEEP': return keepPreset();
    case 'BUNKER': return bunkerPreset();
    case 'TOWER': return towerPreset();
    default: return keepPreset();
  }
}

// 9×9 grid (0-8). cannonPos relative to +X facing.

function keepPreset() {
  // Classic fortress: corner towers, perimeter walls, arched gateways, cross-wall.
  const L = [];

  // Corner towers (2x2, 5 layers)
  for (const [x, z] of [[0, 0], [0, 7], [7, 0], [7, 7]]) fillTower(L, x, z, 0, 4);

  // Rounded battlements on tower tops (y=5)
  placeMany(L, [
    [0,5,1,'HALF_BULLNOSE',0], [0,5,7,'HALF_BULLNOSE',0],
    [0,5,8,'HALF_BULLNOSE',1], [1,5,8,'HALF_BULLNOSE',1],
    [8,5,8,'HALF_BULLNOSE',1], [7,5,8,'HALF_BULLNOSE',1],
    [8,5,1,'HALF_BULLNOSE',2], [8,5,7,'HALF_BULLNOSE',2],
    [8,5,0,'HALF_BULLNOSE',3], [7,5,0,'HALF_BULLNOSE',3],
    [0,5,0,'HALF_BULLNOSE',3], [1,5,0,'HALF_BULLNOSE',3],
  ]);

  // Perimeter walls (4 layers) with gateway openings at x=4 on front/back
  for (let y = 0; y < 4; y++) {
    for (let x = 2; x <= 6; x++) {
      if (x === 4 && y < 3) continue; // gateway
      place(L, x, y, 0, 'CUBE');
      place(L, x, y, 8, 'CUBE');
    }
    fillRowZ(L, 0, 2, 6, y, 'CUBE');
    fillRowZ(L, 8, 2, 6, y, 'CUBE');
  }

  // Gateway tops
  place(L, 4, 3, 0, 'CUBE');
  place(L, 4, 3, 8, 'CUBE');

  // Crenellations (y=4)
  fillCrenellations(L, 2, 6, 0, 0, 4);
  fillCrenellations(L, 2, 6, 8, 8, 4);
  fillCrenellations(L, 0, 0, 2, 6, 4);
  fillCrenellations(L, 8, 8, 2, 6, 4);

  // Interior cross-wall (z=4, y=0-1)
  for (let y = 0; y < 2; y++) fillRowX(L, 1, 7, 4, y, 'WALL', 1);

  return { layout: L, target: { x: 4, y: 0, z: 4 }, cannonPos: { x: 8, z: 4 } };
}

function bunkerPreset() {
  // Low bunker: bullnose walls, full roof, ramp deflectors, skylight.
  const L = [];

  // Bullnose perimeter walls (y=0)
  fillRowX(L, 0, 8, 0, 0, 'BULLNOSE', 1); // front
  fillRowX(L, 0, 8, 8, 0, 'BULLNOSE', 1); // back
  fillRowZ(L, 0, 1, 7, 0, 'BULLNOSE', 0); // left
  fillRowZ(L, 8, 1, 7, 0, 'BULLNOSE', 0); // right

  // Support columns
  placeMany(L, [[2,0,2,'CUBE'], [6,0,2,'CUBE'], [2,0,6,'CUBE'], [6,0,6,'CUBE']]);

  // Full roof (y=1) with skylight hole at center
  for (let x = 0; x < 9; x++)
    for (let z = 0; z < 9; z++)
      if (!(x === 4 && z === 4)) place(L, x, 1, z, 'CUBE');

  // Ramp deflectors (y=2)
  fillRowX(L, 1, 7, 1, 2, 'RAMP', 1); // front
  fillRowX(L, 1, 7, 7, 2, 'RAMP', 3); // back
  fillRowZ(L, 1, 2, 6, 2, 'RAMP', 2); // left
  fillRowZ(L, 7, 2, 6, 2, 'RAMP', 0); // right

  return { layout: L, target: { x: 4, y: 0, z: 4 }, cannonPos: { x: 8, z: 4 } };
}

function towerPreset() {
  // Tall citadel: narrow tower, outer wall ring with arches, elevated target.
  const L = [];

  // Central tower (3x3 perimeter, 6 layers)
  fillPerimeterLayers(L, 3, 5, 3, 5, 0, 5, 'CUBE');

  // Rounded parapet (y=6)
  placeMany(L, [
    [3,6,5,'HALF_BULLNOSE',1], [4,6,5,'HALF_BULLNOSE',1], [5,6,5,'HALF_BULLNOSE',1],
    [3,6,4,'HALF_BULLNOSE',0], [5,6,4,'HALF_BULLNOSE',2],
    [5,6,3,'HALF_BULLNOSE',3], [4,6,3,'HALF_BULLNOSE',3], [3,6,3,'HALF_BULLNOSE',3],
  ]);

  // Tower fill + catwalk
  place(L, 4, 0, 4, 'CUBE');
  place(L, 4, 1, 4, 'CUBE');
  place(L, 4, 3, 4, 'HALF_SLAB');

  // Outer wall ring (3 layers, with arched openings)
  for (let y = 0; y < 3; y++) {
    for (let x = 1; x <= 7; x++) {
      if (x === 4 && y < 2) continue;
      place(L, x, y, 1, 'WALL', 0);
      place(L, x, y, 7, 'WALL', 0);
    }
    for (let z = 2; z <= 6; z++) {
      if (z === 4 && y < 2) continue;
      place(L, 1, y, z, 'WALL', 1);
      place(L, 7, y, z, 'WALL', 1);
    }
  }

  // Gateway tops (y=2)
  placeMany(L, [
    [4,2,1,'CUBE',0], [4,2,7,'CUBE',0],
    [1,2,4,'CUBE',0], [7,2,4,'CUBE',0],
  ]);

  return { layout: L, target: { x: 4, y: 3, z: 4 }, cannonPos: { x: 8, z: 4 } };
}
