/**
 * @vitest-environment jsdom
 *
 * Tests for AI match game flow: build → battle → AI turns → win/loss.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('three', async () => await import('./helpers/mock-three.js'));
vi.mock('socket.io-client', () => ({
  io: () => ({ on: () => {}, emit: () => {}, disconnect: () => {} }),
}));

const { Game } = await import('../src/Game.js');
const { GAME_MODES } = await import('../src/GameModes.js');
const { getPreset } = await import('../src/Presets.js');
const { AI } = await import('../src/AI.js');
import * as C from '../src/constants.js';

function setupDOM() {
  document.body.innerHTML = `
    <canvas id="game-canvas"></canvas>
    <div id="overlay">
      <div id="menu-screen" class="screen"></div>
      <div id="lobby-screen" class="screen hidden">
        <input type="text" id="lobby-name-input" />
        <button id="lobby-create-btn"></button>
        <div id="lobby-create-form" class="hidden">
          <input type="password" id="lobby-password-input" />
          <button id="lobby-confirm-create-btn"></button>
          <button id="lobby-cancel-create-btn"></button>
        </div>
        <div id="lobby-hosting" class="hidden"><button id="lobby-cancel-host-btn"></button></div>
        <div id="lobby-list"></div>
        <div id="lobby-password-prompt" class="hidden">
          <input type="password" id="lobby-join-password" />
          <p id="lobby-password-error" class="hidden"></p>
          <button id="lobby-join-confirm-btn"></button>
          <button id="lobby-join-cancel-btn"></button>
        </div>
        <button id="lobby-back-btn"></button>
      </div>
      <div id="matching-screen" class="screen hidden"></div>
      <div id="build-screen" class="screen hidden"></div>
      <div id="pass-device-screen" class="screen hidden">
        <h1 id="pass-title"></h1><button id="pass-ready-btn"></button>
      </div>
      <div id="result-screen" class="screen hidden">
        <h2 id="result-text"></h2><button id="play-again-btn"></button>
      </div>
    </div>
    <div id="game-ui" class="hidden">
      <button id="hamburger-btn"></button>
      <div id="menu-panel" class="hidden"></div>
      <button id="menu-quit-btn"></button>
      <div id="hp-left" class="hp-bar">
        <span class="hp-icon full">♥</span><span class="hp-icon full">♥</span><span class="hp-icon full">♥</span>
      </div>
      <div id="hp-right" class="hp-bar">
        <span class="hp-icon full">♥</span><span class="hp-icon full">♥</span><span class="hp-icon full">♥</span>
      </div>
      <div id="turn-indicator"></div>
      <div id="status-text"></div>
      <div id="controls-hint"></div>
      <div id="power-sweet-spot"></div>
      <div id="power-fill"></div>
      <span id="power-value"></span>
      <div id="minimap-frame"></div>
      <input type="checkbox" id="debug-physics">
      <input type="checkbox" id="debug-perfect">
      <input type="checkbox" id="debug-logs">
    </div>
    <div class="mode-selector">
      <button class="mode-btn selected" data-mode="CASTLE"></button>
      <button class="mode-btn" data-mode="PIRATE"></button>
      <button class="mode-btn" data-mode="SPACE"></button>
    </div>
    <button id="build-castle-btn"></button>
    <p id="castle-ready-label" class="hidden"></p>
    <div class="ai-difficulty">
      <button class="diff-btn" data-diff="EASY"></button>
      <button class="diff-btn selected" data-diff="MEDIUM"></button>
      <button class="diff-btn" data-diff="HARD"></button>
    </div>
    <button id="ai-match-btn"></button>
    <button id="local-match-btn"></button>
    <button id="online-match-btn"></button>
  `;
}

function createGame() {
  setupDOM();
  return new Game(document.getElementById('game-canvas'));
}

function startAIBattle(game, preset0, preset1) {
  game.gameMode = GAME_MODES.CASTLE;
  game.applyGameMode();
  game.mode = 'ai';
  game.ai = new AI('MEDIUM');
  game.playerIndex = 0;
  game.buildBothCastles(preset0, preset1);
  game.hp = [C.MAX_HP, C.MAX_HP];
  game.ui.updateHP(C.MAX_HP, C.MAX_HP);
  game.ui.showGame();
}

describe('AI Game Flow', () => {
  let game;

  beforeEach(() => {
    game = createGame();
  });

  describe('startAIMatch', () => {
    it('should set mode to ai and create AI instance', () => {
      game.startAIMatch();
      expect(game.mode).toBe('ai');
      expect(game.ai).toBeInstanceOf(AI);
      expect(game.playerIndex).toBe(0);
    });

    it('should skip build if castleData[0] already exists', () => {
      const preset = getPreset('KEEP', 'castle');
      game.castleData[0] = preset;
      game.startAIMatch();
      // Should go directly to battle, not build phase
      expect(game.castles[0]).not.toBeNull();
      expect(game.castles[1]).not.toBeNull();
    });
  });

  describe('AI turn flow', () => {
    it('should enter AI_AIMING when it is AI turn (currentTurn=1)', () => {
      const preset = getPreset('KEEP', 'castle');
      startAIBattle(game, preset, preset);
      // Set state to turn_transition so onTurnStart can transition to ai_aiming
      game.state = 'turn_transition';
      game.currentTurn = 1;
      game.syncBattle();
      game.onTurnStart();
      expect(game.state).toBe('ai_aiming');
    });

    it('should enter MY_TURN when it is player turn (currentTurn=0)', () => {
      const preset = getPreset('KEEP', 'castle');
      startAIBattle(game, preset, preset);
      game.state = 'turn_transition';
      game.currentTurn = 0;
      game.syncBattle();
      game.onTurnStart();
      expect(game.state).toBe('my_turn');
    });
  });

  describe('AI aiming integration', () => {
    it('AI should compute valid aim for CASTLE mode target', () => {
      const preset = getPreset('KEEP', 'castle');
      startAIBattle(game, preset, preset);
      game.currentTurn = 1;
      game.syncBattle();

      const aiCannon = game.cannons[1];
      const targetPos = game.castles[0].getTargetPosition();
      const aim = game.ai.computeAim(aiCannon, targetPos, game.gameMode);

      expect(aim.power).toBeGreaterThanOrEqual(C.MIN_POWER);
      expect(aim.power).toBeLessThanOrEqual(C.MAX_POWER);
      expect(aim.pitch).toBeGreaterThanOrEqual(C.MIN_PITCH);
      expect(aim.pitch).toBeLessThanOrEqual(C.MAX_PITCH);
      expect(Number.isFinite(aim.yaw)).toBe(true);
    });
  });

  describe('prebuild flow', () => {
    it('buildFromMenu should set _prebuild flag and enter BUILD state', () => {
      game.buildFromMenu();
      expect(game.state).toBe('build');
      expect(game._prebuild).toBe(true);
    });

    it('onBuildComplete in prebuild mode should return to MENU', () => {
      game.buildFromMenu();
      const castleData = { layout: [], target: { x: 4, y: 0, z: 4 }, cannonPos: { x: 8, z: 4 } };
      game.onBuildComplete(castleData);
      expect(game.state).toBe('menu');
      expect(game.castleData[0]).toEqual(castleData);
      expect(game._prebuild).toBe(false);
    });
  });

  describe('onShotMiss in AI mode', () => {
    it('should alternate turns on miss', () => {
      const preset = getPreset('KEEP', 'castle');
      startAIBattle(game, preset, preset);
      game.currentTurn = 0;
      game.state = 'firing';
      game.onShotMiss();
      expect(game.state).toBe('turn_transition');
    });
  });

  describe('onTargetHit in AI mode', () => {
    it('should show win for player when AI castle destroyed', () => {
      const preset = getPreset('KEEP', 'castle');
      startAIBattle(game, preset, preset);
      game.currentTurn = 0; // player fires
      game.state = 'firing';
      game.hp = [3, 1]; // AI has 1 HP left
      game.battle._perfectShot = false;
      game.battle._replayData = null; // skip replay for this test
      game.onTargetHit();
      // HP[1] should be 0, should be game over
      expect(game.hp[1]).toBe(0);
    });

    it('should show loss for player when player castle destroyed', () => {
      const preset = getPreset('KEEP', 'castle');
      startAIBattle(game, preset, preset);
      game.currentTurn = 1; // AI fires
      game.state = 'ai_firing';
      game.hp = [1, 3]; // Player has 1 HP left
      game.battle._perfectShot = false;
      game.battle._replayData = null;
      game.onTargetHit();
      expect(game.hp[0]).toBe(0);
    });
  });

  describe('AI auto-reposition', () => {
    it('should auto-reposition AI castle without user interaction', () => {
      const preset = getPreset('KEEP', 'castle');
      startAIBattle(game, preset, preset);
      game.currentTurn = 0;
      game.syncBattle();

      // Simulate the reposition phase for AI (player 1)
      // startRepositionPhase should auto-complete for AI
      const castleBefore = game.castles[1];
      expect(castleBefore).not.toBeNull();

      // This should NOT enter REPOSITION state for AI — should auto-complete
      game.startRepositionPhase(1);
      // State should have moved past reposition (onRepositionComplete calls onTurnStart)
      expect(game.state).not.toBe('reposition');
    });
  });
});
