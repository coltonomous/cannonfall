/**
 * BlueprintDecoder — Converts a compact continuous parameter vector ("DNA")
 * into a valid castle layout for the Cannonfall training env.
 *
 * The builder agent outputs ~30 floats in [-1, 1]. This decoder maps them
 * to a structurally valid castle that respects grid bounds, budget limits,
 * and support constraints. The mapping is deterministic (same DNA = same
 * castle) and smooth (small DNA changes = small castle changes).
 *
 * Used by the adversarial build-vs-attack training loop.
 */

import { BLOCK_TYPES } from '../../src/constants.js';

// Block types useful for castle building (exclude THRUSTER/SHIELD/mode-specific)
const BUILD_TYPES = ['CUBE', 'HALF_SLAB', 'WALL', 'RAMP', 'COLUMN', 'BULLNOSE', 'HALF_BULLNOSE', 'CYLINDER'];
const NUM_BUILD_TYPES = BUILD_TYPES.length;

/**
 * DNA layout — 32 continuous parameters, all expected in [-1, 1]:
 *
 * [0]  perimeterHeight     — How tall the outer walls are (0–maxLayers)
 * [1]  perimeterThickFront — Extra depth of front wall (toward attacker)
 * [2]  perimeterThickBack  — Extra depth of back wall
 * [3]  perimeterThickSides — Extra depth of side walls
 * [4]  interiorDensity     — Fill ratio of interior cells
 * [5]  interiorHeight      — How many layers of interior fill
 * [6]  roofCoverage        — Fraction of top layer filled (0=none, 1=full)
 * [7]  roofY               — Which layer the roof sits on
 * [8]  towerCount          — Number of tower pillars (0–4)
 * [9]  towerHeight         — How tall towers extend above walls
 * [10] towerSpread         — How far towers are from center (0=tight, 1=corners)
 * [11] targetX             — Target X position (grid coords)
 * [12] targetZ             — Target Z position (grid coords)
 * [13] targetY             — Target Y position (elevated targets)
 * [14] openingFront        — Gap width in front wall (gateway/kill zone)
 * [15] openingBack         — Gap width in back wall
 * [16] openingSides        — Gap width in side walls
 * [17] rampDeflectors      — Ramp layer on top of walls (deflects shots)
 * [18] crenellations       — Alternating top-of-wall blocks
 * [19] asymmetryX          — Left-right asymmetry bias
 * [20] asymmetryZ          — Front-back asymmetry bias
 * [21-28] blockTypeWeights — Softmax preference for each BUILD_TYPE
 * [29] innerWallZ          — Position of internal cross-wall (0=none)
 * [30] innerWallHeight     — Height of internal cross-wall
 * [31] hollowCore          — Remove interior at ground level around target
 */
const DNA_SIZE = 32;

export { DNA_SIZE };

/**
 * Decode a DNA vector into a castle layout.
 *
 * @param {Float32Array|number[]} dna  32 floats in [-1, 1]
 * @param {object} opts
 * @param {number} opts.gridWidth   Grid width (default 9)
 * @param {number} opts.gridDepth   Grid depth (default 9)
 * @param {number} opts.maxLayers   Max build height (default 8)
 * @param {number} opts.budget      Block budget (default 600)
 * @returns {{ layout: object[], target: { x: number, y: number, z: number } }}
 */
