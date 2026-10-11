// Shared constants used by both client and server.
// Import from here to keep validation rules in sync.

// Aim Limits
export const MIN_PITCH = -0.15;
export const MAX_PITCH = Math.PI / 3;
export const MAX_YAW_OFFSET = Math.PI / 4;

// Power
export const MIN_POWER = 10;
export const MAX_POWER = 50;
export const PERFECT_MIN = 0.62; // sweet spot: 62-70% of power range — risk/reward: stop early for max power
export const PERFECT_MAX = 0.70;

// Building
export const MAX_LAYOUT_BLOCKS = 600;

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

// Per-mode build limits. GameModes.js spreads these into each mode config.
export const MODE_RULES = {
  castle: { gridWidth: 9, gridDepth: 9,  maxLayers: 8, budget: 600, excludeBlocks: ['THRUSTER', 'SHIELD'] },
  pirate: { gridWidth: 7, gridDepth: 11, maxLayers: 6, budget: 500, excludeBlocks: ['THRUSTER', 'SHIELD'] },
  space:  { gridWidth: 7, gridDepth: 13, maxLayers: 5, budget: 600, excludeBlocks: [] },
};

// Network Timeouts
export const SHOT_RESOLVE_TIMEOUT = 3000;  // ms
export const FIRE_SAFETY_TIMEOUT = 10000;  // ms

// Server limits
export const MAX_LOBBIES = 100;
export const MAX_GAMES = 200;
export const RECONNECT_GRACE_SECONDS = 30;
export const LOBBY_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const LOBBY_CLEANUP_INTERVAL_MS = 60_000; // 1 minute
export const GAME_CLEANUP_DELAY_MS = 10_000;
export const DISCONNECT_CLEANUP_DELAY_MS = 5_000;
export const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 15_000;

// Hits a castle can take
export const MAX_HP = 3;
