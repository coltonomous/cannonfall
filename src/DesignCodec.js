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

export function decode(hashStr) {
  const match = hashStr.match(/^d=([cps]):(.+)$/);
  if (!match) return null;

  try {
    const modeId = CHAR_TO_MODE[match[1]];
    const packed = decodeURIComponent(escape(atob(match[2])));
    const [blocksStr, targetStr, cannonStr, floorStr] = packed.split('|');

    return {
      modeId,
      castleData: {
        layout: unpackBlocks(blocksStr),
        target: JSON.parse(targetStr),
        cannonPos: JSON.parse(cannonStr),
        floor: floorStr ? JSON.parse(floorStr) : null,
      },
    };
  } catch {
    return null;
  }
}