export function decodeDNA(dna, opts = {}) {
  const gw = opts.gridWidth || 9;
  const gd = opts.gridDepth || 9;
  const maxLayers = opts.maxLayers || 8;
  const budget = opts.budget || 600;

  // Remap [-1,1] → [0,1] for convenience
  const p = dna.map(v => (Math.max(-1, Math.min(1, v)) + 1) / 2);

  // Parse DNA parameters
  const perimH      = Math.round(p[0] * maxLayers);
  const thickFront  = Math.round(p[1] * 3);
  const thickBack   = Math.round(p[2] * 3);
  const thickSides  = Math.round(p[3] * 3);
  const intDensity  = p[4];
  const intHeight   = Math.max(1, Math.round(p[5] * maxLayers));
  const roofCov     = p[6];
  const roofY       = Math.max(1, Math.round(p[7] * (maxLayers - 1)));
  const towerCount  = Math.round(p[8] * 4);
  const towerExtra  = Math.round(p[9] * 3);
  const towerSpread = p[10];
  const targetX     = 1 + Math.round(p[11] * (gw - 3));
  const targetZ     = 1 + Math.round(p[12] * (gd - 3));
  const targetY     = Math.round(p[13] * 3);
  const openFront   = Math.round(p[14] * 3);
  const openBack    = Math.round(p[15] * 3);
  const openSides   = Math.round(p[16] * 3);
  const useRamps    = p[17] > 0.5;
  const useCrenels  = p[18] > 0.5;
  const asymX       = (p[19] - 0.5) * 2; // [-1, 1]
  const asymZ       = (p[20] - 0.5) * 2;

  // Block type weights (softmax over 8 types)
  const rawWeights = [];
  for (let i = 0; i < NUM_BUILD_TYPES; i++) {
    rawWeights.push(dna[21 + i] * 2); // scale for sharper softmax
  }
  const maxW = Math.max(...rawWeights);
  const expW = rawWeights.map(w => Math.exp(w - maxW));
  const sumW = expW.reduce((a, b) => a + b, 0);
  const typeProbs = expW.map(w => w / sumW);

  const innerWallZ  = p[29] < 0.2 ? -1 : 1 + Math.round(p[29] * (gd - 3));
  const innerWallH  = Math.max(1, Math.round(p[30] * (maxLayers / 2)));
  const hollowCore  = p[31] > 0.5;

  // Occupancy grid: [y][x][z] = block type or null
  const grid = [];
  for (let y = 0; y < maxLayers; y++) {
    grid[y] = [];
    for (let x = 0; x < gw; x++) {
      grid[y][x] = new Array(gd).fill(null);
    }
  }

  // Helper: pick block type from weighted distribution
  function pickType(seed) {
    let acc = 0;
    for (let i = 0; i < NUM_BUILD_TYPES; i++) {
      acc += typeProbs[i];
      if (seed < acc) return BUILD_TYPES[i];
    }
    return BUILD_TYPES[NUM_BUILD_TYPES - 1];
  }

  // Seeded random for determinism within a DNA (using simple LCG)
  let _seed = Math.abs(Math.round(dna[0] * 10000 + dna[1] * 1000 + dna[2] * 100)) || 1;
  function rand() {
    _seed = (_seed * 1664525 + 1013904223) & 0x7fffffff;
    return _seed / 0x7fffffff;
  }

  // Asymmetry: bias placement probability based on position
  function asymmetryBias(x, z) {
    const cx = (x / (gw - 1)) * 2 - 1; // [-1, 1]
    const cz = (z / (gd - 1)) * 2 - 1;
    return 1 + asymX * cx * 0.3 + asymZ * cz * 0.3;
  }

  // --- Phase 1: Perimeter walls ---
  for (let y = 0; y < perimH; y++) {
    const centerX = Math.floor(gw / 2);
    const centerZ = Math.floor(gd / 2);

    // Front wall (z=0 side, toward attacker)
    for (let d = 0; d <= thickFront; d++) {
      if (d >= gd) break;
      for (let x = 0; x < gw; x++) {
        // Opening in center of wall
        if (d === 0 && Math.abs(x - centerX) <= Math.floor(openFront / 2) && y < perimH - 1) continue;
        grid[y][x][d] = 'CUBE';
      }
    }

    // Back wall
    for (let d = 0; d <= thickBack; d++) {
      const z = gd - 1 - d;
      if (z < 0) break;
      for (let x = 0; x < gw; x++) {
        if (d === 0 && Math.abs(x - centerX) <= Math.floor(openBack / 2) && y < perimH - 1) continue;
        if (grid[y][x][z] === null) grid[y][x][z] = 'CUBE';
      }
    }

    // Side walls
    for (let d = 0; d <= thickSides; d++) {
      for (let z = 0; z < gd; z++) {
        if (d === 0 && Math.abs(z - centerZ) <= Math.floor(openSides / 2) && y < perimH - 1) continue;
        if (d < gw && grid[y][d][z] === null) grid[y][d][z] = 'CUBE';
        const rx = gw - 1 - d;
        if (rx >= 0 && grid[y][rx][z] === null) grid[y][rx][z] = 'CUBE';
      }
    }
  }

  // --- Phase 2: Towers ---
  if (towerCount > 0) {
    const towerH = perimH + towerExtra;
    const inset = Math.round((1 - towerSpread) * Math.floor(gw / 3));
    const positions = [
      [inset, inset],
      [inset, gd - 1 - inset],
      [gw - 1 - inset, inset],
      [gw - 1 - inset, gd - 1 - inset],
    ];
    for (let t = 0; t < Math.min(towerCount, 4); t++) {
      const [tx, tz] = positions[t];
      for (let y = 0; y < towerH && y < maxLayers; y++) {
        // 2x2 footprint
        for (let dx = 0; dx <= 1; dx++) {
          for (let dz = 0; dz <= 1; dz++) {
            const bx = Math.min(tx + dx, gw - 1);
            const bz = Math.min(tz + dz, gd - 1);
            grid[y][bx][bz] = 'CUBE';
          }
        }
      }
    }
  }

  // --- Phase 3: Interior fill ---
  for (let y = 0; y < intHeight && y < maxLayers; y++) {
    for (let x = 1; x < gw - 1; x++) {
      for (let z = 1; z < gd - 1; z++) {
        if (grid[y][x][z] !== null) continue;
        const bias = asymmetryBias(x, z);
        if (rand() < intDensity * bias) {
          grid[y][x][z] = pickType(rand());
        }
      }
    }
  }

  // --- Phase 4: Hollow core around target ---
  if (hollowCore) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cx = targetX + dx;
        const cz = targetZ + dz;
        if (cx >= 0 && cx < gw && cz >= 0 && cz < gd) {
          for (let y = 0; y <= targetY; y++) {
            grid[y][cx][cz] = null;
          }
        }
      }
    }
  }

  // --- Phase 5: Internal cross-wall ---
  if (innerWallZ >= 0 && innerWallZ < gd) {
    for (let y = 0; y < innerWallH && y < maxLayers; y++) {
      for (let x = 0; x < gw; x++) {
        if (x === targetX && innerWallZ === targetZ) continue;
        if (grid[y][x][innerWallZ] === null) {
          grid[y][x][innerWallZ] = 'WALL';
        }
      }
    }
  }

  // --- Phase 6: Roof ---
  if (roofCov > 0 && roofY < maxLayers) {
    for (let x = 0; x < gw; x++) {
      for (let z = 0; z < gd; z++) {
        if (x === targetX && z === targetZ) continue;
        if (rand() < roofCov) {
          grid[roofY][x][z] = grid[roofY][x][z] || 'HALF_SLAB';
        }
      }
    }
  }

  // --- Phase 7: Ramp deflectors ---
  if (useRamps && perimH > 0 && perimH < maxLayers) {
    const rampY = perimH;
    for (let x = 1; x < gw - 1; x++) {
      if (grid[rampY - 1][x][0] !== null) grid[rampY][x][0] = 'RAMP';
      if (grid[rampY - 1][x][gd - 1] !== null) grid[rampY][x][gd - 1] = 'RAMP';
    }
    for (let z = 1; z < gd - 1; z++) {
      if (grid[rampY - 1][0][z] !== null) grid[rampY][0][z] = 'RAMP';
      if (grid[rampY - 1][gw - 1][z] !== null) grid[rampY][gw - 1][z] = 'RAMP';
    }
  }

  // --- Phase 8: Crenellations ---
  if (useCrenels && perimH > 0 && perimH < maxLayers) {
    const cY = perimH;
    for (let x = 0; x < gw; x++) {
      if ((x % 2 === 0) && grid[cY - 1][x][0] !== null) grid[cY][x][0] = 'HALF_SLAB';
      if ((x % 2 === 0) && grid[cY - 1][x][gd - 1] !== null) grid[cY][x][gd - 1] = 'HALF_SLAB';
    }
    for (let z = 0; z < gd; z++) {
      if ((z % 2 === 0) && grid[cY - 1][0][z] !== null) grid[cY][0][z] = 'HALF_SLAB';
      if ((z % 2 === 0) && grid[cY - 1][gw - 1][z] !== null) grid[cY][gw - 1][z] = 'HALF_SLAB';
    }
  }

  // --- Validation pass ---

  // Clear target column
  for (let y = 0; y < maxLayers; y++) {
    grid[y][targetX][targetZ] = null;
  }

  // Budget pass: remove blocks over budget, then fix support
  let spent = 0;
  for (let y = 0; y < maxLayers; y++) {
    for (let x = 0; x < gw; x++) {
      for (let z = 0; z < gd; z++) {
        const type = grid[y][x][z];
        if (type === null) continue;
        const cost = BLOCK_TYPES[type]?.cost || 3;
        if (spent + cost > budget) {
          // Over budget — clear this cell and everything above it
          for (let clearY = y; clearY < maxLayers; clearY++) {
            grid[clearY][x][z] = null;
          }
        } else {
          spent += cost;
        }
      }
    }
  }

  // Final support validation after budget cuts (repeat until stable)
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 1; y < maxLayers; y++) {
      for (let x = 0; x < gw; x++) {
        for (let z = 0; z < gd; z++) {
          if (grid[y][x][z] !== null && grid[y - 1][x][z] === null) {
            grid[y][x][z] = null;
            changed = true;
          }
        }
      }
    }
  }

  // Convert grid to layout array
  const layout = [];
  for (let y = 0; y < maxLayers; y++) {
    for (let x = 0; x < gw; x++) {
      for (let z = 0; z < gd; z++) {
        if (grid[y][x][z] === null) continue;
        layout.push({ x, y, z, type: grid[y][x][z], rotation: 0 });
      }
    }
  }

  // Ensure target has support if elevated
  let finalTargetY = targetY;
  if (targetY > 0) {
    let supported = true;
    for (let y = 0; y < targetY; y++) {
      if (!layout.some(b => b.x === targetX && b.z === targetZ && b.y === y)) {
        supported = false;
        break;
      }
    }
    if (!supported) finalTargetY = 0;
  }

  return {
    layout,
    target: { x: targetX, y: finalTargetY, z: targetZ },
  };
}

