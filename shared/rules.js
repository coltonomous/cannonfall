// Game rules shared by client and server: perfect-shot detection and
// validation of castle data that arrives from an untrusted source
// (a socket payload or a share link).
import {
  MIN_POWER, MAX_POWER, PERFECT_MIN, PERFECT_MAX,
  BLOCK_TYPES, MODE_RULES, MAX_LAYOUT_BLOCKS,
} from './constants.js';

/** True when a charged power lands in the perfect-shot sweet spot. */
export function isPerfectPower(power) {
  const frac = (power - MIN_POWER) / (MAX_POWER - MIN_POWER);
  return frac >= PERFECT_MIN && frac <= PERFECT_MAX;
}

function isObject(v) {
  return v !== null && typeof v === 'object';
}

function inRange(v, min, max) {
  return Number.isInteger(v) && v >= min && v <= max;
}

function rotation(v) {
  return Number.isInteger(v) ? ((v % 4) + 4) % 4 : 0;
}

/**
 * Validate a target position against a mode's grid. Returns a normalized
 * { x, y, z } or null. The target may sit one layer above the top block.
 */
export function validateTargetPos(pos, modeId) {
  const rules = MODE_RULES[modeId];
  if (!rules || !isObject(pos)) return null;
  const y = pos.y ?? 0;
  if (!inRange(pos.x, 0, rules.gridWidth - 1)) return null;
  if (!inRange(pos.z, 0, rules.gridDepth - 1)) return null;
  if (!inRange(y, 0, rules.maxLayers)) return null;
  return { x: pos.x, y, z: pos.z };
}

/**
 * Validate castle data against a mode's build rules: grid bounds, allowed
 * block types and budget. Returns a normalized copy containing only known
 * fields, or null.
 */
export function validateCastle(data, modeId) {
  const rules = MODE_RULES[modeId];
  if (!rules || !isObject(data) || !Array.isArray(data.layout)) return null;
  if (data.layout.length > MAX_LAYOUT_BLOCKS) return null;

  const layout = [];
  let cost = 0;
  for (const b of data.layout) {
    if (!isObject(b)) return null;
    if (!Object.hasOwn(BLOCK_TYPES, b.type) || rules.excludeBlocks.includes(b.type)) return null;
    if (!inRange(b.x, 0, rules.gridWidth - 1)) return null;
    if (!inRange(b.y, 0, rules.maxLayers - 1)) return null;
    if (!inRange(b.z, 0, rules.gridDepth - 1)) return null;
    cost += BLOCK_TYPES[b.type].cost;
    const block = { x: b.x, y: b.y, z: b.z, type: b.type, rotation: rotation(b.rotation) };
    if (rotation(b.rotX)) block.rotX = rotation(b.rotX);
    if (rotation(b.rotZ)) block.rotZ = rotation(b.rotZ);
    layout.push(block);
  }
  if (cost > rules.budget) return null;

  const target = validateTargetPos(data.target, modeId);
  if (!target) return null;

  const castle = { layout, target };

  if (data.cannonPos != null) {
    const { x, z } = isObject(data.cannonPos) ? data.cannonPos : {};
    if (!inRange(x, 0, rules.gridWidth - 1) || !inRange(z, 0, rules.gridDepth - 1)) return null;
    castle.cannonPos = { x, z };
  }

  if (data.floor != null) {
    if (!Array.isArray(data.floor) || data.floor.length > MAX_LAYOUT_BLOCKS) return null;
    castle.floor = [];
    for (const fb of data.floor) {
      if (!isObject(fb)) return null;
      if (!inRange(fb.x, 0, rules.gridWidth - 1) || !inRange(fb.z, 0, rules.gridDepth - 1)) return null;
      const type = fb.type ?? 'CUBE';
      if (!Object.hasOwn(BLOCK_TYPES, type)) return null;
      const entry = { x: fb.x, z: fb.z, type, rotation: rotation(fb.rotation) };
      // Floor pieces are static, so they may only extend downward (hull, keel)
      if (fb.yOffset !== undefined) {
        if (!inRange(fb.yOffset, -5, 0)) return null;
        entry.yOffset = fb.yOffset;
      }
      if (fb.flip) entry.flip = true;
      castle.floor.push(entry);
    }
  }

  return castle;
}
