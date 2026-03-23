export function getSpacePreset(name) {
  switch (name) {
    case 'CORVETTE': return corvettePreset();
    case 'FRIGATE': return frigatePreset();
    case 'CRUISER': return cruiserPreset();
    default: return corvettePreset();
  }
}

// Grid: 7 wide (x=0-6) × 13 deep (z=0-12). Ships broadside.
// x = beam (width, faces opponent). z = keel (length, runs parallel).
// z=0 = stern, z=12 = bow. x=3 = centerline. x=6 = broadside facing enemy.
// Cannon fires from broadside (x=6, z=center).
// floor=[] skips Castle's auto-floor.

function makeHullBottom(rows) {
  const blocks = [];
  const maxZ = Math.max(...rows.map(r => r.z));
  const minZ = Math.min(...rows.map(r => r.z));
  for (const row of rows) {
    const isEnd = row.z === maxZ || row.z === minZ;
    const span = row.xMax - row.xMin;
    for (let x = row.xMin; x <= row.xMax; x++) {
      const isEdge = x === row.xMin || x === row.xMax || isEnd;
      const xCenter = (row.xMin + row.xMax) / 2;
      const xDist = span > 0 ? Math.abs(x - xCenter) / (span / 2) : 1;
      const zDist = (maxZ - minZ) > 0 ? Math.abs(row.z - (minZ + maxZ) / 2) / ((maxZ - minZ) / 2) : 1;
      if (isEdge || Math.max(xDist, zDist) > 0.6) {
        blocks.push({ x, y: 0, z: row.z, type: 'HALF_SLAB', rotation: 0 });
      } else {
        blocks.push({ x, y: 0, z: row.z, type: 'CUBE', rotation: 0 });
      }
    }
  }
  return blocks;
}

function corvettePreset() {
  // CORVETTE — Sleek fighter. Long narrow hull along Z, broadside along X.
  const hullRows = [
    { z: 0,  xMin: 2, xMax: 4 },  // stern
    { z: 1,  xMin: 1, xMax: 5 },  // engine section wider
    { z: 2,  xMin: 2, xMax: 4 },
    { z: 3,  xMin: 2, xMax: 4 },
    { z: 4,  xMin: 2, xMax: 4 },
    { z: 5,  xMin: 2, xMax: 4 },
    { z: 6,  xMin: 2, xMax: 4 },
    { z: 7,  xMin: 2, xMax: 4 },
    { z: 8,  xMin: 2, xMax: 4 },
    { z: 9,  xMin: 2, xMax: 4 },
    { z: 10, xMin: 2, xMax: 4 },
    { z: 11, xMin: 3, xMax: 3 },  // bow tapers
    { z: 12, xMin: 3, xMax: 3 },
  ];
  const layout = makeHullBottom(hullRows);

  // y=1: Main deck
  // Engine section
  layout.push({ x: 1, y: 1, z: 1, type: 'HALF_SLAB', rotation: 0 });
  layout.push({ x: 2, y: 1, z: 1, type: 'CUBE', rotation: 0 });
  layout.push({ x: 3, y: 1, z: 1, type: 'CUBE', rotation: 0 });
  layout.push({ x: 4, y: 1, z: 1, type: 'CUBE', rotation: 0 });
  layout.push({ x: 5, y: 1, z: 1, type: 'HALF_SLAB', rotation: 0 });
  layout.push({ x: 2, y: 1, z: 0, type: 'HALF_SLAB', rotation: 0 });
  layout.push({ x: 3, y: 1, z: 0, type: 'CUBE', rotation: 0 });
  layout.push({ x: 4, y: 1, z: 0, type: 'HALF_SLAB', rotation: 0 });
  // Thrusters at stern (z=0)
  layout.push({ x: 2, y: 1, z: 0, type: 'THRUSTER', rotation: 1 });
  layout.push({ x: 3, y: 1, z: 0, type: 'THRUSTER', rotation: 1 });
  layout.push({ x: 4, y: 1, z: 0, type: 'THRUSTER', rotation: 1 });

  // Fuselage
  for (let z = 2; z <= 10; z++) {
    layout.push({ x: 2, y: 1, z, type: 'RAMP', rotation: 2 }); // port taper
    layout.push({ x: 3, y: 1, z, type: 'CUBE', rotation: 0 });
    layout.push({ x: 4, y: 1, z, type: 'RAMP', rotation: 0 }); // starboard taper
  }
  // Bow
  layout.push({ x: 3, y: 1, z: 11, type: 'CUBE', rotation: 0 });
  layout.push({ x: 3, y: 1, z: 12, type: 'HALF_SLAB', rotation: 0 });

  // y=2: Dorsal
  for (let z = 2; z <= 9; z++) {
    layout.push({ x: 3, y: 2, z, type: 'BULLNOSE', rotation: 0 });
  }
  layout.push({ x: 3, y: 2, z: 10, type: 'HALF_BULLNOSE', rotation: 0 });
  layout.push({ x: 3, y: 2, z: 11, type: 'QUARTER_DOME', rotation: 0 });

  // Wings (wall panels along the length)
  for (let z = 3; z <= 8; z++) {
    layout.push({ x: 1, y: 1, z, type: 'WALL', rotation: 0 });
    layout.push({ x: 5, y: 1, z, type: 'WALL', rotation: 0 });
  }
  // Shield wingtips
  layout.push({ x: 0, y: 1, z: 5, type: 'SHIELD', rotation: 0 });
  layout.push({ x: 0, y: 1, z: 6, type: 'SHIELD', rotation: 0 });
  layout.push({ x: 0, y: 1, z: 7, type: 'SHIELD', rotation: 0 });
  layout.push({ x: 6, y: 1, z: 5, type: 'SHIELD', rotation: 0 });
  layout.push({ x: 6, y: 1, z: 6, type: 'SHIELD', rotation: 0 });
  layout.push({ x: 6, y: 1, z: 7, type: 'SHIELD', rotation: 0 });

  // Tail fin
  layout.push({ x: 3, y: 2, z: 0, type: 'WALL', rotation: 1 });
  layout.push({ x: 3, y: 3, z: 0, type: 'RAMP', rotation: 1 });
  layout.push({ x: 3, y: 2, z: 1, type: 'WALL', rotation: 1 });

  return { layout, target: { x: 3, y: 1, z: 6 }, cannonPos: { x: 6, z: 6 }, floor: [] };
}

