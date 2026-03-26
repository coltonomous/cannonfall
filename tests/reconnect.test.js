import { describe, it, expect, beforeEach } from 'vitest';
import { GAME_MODES } from '../src/GameModes.js';

// ── Replicated handleReconnect logic from NetworkHandler.js ─

function handleReconnect(game, State, data) {
  game.mode = 'online';
  game.playerIndex = data.playerIndex;
  game.currentTurn = data.game.currentTurn;

  const gameMode = data.game.gameMode || 'CASTLE';
  const modeKey = typeof gameMode === 'string' ? gameMode.toUpperCase() : 'CASTLE';
  if (GAME_MODES[modeKey]) game.gameMode = GAME_MODES[modeKey];
  game.applyGameMode();

  const { phase, castles, hp } = data.game;

  if (phase === 'build' || !castles[0] || !castles[1]) {
    game._reconnectResult = 'waiting_build';
    return;
  }

  game.buildBothCastles(castles[0], castles[1]);
  game.hp = [...hp];

  if (phase === 'reposition') {
    const damagedPlayer = data.game.currentTurn;
    if (damagedPlayer === game.playerIndex) {
      game._reconnectResult = 'reposition_self';
      game.startRepositionPhase(damagedPlayer);
    } else {
      game._reconnectResult = 'reposition_opponent';
    }
    return;
  }

  game._reconnectResult = 'battle';
  game.onTurnStart();
}

// ── Mock game object ─────────────────────────────────

function makeGame() {
  return {
    mode: null,
    playerIndex: -1,
    currentTurn: -1,
    gameMode: null,
    hp: [3, 3],
    _reconnectResult: null,
    _applyModeCalled: false,
    _builtCastles: null,
    _repositionPlayer: null,
    _turnStarted: false,
    applyGameMode() { this._applyModeCalled = true; },
    buildBothCastles(c0, c1) { this._builtCastles = [c0, c1]; },
    startRepositionPhase(p) { this._repositionPlayer = p; },
    onTurnStart() { this._turnStarted = true; },
    syncBattle() {},
    ui: { showGame() {}, setStatus() {}, updateHP() {} },
    transition() {},
  };
}

const State = {
  WAITING_OPPONENT_BUILD: 'waiting_build',
  OPPONENT_TURN: 'opponent_turn',
};

// ── Tests ────────────────────────────────────────────

describe('Reconnection Flow', () => {
  let game;
  beforeEach(() => { game = makeGame(); });

  describe('build phase reconnect', () => {
    it('enters waiting state when phase is build', () => {
      handleReconnect(game, State, {
        playerIndex: 0,
        game: { phase: 'build', currentTurn: 0, castles: [null, null], hp: [3, 3], gameMode: 'castle' },
      });
      expect(game._reconnectResult).toBe('waiting_build');
      expect(game._builtCastles).toBeNull();
    });

    it('enters waiting state when castles are missing', () => {
      handleReconnect(game, State, {
        playerIndex: 1,
        game: { phase: 'battle', currentTurn: 0, castles: [{ layout: [] }, null], hp: [3, 3], gameMode: 'castle' },
      });
      expect(game._reconnectResult).toBe('waiting_build');
    });
  });

  describe('battle phase reconnect', () => {
    it('rebuilds castles and starts turn', () => {
      const c0 = { layout: [{ x: 0, y: 0, z: 0, type: 'CUBE' }], target: { x: 4, z: 4 } };
      const c1 = { layout: [{ x: 1, y: 0, z: 1, type: 'WALL' }], target: { x: 5, z: 5 } };
      handleReconnect(game, State, {
        playerIndex: 0,
        game: { phase: 'battle', currentTurn: 1, castles: [c0, c1], hp: [2, 3], gameMode: 'pirate' },
      });
      expect(game._reconnectResult).toBe('battle');
      expect(game._builtCastles).toEqual([c0, c1]);
      expect(game.hp).toEqual([2, 3]);
      expect(game._turnStarted).toBe(true);
      expect(game.gameMode).toBe(GAME_MODES.PIRATE);
    });

    it('sets correct player state', () => {
      const castle = { layout: [], target: { x: 0, z: 0 } };
      handleReconnect(game, State, {
        playerIndex: 1,
        game: { phase: 'battle', currentTurn: 0, castles: [castle, castle], hp: [1, 2], gameMode: 'space' },
      });
      expect(game.mode).toBe('online');
      expect(game.playerIndex).toBe(1);
      expect(game.currentTurn).toBe(0);
      expect(game.gameMode).toBe(GAME_MODES.SPACE);
    });
  });

  describe('reposition phase reconnect', () => {
    it('starts reposition when damaged player is self', () => {
      const castle = { layout: [], target: { x: 0, z: 0 } };
      handleReconnect(game, State, {
        playerIndex: 0,
        game: { phase: 'reposition', currentTurn: 0, castles: [castle, castle], hp: [2, 3], gameMode: 'castle' },
      });
      expect(game._reconnectResult).toBe('reposition_self');
      expect(game._repositionPlayer).toBe(0);
      expect(game._turnStarted).toBe(false);
    });

    it('waits when opponent is repositioning', () => {
      const castle = { layout: [], target: { x: 0, z: 0 } };
      handleReconnect(game, State, {
        playerIndex: 0,
        game: { phase: 'reposition', currentTurn: 1, castles: [castle, castle], hp: [3, 2], gameMode: 'castle' },
      });
      expect(game._reconnectResult).toBe('reposition_opponent');
      expect(game._repositionPlayer).toBeNull();
      expect(game._turnStarted).toBe(false);
    });
  });

  describe('game mode handling', () => {
    it('defaults to CASTLE when gameMode is missing', () => {
      const castle = { layout: [], target: { x: 0, z: 0 } };
      handleReconnect(game, State, {
        playerIndex: 0,
        game: { phase: 'battle', currentTurn: 0, castles: [castle, castle], hp: [3, 3] },
      });
      expect(game.gameMode).toBe(GAME_MODES.CASTLE);
    });

    it('applies game mode on reconnect', () => {
      const castle = { layout: [], target: { x: 0, z: 0 } };
      handleReconnect(game, State, {
        playerIndex: 0,
        game: { phase: 'battle', currentTurn: 0, castles: [castle, castle], hp: [3, 3], gameMode: 'pirate' },
      });
      expect(game._applyModeCalled).toBe(true);
    });

    it('handles case-insensitive game mode strings', () => {
      const castle = { layout: [], target: { x: 0, z: 0 } };
      handleReconnect(game, State, {
        playerIndex: 0,
        game: { phase: 'battle', currentTurn: 0, castles: [castle, castle], hp: [3, 3], gameMode: 'Space' },
      });
      expect(game.gameMode).toBe(GAME_MODES.SPACE);
    });
  });
});
