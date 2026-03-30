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
