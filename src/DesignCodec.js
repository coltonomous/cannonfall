/**
 * Compact encoding/decoding of castle designs for URL sharing.
 * Format: d=<modeChar>:<base64(packedString)>
 */

const TYPE_TO_CHAR = {
  CUBE: 'C', HALF_SLAB: 'H', WALL: 'W', RAMP: 'R', COLUMN: 'L',
  QUARTER_DOME: 'Q', BULLNOSE: 'B', HALF_BULLNOSE: 'b', THRUSTER: 'T',
  SHIELD: 'S', PLANK: 'P', CYLINDER: 'Y', LATTICE: 'A', BARREL: 'D',
};
const CHAR_TO_TYPE = Object.fromEntries(Object.entries(TYPE_TO_CHAR).map(([k, v]) => [v, k]));

const MODE_TO_CHAR = { castle: 'c', pirate: 'p', space: 's' };
const CHAR_TO_MODE = Object.fromEntries(Object.entries(MODE_TO_CHAR).map(([k, v]) => [v, k]));

function packBlocks(layout) {
  return layout.map(b => {
    const parts = [b.x, b.y, b.z, TYPE_TO_CHAR[b.type] || b.type, b.rotation || 0];
    if (b.rotX) parts.push(b.rotX);
    if (b.rotZ) parts.push(b.rotZ);
    return parts.join(',');
  }).join(';');
}

function unpackBlocks(str) {
  if (!str) return [];
  return str.split(';').filter(Boolean).map(s => {
    const p = s.split(',');
    const block = {
      x: +p[0], y: +p[1], z: +p[2],
      type: CHAR_TO_TYPE[p[3]] || p[3],
      rotation: +p[4] || 0,
    };
    if (p[5]) block.rotX = +p[5];
    if (p[6]) block.rotZ = +p[6];
    return block;
  });
}

export function encode(castleData, modeId) {
  const modeChar = MODE_TO_CHAR[modeId] || 'c';
  const parts = [
    packBlocks(castleData.layout),
    JSON.stringify(castleData.target),
    JSON.stringify(castleData.cannonPos),
    castleData.floor?.length ? JSON.stringify(castleData.floor) : '',
  ];
  const packed = parts.join('|');
  return `d=${modeChar}:${btoa(unescape(encodeURIComponent(packed)))}`;
}

const MAX_BLOCKS = 600;
const MAX_COORD = 20;
const VALID_TYPES = new Set(Object.keys(TYPE_TO_CHAR));

function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function sanitizeGridPos(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const x = +obj.x, z = +obj.z;
  if (!isFiniteNum(x) || !isFiniteNum(z)) return null;
  if (x < 0 || x >= MAX_COORD || z < 0 || z >= MAX_COORD) return null;
  const result = { x: Math.floor(x), z: Math.floor(z) };
  if (obj.y !== undefined) {
    const y = +obj.y;
    if (!isFiniteNum(y) || y < 0 || y >= MAX_COORD) return null;
    result.y = Math.floor(y);
  }
  return result;
}

function sanitizeLayout(blocks) {
  if (!Array.isArray(blocks)) return [];
  const valid = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (valid.length >= MAX_BLOCKS) break;
    const x = +b.x, y = +b.y, z = +b.z;
    if (!isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(z)) continue;
    if (x < 0 || x >= MAX_COORD || y < 0 || y >= MAX_COORD || z < 0 || z >= MAX_COORD) continue;
    const type = VALID_TYPES.has(b.type) ? b.type : null;
    if (!type) continue;
    const block = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), type, rotation: (+b.rotation || 0) % 4 };
    if (b.rotX) block.rotX = (+b.rotX || 0) % 4;
    if (b.rotZ) block.rotZ = (+b.rotZ || 0) % 4;
    valid.push(block);
  }
  return valid;
}

function sanitizeFloor(floor) {
  if (!Array.isArray(floor)) return null;
  const valid = [];
  for (const fb of floor) {
    if (!fb || typeof fb !== 'object') continue;
    if (valid.length >= MAX_BLOCKS) break;
    const x = +fb.x, z = +fb.z;
    if (!isFiniteNum(x) || !isFiniteNum(z)) continue;
    if (x < 0 || x >= MAX_COORD || z < 0 || z >= MAX_COORD) continue;
    const type = VALID_TYPES.has(fb.type) ? fb.type : 'CUBE';
    const entry = { x: Math.floor(x), z: Math.floor(z), type };
    if (fb.rotation !== undefined) entry.rotation = (+fb.rotation || 0) % 4;
    if (fb.yOffset !== undefined) {
      const yo = +fb.yOffset;
      entry.yOffset = isFiniteNum(yo) ? Math.max(-5, Math.min(5, Math.floor(yo))) : 0;
    }
    if (fb.flip) entry.flip = true;
    valid.push(entry);
  }
  return valid.length > 0 ? valid : null;
}

export function decode(hashStr) {
  const match = hashStr.match(/^d=([cps]):(.+)$/);
  if (!match) return null;

  try {
    const modeId = CHAR_TO_MODE[match[1]];
    const packed = decodeURIComponent(escape(atob(match[2])));
    const [blocksStr, targetStr, cannonStr, floorStr] = packed.split('|');

    const layout = sanitizeLayout(unpackBlocks(blocksStr));
    const target = sanitizeGridPos(JSON.parse(targetStr));
    const cannonPos = sanitizeGridPos(JSON.parse(cannonStr));
    const floor = floorStr ? sanitizeFloor(JSON.parse(floorStr)) : null;

    if (!target || !cannonPos || layout.length === 0) return null;

    return {
      modeId,
      castleData: { layout, target, cannonPos, floor },
    };
  } catch {
    return null;
  }
}
