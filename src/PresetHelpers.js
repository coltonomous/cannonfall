// Declarative helpers for building block layouts.
// All functions push blocks into a provided array and return it for chaining.

/** Fill a rectangular region with a single block type. */
export function fillRect(out, xMin, xMax, zMin, zMax, y, type, rotation = 0) {
  for (let x = xMin; x <= xMax; x++)
    for (let z = zMin; z <= zMax; z++)
      out.push({ x, y, z, type, rotation });
}

/** Fill a single row (constant z) along X. */
export function fillRowX(out, xMin, xMax, z, y, type, rotation = 0) {
  for (let x = xMin; x <= xMax; x++) out.push({ x, y, z, type, rotation });
}

/** Fill a single row (constant x) along Z. */
export function fillRowZ(out, x, zMin, zMax, y, type, rotation = 0) {
  for (let z = zMin; z <= zMax; z++) out.push({ x, y, z, type, rotation });
}

/** Fill a perimeter ring (edges only) of a rectangle. */
export function fillPerimeter(out, xMin, xMax, zMin, zMax, y, type, rotation = 0) {
  for (let x = xMin; x <= xMax; x++) {
    for (let z = zMin; z <= zMax; z++) {
      if (x === xMin || x === xMax || z === zMin || z === zMax) {
        out.push({ x, y, z, type, rotation });
      }
    }
  }
}

/** Fill perimeter for multiple Y layers. */
export function fillPerimeterLayers(out, xMin, xMax, zMin, zMax, yMin, yMax, type, rotation = 0) {
  for (let y = yMin; y <= yMax; y++) fillPerimeter(out, xMin, xMax, zMin, zMax, y, type, rotation);
}

/** Fill a 2x2 column (tower) for multiple Y layers. */
export function fillTower(out, x, z, yMin, yMax, type = 'CUBE', rotation = 0) {
  for (let y = yMin; y <= yMax; y++) {
    out.push({ x, y, z, type, rotation });
    out.push({ x: x + 1, y, z, type, rotation });
    out.push({ x, y, z: z + 1, type, rotation });
    out.push({ x: x + 1, y, z: z + 1, type, rotation });
  }
}

/** Place blocks at every-other position along a perimeter (crenellations). */
export function fillCrenellations(out, xMin, xMax, zMin, zMax, y, type = 'CUBE') {
  for (let x = xMin; x <= xMax; x++) {
    for (let z = zMin; z <= zMax; z++) {
      if (x === xMin || x === xMax || z === zMin || z === zMax) {
        if ((x + z) % 2 === 0) out.push({ x, y, z, type, rotation: 0 });
      }
    }
  }
}

/** Place a single block. */
export function place(out, x, y, z, type, rotation = 0) {
  out.push({ x, y, z, type, rotation });
}

/** Place multiple blocks from a compact array of [x, y, z, type, rotation?]. */
export function placeMany(out, blocks) {
  for (const b of blocks) {
    out.push({ x: b[0], y: b[1], z: b[2], type: b[3], rotation: b[4] || 0 });
  }
}

/**
 * Build a shaped hull from row definitions.
 * Rows: [{ z, xMin, xMax }] or [{ x, zMin, zMax }] depending on orientation.
 * Edge blocks use inverted ramps sloping outward; interior uses fillType.
 * Set edgeType to override edge block type (e.g. 'CUBE' for flat edges).
 */
