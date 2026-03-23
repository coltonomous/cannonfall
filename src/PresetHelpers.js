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
 * Options: { axis: 'z' (rows keyed by z) or 'x' (rows keyed by x) }
 * Edge blocks use edgeType, interior uses fillType.
 */
export function fillHull(out, rows, y, fillType = 'CUBE', edgeType = 'HALF_SLAB', axis = 'x') {
  const maxKey = Math.max(...rows.map(r => axis === 'x' ? r.x : r.z));
  const minKey = Math.min(...rows.map(r => axis === 'x' ? r.x : r.z));

  for (const row of rows) {
    const key = axis === 'x' ? row.x : row.z;
    const min = axis === 'x' ? row.zMin : row.xMin;
    const max = axis === 'x' ? row.zMax : row.xMax;
    const isEnd = key === maxKey || key === minKey;
    const span = max - min;

    for (let v = min; v <= max; v++) {
      const isEdge = v === min || v === max || isEnd;
      const center = (min + max) / 2;
      const dist = span > 0 ? Math.abs(v - center) / (span / 2) : 1;
      const keyDist = (maxKey - minKey) > 0 ? Math.abs(key - (minKey + maxKey) / 2) / ((maxKey - minKey) / 2) : 1;
      const edgeness = Math.max(dist, keyDist);

      const type = (isEdge || edgeness > 0.6) ? edgeType : fillType;
      if (axis === 'x') out.push({ x: key, y, z: v, type, rotation: 0 });
      else out.push({ x: v, y, z: key, type, rotation: 0 });
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
