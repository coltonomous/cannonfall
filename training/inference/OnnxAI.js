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

    // Construct the same 11-element observation vector as cannonfall_env.py
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

  /** Reset state for a new game. */
  resetGame() {
    this._turnCount = 0;
    this._lastHit = false;
    this._lastClosestDist = null;
    this._opponentLastHit = false;
    this._hp = MAX_HP;
    this._opponentHp = MAX_HP;
  }
}