function frigatePreset() {
  // FRIGATE — Star Destroyer wedge. Full width at stern, tapers to bow.
  const hullRows = [
    { z: 0,  xMin: 0, xMax: 6 },
    { z: 1,  xMin: 0, xMax: 6 },
    { z: 2,  xMin: 0, xMax: 6 },
    { z: 3,  xMin: 0, xMax: 6 },
    { z: 4,  xMin: 1, xMax: 5 },
    { z: 5,  xMin: 1, xMax: 5 },
    { z: 6,  xMin: 1, xMax: 5 },
    { z: 7,  xMin: 1, xMax: 5 },
    { z: 8,  xMin: 2, xMax: 4 },
    { z: 9,  xMin: 2, xMax: 4 },
    { z: 10, xMin: 2, xMax: 4 },
    { z: 11, xMin: 2, xMax: 4 },
    { z: 12, xMin: 3, xMax: 3 },
  ];
  const layout = makeHullBottom(hullRows);

  // y=1: Main deck
  for (const row of hullRows) {
    for (let x = row.xMin; x <= row.xMax; x++) {
      if (x === row.xMin) layout.push({ x, y: 1, z: row.z, type: 'RAMP', rotation: 2 });
      else if (x === row.xMax) layout.push({ x, y: 1, z: row.z, type: 'RAMP', rotation: 0 });
      else layout.push({ x, y: 1, z: row.z, type: 'CUBE', rotation: 0 });
    }
  }

  // y=2: Upper hull
  const upperRows = [
    { z: 0,  xMin: 1, xMax: 5 },
    { z: 1,  xMin: 1, xMax: 5 },
    { z: 2,  xMin: 1, xMax: 5 },
    { z: 3,  xMin: 1, xMax: 5 },
    { z: 4,  xMin: 2, xMax: 4 },
    { z: 5,  xMin: 2, xMax: 4 },
    { z: 6,  xMin: 2, xMax: 4 },
    { z: 7,  xMin: 2, xMax: 4 },
    { z: 8,  xMin: 3, xMax: 3 },
    { z: 9,  xMin: 3, xMax: 3 },
  ];
  for (const row of upperRows) {
    for (let x = row.xMin; x <= row.xMax; x++) {
      layout.push({ x, y: 2, z: row.z, type: x === 3 ? 'BULLNOSE' : 'HALF_SLAB', rotation: x === 3 ? 0 : 0 });
    }
  }

  // Bridge tower (z=2-3)
  for (let y = 2; y <= 3; y++) {
    for (let z = 2; z <= 3; z++) {
      for (let x = 2; x <= 4; x++) {
        layout.push({ x, y, z, type: 'CUBE', rotation: 0 });
      }
    }
  }
  layout.push({ x: 2, y: 4, z: 2, type: 'RAMP', rotation: 2 });
  layout.push({ x: 3, y: 4, z: 2, type: 'BULLNOSE', rotation: 0 });
  layout.push({ x: 4, y: 4, z: 2, type: 'RAMP', rotation: 0 });
  layout.push({ x: 2, y: 4, z: 3, type: 'RAMP', rotation: 2 });
  layout.push({ x: 3, y: 4, z: 3, type: 'BULLNOSE', rotation: 0 });
  layout.push({ x: 4, y: 4, z: 3, type: 'RAMP', rotation: 0 });
  layout.push({ x: 3, y: 5, z: 2, type: 'HALF_SLAB', rotation: 0 });
  layout.push({ x: 3, y: 5, z: 3, type: 'HALF_SLAB', rotation: 0 });

  // Thrusters (z=0 stern)
  layout.push({ x: 0, y: 1, z: 0, type: 'THRUSTER', rotation: 1 });
  layout.push({ x: 2, y: 1, z: 0, type: 'THRUSTER', rotation: 1 });
  layout.push({ x: 4, y: 1, z: 0, type: 'THRUSTER', rotation: 1 });
  layout.push({ x: 6, y: 1, z: 0, type: 'THRUSTER', rotation: 1 });

  // Shield prow
  layout.push({ x: 2, y: 1, z: 11, type: 'SHIELD', rotation: 0 });
  layout.push({ x: 4, y: 1, z: 11, type: 'SHIELD', rotation: 0 });
  layout.push({ x: 2, y: 1, z: 12, type: 'SHIELD', rotation: 0 });
  layout.push({ x: 4, y: 1, z: 12, type: 'SHIELD', rotation: 0 });

  // Trench guns
  layout.push({ x: 1, y: 2, z: 6, type: 'COLUMN', rotation: 0 });
  layout.push({ x: 5, y: 2, z: 6, type: 'COLUMN', rotation: 0 });

  return { layout, target: { x: 3, y: 1, z: 5 }, cannonPos: { x: 6, z: 6 }, floor: [] };
}

