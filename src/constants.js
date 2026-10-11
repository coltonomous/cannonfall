// Dimensions
export const BLOCK_SIZE = 1;
export const CASTLE_OFFSET_X = 20;

// Cannon
export const CANNON_HEIGHT = 10;
export const CANNON_BARREL_LENGTH = 2;

// Cannonball
export const CANNONBALL_RADIUS = 0.4;
export const CANNONBALL_MASS = 4;

// Block Physics
export const BLOCK_MASS = 2;

// Aim limits, power and block catalog — re-exported from shared constants (single source of truth)
export {
  MIN_PITCH, MAX_PITCH, MAX_YAW_OFFSET, MIN_POWER, MAX_POWER, PERFECT_MIN, PERFECT_MAX,
  BLOCK_TYPES, MAX_HP,
} from '../shared/constants.js';
export const DEFAULT_POWER = 30;

// Input Speeds
export const AIM_SPEED = 0.012;
export const TOUCH_AIM_SENSITIVITY = 0.004;
export const CHARGE_FREQ = Math.PI * 1.5; // angular speed — one full swing ~2.1s

// Physics
export const PHYSICS_STEP = 1 / 60;

// Hit Detection
export const TARGET_HIT_RADIUS = 1.2;
export const EXPLOSIVE_HIT_RADIUS = 2.0;

// Projectile Settling
export const SETTLE_SPEED = 0.5;
export const SETTLE_TIME = 1.5;
export const IMPACT_SPEED_RATIO = 0.5;

// Timing (seconds)
export const SKIP_PROMPT_DELAY = 2;
export const AUTO_MISS_TIMEOUT = 6;
export const HIT_DISPLAY_DELAY = 1500;     // ms
export const PERFECT_FIRE_DELAY = 350;     // ms

// Cannon Placement
export const CANNON_OFFSET_FROM_CASTLE = 4;

// Minimap
export const MINIMAP_RING_INNER = 0.6;
export const MINIMAP_RING_OUTER = 0.9;
export const MINIMAP_RING_Y = 25;

// Network Timeouts — re-exported from shared constants
export { SHOT_RESOLVE_TIMEOUT, FIRE_SAFETY_TIMEOUT } from '../shared/constants.js';

// Replay
export const REPLAY_TIME_SCALE = 0.25;
export const REPLAY_DURATION = 5; // seconds (real time)

// HP

// ── Trajectory & Aiming Visuals ──────────────────────────

export const TRAJECTORY_COLOR = 0xffff00;
export const TRAJECTORY_DASH_SIZE = 0.5;
export const TRAJECTORY_GAP_SIZE = 0.3;
export const TRAJECTORY_MAX_POINTS = 120;
export const TRAJECTORY_STEP = 0.05;

// Impact beam (predicted landing indicator)
export const IMPACT_BEAM_HEIGHT = 8;
export const IMPACT_BEAM_RADIUS = 0.06;
export const IMPACT_BEAM_GLOW_RADIUS = 0.2;
export const IMPACT_RING_INNER = 0.4;
export const IMPACT_RING_OUTER = 0.7;

// Reticle (zero-G crosshair)
export const RETICLE_SIZE = 0.6;
export const RETICLE_COLOR = 0xff4444;
export const RETICLE_SEGMENTS = 32;
export const RETICLE_DISTANCE = 40;

// Pulse animation
export const BEAM_PULSE_SPEED = 0.005;
export const BEAM_PULSE_BASE = 0.3;
export const BEAM_PULSE_AMPLITUDE = 0.15;
export const RETICLE_PULSE_SPEED = 0.004;
export const RETICLE_PULSE_AMPLITUDE = 0.15;

// ── Physics Tuning ───────────────────────────────────────

export const SOLVER_ITERATIONS = 10;
export const BUOYANCY_FACTOR = 15;
export const WATER_DRAG_XZ = 0.98;
export const WATER_DRAG_Y = 0.95;
export const SHIP_PHASE_OFFSET = 3.5;
export const SHIP_ROLL_SCALE = 3.5;
export const SHIP_PITCH_SCALE = 2.5;
export const SHIP_SAMPLE_DIST = 5;

// ── Scene Defaults ───────────────────────────────────────

export const DEFAULT_BG_COLOR = 0x87CEEB;
export const DEFAULT_FOG_NEAR = 100;
export const DEFAULT_FOG_FAR = 200;
export const GROUND_SIZE = 120;
export const SHADOW_MAP_SIZE = 2048;
export const SHADOW_BOUNDS = 40;
export const STAR_COUNT = 2000;
export const STAR_SPHERE_RADIUS = 150;

// ── Fallen Block Cleanup ─────────────────────────────────

export const DEBRIS_BOUNDS = 100;
export const DEFAULT_BOUNDS = 60;
