import { GAME_MODES } from './GameModes.js';
import { MAX_HP } from './constants.js';

/**
 * Single source of truth for mutable game state.
 * Shared between Game, BattleController, and NetworkHandler
 * so state doesn't need to be manually synced between them.
 */
export class GameState {
  constructor() {
    this.mode = null;        // 'local' | 'online' | 'ai' | null
    this.playerIndex = 0;
    this.currentTurn = 0;
    this.gameMode = GAME_MODES.CASTLE;
    this.aiDifficulty = 'MEDIUM';

    this.hp = [MAX_HP, MAX_HP];
    this.castles = [null, null];
    this.cannons = [null, null];
    this.castleData = [null, null];
  }

  /** Reset to initial state for a new game. */
  reset() {
    this.hp = [MAX_HP, MAX_HP];
    this.castles = [null, null];
    this.cannons = [null, null];
    this.castleData = [null, null];
  }

  /** Snapshot the state for sync/serialization. */
  snapshot() {
    return {
      castles: this.castles,
      cannons: this.cannons,
      currentTurn: this.currentTurn,
      mode: this.mode,
      playerIndex: this.playerIndex,
      gameMode: this.gameMode,
    };
  }
}
