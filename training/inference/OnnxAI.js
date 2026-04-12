/**
 * OnnxAI — In-browser RL agent for Cannonfall.
 *
 * Loads a trained ONNX model and provides the same interface as the
 * heuristic AI (computeAim), so it can be dropped into the game as
 * an opponent type without modifying existing game code.
 *
 * Also owns the builder model for castle generation — when the OnnxAI
 * instance is replaced (e.g. switching to heuristic AI), the builder
 * session is discarded automatically.
 *
 * Usage:
 *   import { OnnxAI } from './training/inference/OnnxAI.js';
 *
 *   const ai = new OnnxAI();
 *   await ai.load('/models/cannonfall_agent.onnx');
 *   await ai.loadBuilder('/models/builder_agent.onnx');
 *
 *   // Returns a Promise (inference is async)
 *   const aim = await ai.computeAim(cannon, targetPos, gameMode);
 *   // aim = { yaw, pitch, power }
 *
 * Dependencies:
 *   onnxruntime-web (loaded via CDN or npm)
 */

import { decodeDNA } from '../env/BlueprintDecoder.js';

const MIN_BUILDER_BLOCKS = 15;

/** Standard normal sample via Box-Muller transform. */
function _randn() {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
}

// Constants matching the training env observation construction
const MAX_HP = 3;
const MAX_DIST = 80;
const MAX_TURNS_DEFAULT = 30;
const MAX_YAW = Math.PI / 4;
const PITCH_MIN = -0.15;
const PITCH_MAX = Math.PI / 3;
const POWER_MIN = 10;
const POWER_MAX = 50;
const BLOCK_SIZE = 1;
const GRID_DEPTH = 9;
const MAX_LAYERS = 8;
const GRID_SIZE = GRID_DEPTH * MAX_LAYERS; // 72

export class OnnxAI {
  /**
   * @param {object} [options]
   * @param {number} [options.maxTurns=30]  Must match the training config
   */
  constructor(options = {}) {
    this._session = null;
    this._builderSession = null;
    this._maxTurns = options.maxTurns || MAX_TURNS_DEFAULT;
    this._turnCount = 0;
    this._lastHit = false;
    this._lastClosestDist = null;
    this._opponentLastHit = false;
    this._hp = MAX_HP;
    this._opponentHp = MAX_HP;
    this._blockGrid = new Float32Array(GRID_SIZE);

    // AI.js compatibility — Game.js reads these for animation timing
    this.difficulty = { hesitation: 0.15, aimTime: 0.6 };
    this._aiming = false;
    this._aimProgress = 0;
    this._startYaw = 0;
    this._startPitch = 0;
    this._targetYaw = 0;
    this._targetPitch = 0;
    this._targetPower = 0;
    this._aimResolve = null;
  }

  /**
   * Load the ONNX model.
   * @param {string} modelPath  URL or path to the .onnx file
   * @param {object} [ort]      onnxruntime-web module (auto-detected if global)
   */
  async load(modelPath, ort) {
    const runtime = ort || globalThis.ort;
    if (!runtime || !runtime.InferenceSession) {
      throw new Error(
        'onnxruntime-web not found. Load it via <script> or import before calling load().'
      );
    }
    this._ort = runtime;
    this._session = await runtime.InferenceSession.create(modelPath);
  }

  get isLoaded() {
    return this._session !== null;
  }

