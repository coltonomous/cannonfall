// ── Dimensions ─────────────────────────────────────────
export const BLOCK_SIZE = 1;
export const CASTLE_OFFSET_X = 20;

// ── Cannon ─────────────────────────────────────────────
export const CANNON_HEIGHT = 10;
export const CANNON_BARREL_LENGTH = 2;

// ── Cannonball ─────────────────────────────────────────
export const CANNONBALL_RADIUS = 0.4;
export const CANNONBALL_MASS = 4;

// ── Block Physics ──────────────────────────────────────
export const BLOCK_MASS = 2;

// ── Aim Limits ─────────────────────────────────────────
export const MIN_PITCH = -0.15; // allows aiming slightly below horizontal
export const MAX_PITCH = Math.PI / 3;
export const MAX_YAW_OFFSET = Math.PI / 4;

// ── Power ──────────────────────────────────────────────
export const MIN_POWER = 10;
export const MAX_POWER = 50;
export const DEFAULT_POWER = 30;

// ── Input Speeds ───────────────────────────────────────
export const AIM_SPEED = 0.012;
export const CHARGE_FREQ = Math.PI * 1.5; // angular speed — one full swing ~2.1s
export const PERFECT_MIN = 0.80; // sweet spot: 80-88% of power range
export const PERFECT_MAX = 0.88;

// ── Physics ────────────────────────────────────────────
export const PHYSICS_STEP = 1 / 60;

// ── Building ───────────────────────────────────────────
export const BUILD_BUDGET = 500;

export const BLOCK_TYPES = {
  CUBE:        { cost: 3, size: [1, 1, 1] },         // vol 1.0
  HALF_SLAB:   { cost: 2, size: [1, 0.5, 1] },       // vol 0.5
  WALL:        { cost: 2, size: [1, 1, 0.5] },        // vol 0.5
  RAMP:        { cost: 2, size: [1, 1, 1] },          // vol 0.5
  COLUMN:      { cost: 1, size: [0.5, 1, 0.5] },     // vol 0.25
  QUARTER_DOME:{ cost: 1, size: [1, 1, 1] },          // vol ~0.13
  BULLNOSE:    { cost: 3, size: [1, 1, 1] },          // vol ~0.85
  HALF_BULLNOSE:{ cost: 2, size: [1, 1, 1] },         // vol ~0.75
  THRUSTER:    { cost: 1, size: [0.5, 0.5, 0.5] }, // vol ~0.15
  SHIELD:      { cost: 1, size: [1, 1, 0.5], mass: 0.3,             // vol 0.5, fragile
    material: { color: 0x4488ff, transparent: true, opacity: 0.35,
      emissive: 0x2244aa, emissiveIntensity: 0.3 }},
  PLANK:       { cost: 1, size: [2, 0.25, 0.5] },     // vol 0.25
  CYLINDER:    { cost: 2, size: [1, 1, 1] },           // vol ~0.79
  LATTICE:     { cost: 1, size: [1, 0.1, 1], mass: 0.2,             // vol 0.1, fragile
    material: { color: 0x887766, transparent: true, opacity: 0.5 }},
  BARREL:      { cost: 1, size: [0.5, 0.5, 0.5] },    // vol ~0.05
};

// ── HP ────────────────────────────────────────────────
export const MAX_HP = 3;
