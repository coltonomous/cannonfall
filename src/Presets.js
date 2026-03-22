export function getPreset(name) {
  switch (name) {
    case 'KEEP': return keepPreset();
    case 'BUNKER': return bunkerPreset();
    case 'TOWER': return towerPreset();
    default: return keepPreset();
  }
}

// W = 9, D = 9 grid (coords 0-8)
// cannonPos.x is relative to +X facing (Player 0's front side = high x).
// Game.js mirrors it for Player 1.

function keepPreset() {
  // CLASSIC FORTRESS — tall single-thick walls with corner towers.
  // Strategic identity: maximum height coverage. Hard to lob over.
  // A direct hit punches through the single wall, but the tall profile
  // means the attacker must aim precisely — too high and it sails over,
  // too low and it hits the wall harmlessly above the target.
  const layout = [];

  // Corner towers: 2x2 pillars, 5 layers tall
  const corners = [[0, 0], [0, 7], [7, 0], [7, 7]];
  for (const [cx, cz] of corners) {
    for (let y = 0; y < 5; y++) {
      for (let dx = 0; dx <= 1; dx++) {
        for (let dz = 0; dz <= 1; dz++) {
          layout.push({ x: cx + dx, y, z: cz + dz, type: 'CUBE', rotation: 0 });
        }
      }
    }
  }

  // Perimeter walls connecting towers, 4 layers tall
  for (let y = 0; y < 4; y++) {
    for (let x = 2; x <= 6; x++) {
      layout.push({ x, y, z: 0, type: 'CUBE', rotation: 0 });
      layout.push({ x, y, z: 8, type: 'CUBE', rotation: 0 });
    }
    for (let z = 2; z <= 6; z++) {
      layout.push({ x: 0, y, z, type: 'CUBE', rotation: 0 });
      layout.push({ x: 8, y, z, type: 'CUBE', rotation: 0 });
    }
  }

  // Crenellations on top (layer 4, every other block)
  for (let x = 2; x <= 6; x += 2) {
    layout.push({ x, y: 4, z: 0, type: 'CUBE', rotation: 0 });
    layout.push({ x, y: 4, z: 8, type: 'CUBE', rotation: 0 });
  }
  for (let z = 2; z <= 6; z += 2) {
    layout.push({ x: 0, y: 4, z, type: 'CUBE', rotation: 0 });
    layout.push({ x: 8, y: 4, z, type: 'CUBE', rotation: 0 });
  }

  // Interior cross-wall for extra protection (single thickness at z=4)
  for (let y = 0; y < 2; y++) {
    for (let x = 1; x <= 7; x++) {
      layout.push({ x, y, z: 4, type: 'WALL', rotation: 1 });
    }
  }

  // Cannon on outermost front wall (x=8 is the +X edge, barrel clears into open air)
  return { layout, target: { x: 4, y: 0, z: 4 }, cannonPos: { x: 8, z: 4 } };
}

function bunkerPreset() {
  // LOW BUNKER — full roof with ramp deflection armor.
  // Strategic identity: roof blocks lob shots. Must shoot flat to breach walls.
  // But walls are thin — a well-aimed direct shot punches right through.
  // The tradeoff: protected from above, vulnerable from the sides.
  const layout = [];

  // Perimeter walls (1 layer, single thickness)
  for (let x = 0; x < 9; x++) {
    for (let z = 0; z < 9; z++) {
      if (x === 0 || x === 8 || z === 0 || z === 8) {
        layout.push({ x, y: 0, z, type: 'CUBE', rotation: 0 });
      }
    }
  }

  // Interior support columns
  layout.push({ x: 2, y: 0, z: 2, type: 'CUBE', rotation: 0 });
  layout.push({ x: 6, y: 0, z: 2, type: 'CUBE', rotation: 0 });
  layout.push({ x: 2, y: 0, z: 6, type: 'CUBE', rotation: 0 });
  layout.push({ x: 6, y: 0, z: 6, type: 'CUBE', rotation: 0 });
  layout.push({ x: 4, y: 0, z: 4, type: 'CUBE', rotation: 0 });

  // Full cube roof at y=1, with a hole at center for target visibility + weak point
  for (let x = 0; x < 9; x++) {
    for (let z = 0; z < 9; z++) {
      if (x === 4 && z === 4) continue; // skylight hole
      layout.push({ x, y: 1, z, type: 'CUBE', rotation: 0 });
    }
  }

  // Ramp deflection armor on roof edges (y=2) — slopes outward
  // Front edge (z low) — slope outward
  for (let x = 1; x < 8; x++) {
    layout.push({ x, y: 2, z: 1, type: 'RAMP', rotation: 1 });
  }
  // Back edge (z high)
  for (let x = 1; x < 8; x++) {
    layout.push({ x, y: 2, z: 7, type: 'RAMP', rotation: 3 });
  }
  // Left edge (x low)
  for (let z = 2; z < 7; z++) {
    layout.push({ x: 1, y: 2, z, type: 'RAMP', rotation: 2 });
  }
  // Right edge (x high)
  for (let z = 2; z < 7; z++) {
    layout.push({ x: 7, y: 2, z, type: 'RAMP', rotation: 0 });
  }

  // Cannon on outermost front edge (on roof)
  return { layout, target: { x: 4, y: 0, z: 4 }, cannonPos: { x: 8, z: 4 } };
}

function towerPreset() {
  // TALL CITADEL — small footprint, very tall. Target elevated.
  // Strategic identity: tiny profile, hard to hit at all. Target is high up,
  // requiring a precise arc. But once the walls are breached, it crumbles fast.
  const layout = [];

  // Central tower: 3x3 (coords 3-5), 6 layers tall
  for (let y = 0; y < 6; y++) {
    for (let x = 3; x <= 5; x++) {
      for (let z = 3; z <= 5; z++) {
        if (x === 3 || x === 5 || z === 3 || z === 5) {
          layout.push({ x, y, z, type: 'CUBE', rotation: 0 });
        }
      }
    }
  }

  // Fill tower base for solidity
  for (let y = 0; y < 2; y++) {
    layout.push({ x: 4, y, z: 4, type: 'CUBE', rotation: 0 });
  }

  // Interior catwalk at y=3 for target
  layout.push({ x: 4, y: 3, z: 4, type: 'HALF_SLAB', rotation: 0 });

  // Outer defensive ring: thin walls (3 layers) — ablative armor
  for (let y = 0; y < 3; y++) {
    for (let x = 1; x <= 7; x++) {
      layout.push({ x, y, z: 1, type: 'WALL', rotation: 1 });
      layout.push({ x, y, z: 7, type: 'WALL', rotation: 1 });
    }
    for (let z = 2; z <= 6; z++) {
      layout.push({ x: 1, y, z, type: 'WALL', rotation: 0 });
      layout.push({ x: 7, y, z, type: 'WALL', rotation: 0 });
    }
  }

  // Cannon on the tower's front face
  return { layout, target: { x: 4, y: 3, z: 4 }, cannonPos: { x: 5, z: 4 } };
}
