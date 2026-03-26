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
export const TOUCH_AIM_SENSITIVITY = 0.004;
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

// ── Hit Detection ─────────────────────────────────────
export const TARGET_HIT_RADIUS = 1.2;
export const EXPLOSIVE_HIT_RADIUS = 2.0;

// ── Projectile Settling ───────────────────────────────
export const SETTLE_SPEED = 0.5;
export const SETTLE_TIME = 1.5;
export const IMPACT_SPEED_RATIO = 0.5;

// ── Timing (seconds) ─────────────────────────────────
export const SKIP_PROMPT_DELAY = 2;
export const AUTO_MISS_TIMEOUT = 6;
export const MISS_TURN_DELAY = 1000;       // ms
export const HIT_DISPLAY_DELAY = 1500;     // ms
export const PERFECT_FIRE_DELAY = 350;     // ms
export const EXPLOSION_SETTLE_DELAY = 2500;// ms

// ── Cannon Placement ──────────────────────────────────
export const CANNON_OFFSET_FROM_CASTLE = 4;

// ── Minimap ───────────────────────────────────────────
export const MINIMAP_RING_INNER = 0.6;
export const MINIMAP_RING_OUTER = 0.9;
export const MINIMAP_RING_Y = 25;

// ── Network Timeouts (server) ─────────────────────────
export const SHOT_RESOLVE_TIMEOUT = 3000;  // ms
export const FIRE_SAFETY_TIMEOUT = 10000;  // ms

// ── HP ────────────────────────────────────────────────
export const MAX_HP = 3;