function cruiserPreset() {
  // CRUISER — Mon Cal oval. Elongated along Z, widest at center.
  const hullRows = [
    { z: 0,  xMin: 2, xMax: 4 },
    { z: 1,  xMin: 1, xMax: 5 },
    { z: 2,  xMin: 1, xMax: 5 },
    { z: 3,  xMin: 0, xMax: 6 },
    { z: 4,  xMin: 0, xMax: 6 },
    { z: 5,  xMin: 0, xMax: 6 },
    { z: 6,  xMin: 0, xMax: 6 },
    { z: 7,  xMin: 0, xMax: 6 },
    { z: 8,  xMin: 0, xMax: 6 },
    { z: 9,  xMin: 0, xMax: 6 },
    { z: 10, xMin: 1, xMax: 5 },
    { z: 11, xMin: 1, xMax: 5 },
    { z: 12, xMin: 2, xMax: 4 },
  ];
  const layout = makeHullBottom(hullRows);

  // y=1: Main deck
  for (const row of hullRows) {
    for (let x = row.xMin; x <= row.xMax; x++) {
      if (x === row.xMin) layout.push({ x, y: 1, z: row.z, type: 'RAMP', rotation: 2 });
      else if (x === row.xMax) layout.push({ x, y: 1, z: row.z, type: 'RAMP', rotation: 0 });
      else layout.push({ x, y: 1, z: row.z, type: 'CUBE', rotation: 0 });
    }
  }

  // y=2: Upper hull
  const upperRows = [
    { z: 1,  xMin: 2, xMax: 4 },
    { z: 2,  xMin: 1, xMax: 5 },
    { z: 3,  xMin: 1, xMax: 5 },
    { z: 4,  xMin: 0, xMax: 6 },
    { z: 5,  xMin: 0, xMax: 6 },
    { z: 6,  xMin: 0, xMax: 6 },
    { z: 7,  xMin: 0, xMax: 6 },
    { z: 8,  xMin: 0, xMax: 6 },
    { z: 9,  xMin: 1, xMax: 5 },
    { z: 10, xMin: 1, xMax: 5 },
    { z: 11, xMin: 2, xMax: 4 },
  ];
  for (const row of upperRows) {
    for (let x = row.xMin; x <= row.xMax; x++) {
      layout.push({ x, y: 2, z: row.z, type: x === 3 ? 'BULLNOSE' : 'HALF_SLAB', rotation: 0 });
    }
  }

  // Bridge dome (z=5-7)
  for (let z = 5; z <= 7; z++) {
    for (let x = 2; x <= 4; x++) {
      layout.push({ x, y: 3, z, type: 'HALF_SLAB', rotation: 0 });
    }
  }
  layout.push({ x: 3, y: 3, z: 6, type: 'CUBE', rotation: 0 });
  layout.push({ x: 3, y: 4, z: 6, type: 'BULLNOSE', rotation: 0 });
  layout.push({ x: 2, y: 4, z: 6, type: 'RAMP', rotation: 2 });
  layout.push({ x: 4, y: 4, z: 6, type: 'RAMP', rotation: 0 });
  layout.push({ x: 3, y: 4, z: 5, type: 'RAMP', rotation: 3 });
  layout.push({ x: 3, y: 4, z: 7, type: 'RAMP', rotation: 1 });

  // Bow/stern contours
  layout.push({ x: 2, y: 1, z: 12, type: 'QUARTER_DOME', rotation: 3 });
  layout.push({ x: 4, y: 1, z: 12, type: 'QUARTER_DOME', rotation: 1 });
  layout.push({ x: 2, y: 1, z: 0, type: 'QUARTER_DOME', rotation: 0 });
  layout.push({ x: 4, y: 1, z: 0, type: 'QUARTER_DOME', rotation: 2 });

  // Shield belt
  const shields = [
    { x: 0, z: 3 }, { x: 0, z: 4 }, { x: 0, z: 5 }, { x: 0, z: 6 },
    { x: 0, z: 7 }, { x: 0, z: 8 }, { x: 0, z: 9 },
    { x: 6, z: 3 }, { x: 6, z: 4 }, { x: 6, z: 5 }, { x: 6, z: 6 },
    { x: 6, z: 7 }, { x: 6, z: 8 }, { x: 6, z: 9 },
    { x: 3, z: 12 }, { x: 1, z: 0 }, { x: 5, z: 0 },
  ];
  for (const s of shields) layout.push({ x: s.x, y: 2, z: s.z, type: 'SHIELD', rotation: 1 });

  // Thrusters (stern z=0)
  layout.push({ x: 2, y: 2, z: 0, type: 'THRUSTER', rotation: 1 });
  layout.push({ x: 3, y: 2, z: 0, type: 'THRUSTER', rotation: 1 });
  layout.push({ x: 4, y: 2, z: 0, type: 'THRUSTER', rotation: 1 });
  // Side turrets
  layout.push({ x: 0, y: 2, z: 6, type: 'THRUSTER', rotation: 0 });
  layout.push({ x: 6, y: 2, z: 6, type: 'THRUSTER', rotation: 2 });

  return { layout, target: { x: 3, y: 1, z: 6 }, cannonPos: { x: 6, z: 6 }, floor: [] };
}
