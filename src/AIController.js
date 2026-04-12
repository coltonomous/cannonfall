import { AI } from './AI.js';
import { OnnxAI } from '../training/inference/OnnxAI.js';
import { getPreset } from './Presets.js';
import { decodeDNA } from '../training/env/BlueprintDecoder.js';
import * as C from './constants.js';

const ONNX_CDN_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.min.js';
const ONNX_CDN_INTEGRITY = 'sha384-ptI8iyyOcINc8kC8ZGnLexw29V7PfIaX46b1GMjaX2QKGvUPH8Jrp5U81Mh4TDp4';

// Minimum block count to accept a builder-generated castle; below this, fall back to preset
const MIN_BUILDER_BLOCKS = 15;

/**
 * Manages AI opponent creation, ONNX model loading, and AI turn execution.
 * Extracted from Game to isolate AI-specific orchestration.
 */
export class AIController {
  constructor() {
    this.ai = null;
    this.difficulty = 'MEDIUM';
    this._builderSession = null;
  }

  /**
   * Load the AI for the given difficulty. Returns the AI instance or null on failure.
   * @param {string} difficulty - 'EASY', 'MEDIUM', 'HARD', or 'RL'
   * @returns {Promise<object|null>}
   */
  async loadAI(difficulty) {
    this.difficulty = difficulty;
    if (difficulty === 'RL') {
      const onnxAi = new OnnxAI();
      try {
        if (!globalThis.ort) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = ONNX_CDN_URL;
            s.integrity = ONNX_CDN_INTEGRITY;
            s.crossOrigin = 'anonymous';
            s.onload = resolve;
            s.onerror = () => reject(new Error('Failed to load onnxruntime-web CDN'));
            document.head.appendChild(s);
          });
        }
        await onnxAi.load('/models/cannonfall_agent.onnx');
        // Also load the builder model for castle generation
        try {
          const runtime = globalThis.ort;
          this._builderSession = await runtime.InferenceSession.create('/models/builder_agent.onnx');
        } catch (builderErr) {
          console.warn('Builder model load failed (will use presets):', builderErr);
          this._builderSession = null;
        }
      } catch (err) {
        console.warn('RL model load failed:', err);
        return { error: err };
      }
      this.ai = onnxAi;
    } else {
      this.ai = new AI(difficulty);
    }
    return this.ai;
  }

  /**
   * Pick a castle for the AI opponent.
   * In RL mode (castle game mode), uses the trained builder model to generate
   * a castle from a DNA vector. If the result is too sparse, nudges the DNA's
   * structural genes (wall height, density, roof) upward and re-decodes until
   * viable. Falls back to presets only for non-castle modes or if the builder
   * model failed to load.
   */
  async getAICastle(gameMode) {
    if (this._builderSession && gameMode.id === 'castle') {
      try {
        return await this._generateBuilderCastle(gameMode);
      } catch (err) {
        console.warn('Builder inference failed, using preset:', err);
      }
    }
    const presets = gameMode.presets;
    const presetName = presets[Math.floor(Math.random() * presets.length)];
    return getPreset(presetName, gameMode.id);
  }

  /** Run the builder model to generate a castle via DNA decoding. */
  async _generateBuilderCastle(gameMode) {
    const ort = globalThis.ort;

    // Builder observation: [attacker_skill, mode, grid_width, grid_depth, max_layers, budget, max_turns, last_reward]
    const obs = new Float32Array([
      0.4,  // attacker_skill (moderate opponent)
      1.0,  // mode (castle)
      gameMode.gridWidth || 9,
      gameMode.gridDepth || 9,
      gameMode.maxLayers || 8,
      gameMode.budget || 600,
      15.0, // max_turns
      0.0,  // last_reward (first generation)
    ]);

    const tensor = new ort.Tensor('float32', obs, [1, obs.length]);
    const results = await this._builderSession.run({ observation: tensor });
    const dna = Array.from(results.action.data); // 32 floats in [-1, 1]

    const decodeOpts = {
      gridWidth: gameMode.gridWidth || 9,
      gridDepth: gameMode.gridDepth || 9,
      maxLayers: gameMode.maxLayers || 8,
      budget: gameMode.budget || 600,
    };

    let decoded = decodeDNA(dna, decodeOpts);

    // If the model produced a sparse layout, progressively boost structural
    // DNA genes and re-decode. Each pass nudges walls taller, interior denser,
    // and roof wider — preserving the model's other design choices (tower
    // placement, asymmetry, block type mix, etc.).
    const MAX_NUDGES = 3;
    const NUDGE_STEP = 0.3;
    for (let i = 0; i < MAX_NUDGES && decoded.layout.length < MIN_BUILDER_BLOCKS; i++) {
      // [0] perimeterHeight — push walls taller
      dna[0] = Math.min(1, dna[0] + NUDGE_STEP);
      // [4] interiorDensity — fill more interior cells
      dna[4] = Math.min(1, dna[4] + NUDGE_STEP);
      // [5] interiorHeight — raise interior fill layers
      dna[5] = Math.min(1, dna[5] + NUDGE_STEP * 0.5);
      // [6] roofCoverage — add roof if nearly absent
      dna[6] = Math.min(1, dna[6] + NUDGE_STEP * 0.5);

      decoded = decodeDNA(dna, decodeOpts);
    }

    // Add cannonPos (standard position for castle mode)
    const gd = gameMode.gridDepth || 9;
    decoded.cannonPos = { x: (gameMode.gridWidth || 9) - 1, z: Math.floor(gd / 2) };

    return decoded;
  }

  /**
   * Execute the AI's turn: compute aim, animate, then fire.
   * @param {object} options
   * @param {object} options.cannon - The AI's CannonTower
   * @param {object} options.targetPos - The target position to aim at
   * @param {object} options.gameMode - Current game mode config
   * @param {object} options.castle - The player's castle (for block grid data)
   * @param {object} options.battle - BattleController instance
   * @param {object} options.ui - UI instance
   * @param {function} options.schedule - Game._schedule function
   * @param {function} options.getState - () => current game state
   * @param {string} options.aimingState - The state to validate against
   * @param {function} options.onFire - Called after AI fires
   */
  async executeTurn({
    cannon, targetPos, gameMode, castle, battle, ui,
    schedule, getState, aimingState, onFire,
  }) {
    try {
      // Feed block spatial data to RL agent before it aims
      if (this.ai.updateBlockGrid) {
        this.ai.updateBlockGrid(castle);
      }
      const idealAim = await this.ai.computeAim(cannon, targetPos, gameMode);
      const aim = this.ai.applySpread(idealAim);

      await this.ai.startAiming(cannon, aim);
      if (getState() !== aimingState) return; // game was quit

      const hesitation = Math.max(200, (this.ai.difficulty.hesitation || 0.3) * 1000);
      await new Promise(r => { schedule(r, hesitation, aimingState); });
      if (getState() !== aimingState) return;

      battle.power = aim.power;
      battle._perfectShot = false;
      battle.fire(false);
      onFire();
    } catch (err) {
      console.error('AI turn failed:', err);
      ui.setStatus('AI error — firing random shot');
      // Fall back to a random shot so the game doesn't freeze
      const yaw = (Math.random() - 0.5) * Math.PI / 4;
      const pitch = 0.3 + Math.random() * 0.5;
      const power = 20 + Math.random() * 20;
      cannon.yaw = yaw;
      cannon.pitch = pitch;
      cannon.updateAim();
      battle.power = power;
      battle._perfectShot = false;
      battle.fire(false);
      onFire();
    }
  }

  /** Let the AI choose a reposition target. */
  chooseRepositionTarget(castle) {
    return this.ai.chooseRepositionTarget(castle);
  }

  /** Update AI aiming animation (called each frame). */
  updateAiming(dt, cannon) {
    if (this.ai) {
      this.ai.updateAiming(dt, cannon);
    }
  }

  /** Track hit/miss for RL observation state. */
  updateAfterShot(hit, distance) {
    if (this.ai?.updateAfterShot) this.ai.updateAfterShot(hit, distance);
  }

  updateAfterOpponentShot(hit) {
    if (this.ai?.updateAfterOpponentShot) this.ai.updateAfterOpponentShot(hit);
  }

  get aimProgress() {
    return this.ai?._aimProgress ?? 0;
  }

  get targetPower() {
    return this.ai?._targetPower ?? C.MIN_POWER;
  }

  resetGame() {
    if (this.ai?.resetGame) this.ai.resetGame();
  }
}
