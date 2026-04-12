// Shared constants used by both client and server.
// Import from here to keep validation rules in sync.

// Aim Limits
export const MIN_PITCH = -0.15;
export const MAX_PITCH = Math.PI / 3;
export const MAX_YAW_OFFSET = Math.PI / 4;

// Power
export const MIN_POWER = 10;
export const MAX_POWER = 50;

// Building limits (server validation)
export const MAX_LAYOUT_BLOCKS = 600;
export const MAX_GRID_SIZE = 20;
export const MAX_LAYERS = 8;

// Network Timeouts
export const SHOT_RESOLVE_TIMEOUT = 3000;  // ms
export const FIRE_SAFETY_TIMEOUT = 10000;  // ms

// Valid game modes
export const VALID_MODES = ['castle', 'pirate', 'space'];