  /**
   * Compute aim using the trained model.
   *
   * NOTE: This is async because ONNX inference is async.  The game
   * loop should await this (e.g. during AI_AIMING state).
   *
   * @param {object} cannon   CannonTower instance (needs .group.position, .facingDirection)
   * @param {object} targetPos  THREE.Vector3 of the target
   * @param {object} gameMode   Game mode config (unused, kept for API compat with AI.js)
   * @returns {Promise<{ yaw: number, pitch: number, power: number }>}
   */
  async computeAim(cannon, targetPos, gameMode) {
    if (!this._session) throw new Error('Model not loaded — call load() first');

    const cp = cannon.group.position;
    const facing = cannon.facingDirection;

    const dx = targetPos.x - cp.x;
    const dy = targetPos.y - cp.y;
    const dz = targetPos.z - cp.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Construct 83-element observation: 11 scalars + 72 block grid (9×8)
    const obs = new Float32Array(11 + GRID_SIZE);
    obs[0] = dx;
    obs[1] = dy;
    obs[2] = dz;
    obs[3] = dist;
    obs[4] = facing;
    obs[5] = this._hp;
    obs[6] = this._opponentHp;
    obs[7] = this._turnCount / this._maxTurns;
    obs[8] = this._lastHit ? 1 : 0;
    obs[9] = this._lastClosestDist !== null
      ? Math.min(this._lastClosestDist / MAX_DIST, 1)
      : 1;
    obs[10] = this._opponentLastHit ? 1 : 0;
    obs.set(this._blockGrid, 11);

    const tensor = new this._ort.Tensor('float32', obs, [1, obs.length]);
    const feeds = { observation: tensor };
    const results = await this._session.run(feeds);
    const mean = results.action.data;

    // Sample from the learned policy distribution (mean + std * noise)
    // using the exported log_std. Falls back to deterministic if missing.
    const logStd = results.action_log_std?.data;
    const sampled = new Float32Array(3);
    for (let i = 0; i < 3; i++) {
      const noise = logStd ? Math.exp(logStd[i]) * _randn() : 0;
      sampled[i] = Math.max(-1, Math.min(1, mean[i] + noise));
    }

    // Rescale from [-1, 1] to game ranges (matches cannonfall_env.py)
    const yaw   = Math.max(-MAX_YAW, Math.min(MAX_YAW, sampled[0] * MAX_YAW));
    const pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX,
      PITCH_MIN + (sampled[1] + 1) / 2 * (PITCH_MAX - PITCH_MIN)));
    const power = Math.max(POWER_MIN, Math.min(POWER_MAX,
      POWER_MIN + (sampled[2] + 1) / 2 * (POWER_MAX - POWER_MIN)));

    return { yaw, pitch, power };
  }

  // -------------------------------------------------------------------
  // AI.js drop-in methods — required by Game.js for animation/aiming
  // -------------------------------------------------------------------

  /** Spread is handled by sampling from the policy distribution in computeAim. */
  applySpread(aim) {
    return aim;
  }

  /** Animate cannon toward target aim over time. Returns Promise. */
  startAiming(cannon, targetAim) {
    return new Promise((resolve) => {
      this._aiming = true;
      this._aimProgress = 0;
      this._startYaw = cannon.yaw;
      this._startPitch = cannon.pitch;
      this._targetYaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, targetAim.yaw));
      this._targetPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, targetAim.pitch));
      this._targetPower = Math.max(POWER_MIN, Math.min(POWER_MAX, targetAim.power));
      this._aimResolve = resolve;
    });
  }

  /** Called each frame during AI_AIMING. Returns true when done. */
  updateAiming(dt, cannon) {
    if (!this._aiming) return false;
    this._aimProgress += dt / this.difficulty.aimTime;
    if (this._aimProgress >= 1) {
      this._aimProgress = 1;
      this._aiming = false;
      cannon.yaw = this._targetYaw;
      cannon.pitch = this._targetPitch;
      cannon.updateAim();
      if (this._aimResolve) {
        this._aimResolve({
          yaw: this._targetYaw,
          pitch: this._targetPitch,
          power: this._targetPower,
        });
        this._aimResolve = null;
      }
      return true;
    }
    const t = this._aimProgress;
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    cannon.yaw = this._startYaw + (this._targetYaw - this._startYaw) * ease;
    cannon.pitch = this._startPitch + (this._targetPitch - this._startPitch) * ease;
    cannon.updateAim();
    return false;
  }

  /**
   * Choose a reposition target using cover-based strategy (matches HARD AI).
   * The model only trains on firing, so we use heuristic repositioning.
   */
  chooseRepositionTarget(castle) {
    const gw = castle.gridWidth || 9;
    const gd = castle.gridDepth || 9;
    const layout = castle.layoutData || [];

    const scores = [];
    for (let x = 0; x < gw; x++) {
      for (let z = 0; z < gd; z++) {
        const shielding = layout.filter(b =>
          b.x < x && Math.abs(b.z - z) <= 1
        ).length;
        const verticalCover = layout.filter(b =>
          b.x === x && b.z === z && b.y > 0
        ).length;
        scores.push({ x, z, cover: shielding + verticalCover });
      }
    }

    scores.sort((a, b) => b.cover - a.cover);
    const top = scores.slice(0, 3);
    const pick = top[Math.floor(Math.random() * top.length)];
    return { x: pick.x, y: 0, z: pick.z };
  }

  // -------------------------------------------------------------------
  // State tracking
  // -------------------------------------------------------------------

  /**
   * Call after each shot to update internal state for next observation.
   * @param {boolean} hit        Whether the shot hit the target
   * @param {number} closestDist Distance of closest approach
   */
  updateAfterShot(hit, closestDist) {
    this._lastHit = hit;
    this._lastClosestDist = closestDist;
    this._turnCount++;
    if (hit) this._opponentHp--;
  }

  /**
   * Call when the opponent fires to track their result.
   * @param {boolean} opponentHit Whether the opponent hit
   */
  updateAfterOpponentShot(opponentHit) {
    this._opponentLastHit = opponentHit;
    this._turnCount++;
    if (opponentHit) this._hp--;
  }

  /**
   * Build front-facing occupancy grid from the opponent's castle blocks.
   * Call each turn before computeAim.
   * @param {object} castle  Castle instance (needs .blocks, .gridDepth)
   */
  updateBlockGrid(castle) {
    this._blockGrid.fill(0);
    const gd = castle.gridDepth || GRID_DEPTH;
    const halfD = Math.floor(gd / 2);
    for (const b of castle.blocks) {
      if (!b.body) continue;
      const gz = Math.round(b.body.position.z / BLOCK_SIZE + halfD);
      const gy = Math.round((b.body.position.y - BLOCK_SIZE / 2) / BLOCK_SIZE);
      if (gz >= 0 && gz < gd && gy >= 0 && gy < MAX_LAYERS) {
        this._blockGrid[gy * gd + gz] = 1;
      }
    }
  }

  // -------------------------------------------------------------------
  // Builder model — castle generation from DNA
  // -------------------------------------------------------------------

  /**
   * Load the builder ONNX model for castle generation.
   * @param {string} modelPath  URL or path to the builder .onnx file
   */
  async loadBuilder(modelPath) {
    const runtime = this._ort || globalThis.ort;
    if (!runtime) throw new Error('onnxruntime-web not loaded');
    this._builderSession = await runtime.InferenceSession.create(modelPath);
  }

  get hasBuilder() {
    return this._builderSession !== null;
  }

  /**
   * Generate a castle layout using the builder model.
   * Runs inference to get a DNA vector, decodes it, and nudges sparse
   * results to ensure a viable castle.
   * @param {object} gameMode  Game mode config (needs gridWidth, gridDepth, maxLayers, budget)
   * @returns {Promise<{ layout: object[], target: object, cannonPos: object }>}
   */
  async generateCastle(gameMode) {
    if (!this._builderSession) throw new Error('Builder model not loaded');
    const ort = this._ort || globalThis.ort;

    // Vary the observation each game so the model sees different contexts
    const attackerSkill = 0.2 + Math.random() * 0.6; // range [0.2, 0.8]
    const lastReward = (Math.random() - 0.5) * 40;   // range [-20, 20]

    const obs = new Float32Array([
      attackerSkill,
      1.0,  // mode (castle)
      gameMode.gridWidth || 9,
      gameMode.gridDepth || 9,
      gameMode.maxLayers || 8,
      gameMode.budget || 600,
      15.0, // max_turns
      lastReward,
    ]);

    const tensor = new ort.Tensor('float32', obs, [1, obs.length]);
    const results = await this._builderSession.run({ observation: tensor });
    const mean = results.action.data;

    // Sample from the policy distribution (same approach as the firing model)
    const logStd = results.action_log_std?.data;
    const dna = new Array(mean.length);
    for (let i = 0; i < mean.length; i++) {
      const noise = logStd ? Math.exp(logStd[i]) * _randn() : _randn() * 0.15;
      dna[i] = Math.max(-1, Math.min(1, mean[i] + noise));
    }

    const decodeOpts = {
      gridWidth: gameMode.gridWidth || 9,
      gridDepth: gameMode.gridDepth || 9,
      maxLayers: gameMode.maxLayers || 8,
      budget: gameMode.budget || 600,
    };

    let decoded = decodeDNA(dna, decodeOpts);

    // Nudge sparse layouts by boosting structural genes
    const MAX_NUDGES = 3;
    const NUDGE_STEP = 0.3;
    for (let i = 0; i < MAX_NUDGES && decoded.layout.length < MIN_BUILDER_BLOCKS; i++) {
      dna[0] = Math.min(1, dna[0] + NUDGE_STEP);   // perimeterHeight
      dna[4] = Math.min(1, dna[4] + NUDGE_STEP);   // interiorDensity
      dna[5] = Math.min(1, dna[5] + NUDGE_STEP * 0.5); // interiorHeight
      dna[6] = Math.min(1, dna[6] + NUDGE_STEP * 0.5); // roofCoverage
      decoded = decodeDNA(dna, decodeOpts);
    }

    const gd = gameMode.gridDepth || 9;
    decoded.cannonPos = { x: (gameMode.gridWidth || 9) - 1, z: Math.floor(gd / 2) };

    return decoded;
  }

  /** Reset state for a new game. */
  resetGame() {
    this._turnCount = 0;
    this._lastHit = false;
    this._lastClosestDist = null;
    this._opponentLastHit = false;
    this._hp = MAX_HP;
    this._opponentHp = MAX_HP;
    this._blockGrid.fill(0);
  }
}
