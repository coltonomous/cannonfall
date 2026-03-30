/**
 * OnnxAI — In-browser RL agent for Cannonfall.
 *
 * Loads a trained ONNX model and provides the same interface as the
 * heuristic AI (computeAim), so it can be dropped into the game as
 * an opponent type without modifying existing game code.
 *
 * Usage:
 *   import { OnnxAI } from './training/inference/OnnxAI.js';
 *
 *   const ai = new OnnxAI();
 *   await ai.load('/models/cannonfall_agent.onnx');
 *
 *   // Returns a Promise (inference is async)
 *   const aim = await ai.computeAim(cannon, targetPos, gameMode);
 *   // aim = { yaw, pitch, power }
 *
 * Dependencies:
 *   onnxruntime-web (loaded via CDN or npm)
 */

// Constants matching the training env observation construction
const MAX_HP = 3;
const MAX_DIST = 80;
const MAX_TURNS_DEFAULT = 30;
const MAX_YAW = Math.PI / 4;
const PITCH_MIN = -0.15;
const PITCH_MAX = Math.PI / 3;
const POWER_MIN = 10;
const POWER_MAX = 50;

export class OnnxAI {
  /**
   * @param {object} [options]
   * @param {number} [options.maxTurns=30]  Must match the training config
   */
  constructor(options = {}) {
    this._session = null;
    this._maxTurns = options.maxTurns || MAX_TURNS_DEFAULT;
    this._turnCount = 0;
    this._lastHit = false;
    this._lastClosestDist = null;
    this._opponentLastHit = false;
    this._hp = MAX_HP;
    this._opponentHp = MAX_HP;
    this._blockCountNorm = 0;
    this._avgBlockDistNorm = 0;
    this._blockSpreadYNorm = 0;

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

    // Construct 14-element observation matching the trained model
    const obs = new Float32Array([
      dx,
      dy,
      dz,
      dist,
      facing,
      this._hp,
      this._opponentHp,
      this._turnCount / this._maxTurns,
      this._lastHit ? 1 : 0,
      this._lastClosestDist !== null
        ? Math.min(this._lastClosestDist / MAX_DIST, 1)
        : 1,
      this._opponentLastHit ? 1 : 0,
      this._blockCountNorm,
      this._avgBlockDistNorm,
      this._blockSpreadYNorm,
    ]);

    const tensor = new this._ort.Tensor('float32', obs, [1, obs.length]);
    const feeds = { observation: tensor };
    const results = await this._session.run(feeds);
    const action = results.action.data;

    // Rescale from [-1, 1] to game ranges (matches cannonfall_env.py)
    const yaw   = Math.max(-MAX_YAW, Math.min(MAX_YAW, action[0] * MAX_YAW));
    const pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX,
      PITCH_MIN + (action[1] + 1) / 2 * (PITCH_MAX - PITCH_MIN)));
    const power = Math.max(POWER_MIN, Math.min(POWER_MAX,
      POWER_MIN + (action[2] + 1) / 2 * (POWER_MAX - POWER_MIN)));

    return { yaw, pitch, power };
  }

  // -------------------------------------------------------------------
  // AI.js drop-in methods — required by Game.js for animation/aiming
  // -------------------------------------------------------------------

  /** No spread needed — model output is already the final action. */
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

  /** Pick a random reposition target (RL agent doesn't optimise this). */
  chooseRepositionTarget(castle) {
    const gw = castle.gridWidth || 9;
    const gd = castle.gridDepth || 9;
    return {
      x: Math.floor(Math.random() * gw),
      y: 0,
      z: Math.floor(Math.random() * gd),
    };
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
   * Update block summary features for spatial awareness.
   * Call each turn with the opponent castle's block data.
   * @param {object} castle  Castle instance (needs .blocks)
   */
  updateBlockInfo(castle) {
    const maxBlocks = 200;
    const blocks = castle.blocks.filter(b => b.body);
    this._blockCountNorm = Math.min(blocks.length / maxBlocks, 1);
    if (blocks.length > 0) {
      const cannon = { x: 0, y: 0, z: 0 }; // relative distances
      const dists = blocks.map(b => {
        const bx = b.body.position.x;
        const by = b.body.position.y;
        const bz = b.body.position.z;
        return Math.sqrt(bx * bx + by * by + bz * bz);
      });
      this._avgBlockDistNorm = Math.min(
        dists.reduce((a, d) => a + d, 0) / dists.length / MAX_DIST, 1
      );
      const ys = blocks.map(b => b.body.position.y);
      this._blockSpreadYNorm = Math.min((Math.max(...ys) - Math.min(...ys)) / 10, 1);
    } else {
      this._avgBlockDistNorm = 0;
      this._blockSpreadYNorm = 0;
    }
  }

  /** Reset state for a new game. */
  resetGame() {
    this._turnCount = 0;
    this._lastHit = false;
    this._lastClosestDist = null;
    this._opponentLastHit = false;
    this._hp = MAX_HP;
    this._opponentHp = MAX_HP;
    this._blockCountNorm = 0;
    this._avgBlockDistNorm = 0;
    this._blockSpreadYNorm = 0;
  }
}