export function fillHull(out, rows, y, fillType = 'CUBE', edgeType = 'RAMP', axis = 'x') {
  const maxKey = Math.max(...rows.map(r => axis === 'x' ? r.x : r.z));
  const minKey = Math.min(...rows.map(r => axis === 'x' ? r.x : r.z));

  // Build a lookup of row spans for neighbor checking
  const rowMap = new Map();
  for (const row of rows) {
    const key = axis === 'x' ? row.x : row.z;
    const min = axis === 'x' ? row.zMin : row.xMin;
    const max = axis === 'x' ? row.zMax : row.xMax;
    rowMap.set(key, { min, max });
  }

  for (const row of rows) {
    const key = axis === 'x' ? row.x : row.z;
    const min = axis === 'x' ? row.zMin : row.xMin;
    const max = axis === 'x' ? row.zMax : row.xMax;
    const span = max - min;

    // Check if this row is narrower than its neighbors (meaning it's a tapering end)
    const prevRow = rowMap.get(key - 1);
    const nextRow = rowMap.get(key + 1);
    const isStartEnd = !prevRow || (prevRow && prevRow.min > min) || (prevRow && prevRow.max < max);
    const isEndEnd = !nextRow || (nextRow && nextRow.min > min) || (nextRow && nextRow.max < max);

    for (let v = min; v <= max; v++) {
      const atMinV = v === min;
      const atMaxV = v === max;
      const atMinKey = key === minKey;
      const atMaxKey = key === maxKey;

      const isEdge = atMinV || atMaxV || atMinKey || atMaxKey;

      if (!isEdge) {
        // Interior block
        const center = (min + max) / 2;
        const dist = span > 0 ? Math.abs(v - center) / (span / 2) : 1;
        const keyDist = (maxKey - minKey) > 0 ? Math.abs(key - (minKey + maxKey) / 2) / ((maxKey - minKey) / 2) : 1;
        const edgeness = Math.max(dist, keyDist);
        const type = edgeness > 0.6 ? edgeType : fillType;
        if (type === 'RAMP' && edgeness > 0.6) {
          // Near-edge interior: use cube (ramp only makes sense at actual edges)
          if (axis === 'x') out.push({ x: key, y, z: v, type: fillType, rotation: 0 });
          else out.push({ x: v, y, z: key, type: fillType, rotation: 0 });
        } else {
          if (axis === 'x') out.push({ x: key, y, z: v, type, rotation: 0 });
          else out.push({ x: v, y, z: key, type, rotation: 0 });
        }
        continue;
      }

      if (edgeType !== 'RAMP') {
        // Non-ramp edge type (e.g. CUBE): just place it flat
        if (axis === 'x') out.push({ x: key, y, z: v, type: edgeType, rotation: 0 });
        else out.push({ x: v, y, z: key, type: edgeType, rotation: 0 });
        continue;
      }

      // Ramp edge: orient the inverted ramp to slope outward
      // Ramp default: full height at -X, slopes down toward +X
      // rotX=2 flips it upside down (inverted)
      // rotation (Y-axis) controls which direction it slopes toward
      let rotation = 0;
      if (axis === 'z') {
        // v = X position, key = Z position
        if (atMinV && !atMinKey && !atMaxKey) rotation = 0;       // port side: slope toward -X
        else if (atMaxV && !atMinKey && !atMaxKey) rotation = 2;  // starboard: slope toward +X
        else if (atMinKey) rotation = 3;                           // stern: slope toward -Z
        else if (atMaxKey) rotation = 1;                           // bow: slope toward +Z
      } else {
        // v = Z position, key = X position
        if (atMinV && !atMinKey && !atMaxKey) rotation = 3;
        else if (atMaxV && !atMinKey && !atMaxKey) rotation = 1;
        else if (atMinKey) rotation = 0;
        else if (atMaxKey) rotation = 2;
      }

      if (axis === 'x') out.push({ x: key, y, z: v, type: 'RAMP', rotation, rotX: 2 });
      else out.push({ x: v, y, z: key, type: 'RAMP', rotation, rotX: 2 });
    }
  }
}

/**
 * Build a deck layer with ramp-tapered edges.
 * Same row format as fillHull. Port/starboard edges get ramps sloping outward.
 */
export function fillTaperedDeck(out, rows, y, axis = 'x', portRot = 1, starRot = 3) {
  if (axis === 'z') { portRot = 2; starRot = 0; }
  for (const row of rows) {
    const key = axis === 'x' ? row.x : row.z;
    const min = axis === 'x' ? row.zMin : row.xMin;
    const max = axis === 'x' ? row.zMax : row.xMax;
    for (let v = min; v <= max; v++) {
      let type = 'CUBE', rotation = 0;
      if (v === min) { type = 'RAMP'; rotation = portRot; }
      else if (v === max) { type = 'RAMP'; rotation = starRot; }
      if (axis === 'x') out.push({ x: key, y, z: v, type, rotation });
      else out.push({ x: v, y, z: key, type, rotation });
    }
  }
}