/**
 * Encode a preset layout back into approximate DNA (for seeding the builder pool).
 * This is lossy — the DNA representation can't capture every detail of a hand-built
 * castle, but it produces a reasonable approximation for initializing training.
 *
 * @param {{ layout: object[], target: { x: number, y: number, z: number } }} castleData
 * @param {object} opts
 * @returns {Float32Array} DNA vector of size DNA_SIZE, values in [-1, 1]
 */
export function encodeToDNA(castleData, opts = {}) {
  const gw = opts.gridWidth || 9;
  const gd = opts.gridDepth || 9;
  const maxLayers = opts.maxLayers || 8;
  const layout = castleData.layout;
  const target = castleData.target;

  const dna = new Float32Array(DNA_SIZE);

  // Analyze the layout
  let maxY = 0;
  let perimCount = 0;
  let interiorCount = 0;
  let totalBlocks = layout.length;
  const typeCounts = {};

  for (const b of layout) {
    if (b.y > maxY) maxY = b.y;
    const isPerim = b.x === 0 || b.x === gw - 1 || b.z === 0 || b.z === gd - 1;
    if (isPerim) perimCount++;
    else interiorCount++;
    typeCounts[b.type] = (typeCounts[b.type] || 0) + 1;
  }

  const interiorCells = (gw - 2) * (gd - 2) * (maxY + 1);

  // [0] perimeterHeight — estimate from max perimeter block height
  const perimBlocks = layout.filter(b => b.x === 0 || b.x === gw - 1 || b.z === 0 || b.z === gd - 1);
  const perimMaxY = perimBlocks.length > 0 ? Math.max(...perimBlocks.map(b => b.y)) + 1 : 0;
  dna[0] = (perimMaxY / maxLayers) * 2 - 1;

  // [1-3] thickness — rough estimate (always 0 for simple analysis)
  dna[1] = -1; dna[2] = -1; dna[3] = -1;

  // [4] interiorDensity
  dna[4] = (interiorCells > 0 ? interiorCount / interiorCells : 0) * 2 - 1;

  // [5] interiorHeight
  dna[5] = ((maxY + 1) / maxLayers) * 2 - 1;

  // [6-7] roof — detect if there's a dense layer above walls
  dna[6] = -1; dna[7] = -1;

  // [8-10] towers — detect 2x2 columns
  dna[8] = -1; dna[9] = -1; dna[10] = 1; // default: no towers, spread=max

  // [11-13] target position
  dna[11] = ((target.x - 1) / (gw - 3)) * 2 - 1;
  dna[12] = ((target.z - 1) / (gd - 3)) * 2 - 1;
  dna[13] = (target.y / 3) * 2 - 1;

  // [14-16] openings — default small
  dna[14] = -0.5; dna[15] = -0.5; dna[16] = -0.5;

  // [17-18] ramp/crenellations — detect from layout
  const hasRamps = layout.some(b => b.type === 'RAMP');
  dna[17] = hasRamps ? 0.5 : -0.5;
  dna[18] = -0.5;

  // [19-20] asymmetry
  dna[19] = 0; dna[20] = 0;

  // [21-28] block type weights (clamped to [-1, 1])
  for (let i = 0; i < NUM_BUILD_TYPES; i++) {
    const count = typeCounts[BUILD_TYPES[i]] || 0;
    dna[21 + i] = Math.max(-1, Math.min(1,
      totalBlocks > 0 ? (count / totalBlocks) * 2 - 0.5 : -0.5
    ));
  }

  // [29-30] inner wall
  dna[29] = -1; dna[30] = -1;

  // [31] hollow core — detect if target area is clear
  const nearTarget = layout.filter(b =>
    Math.abs(b.x - target.x) <= 1 && Math.abs(b.z - target.z) <= 1 && b.y <= target.y
  );
  dna[31] = nearTarget.length < 3 ? 0.5 : -0.5;

  return dna;
}
