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
import { loadIndexHtml } from './helpers/dom.js';

function createGame() {
  loadIndexHtml();
  return new Game(document.getElementById('game-canvas'));
}

function startAIBattle(game, preset0, preset1) {
  game.gameMode = GAME_MODES.CASTLE;
  game.applyGameMode();
  game.mode = 'ai';
  game.aiController.ai = new AI('MEDIUM');
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
      expect(game.aiController.ai).toBeInstanceOf(AI);
      expect(game.playerIndex).toBe(0);
    });

    it('should skip build if castleData[0] already exists', async () => {
      const preset = getPreset('KEEP', 'castle');
      game.castleBuilds.CASTLE = preset;
      await game.startAIMatch();
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
      const aim = game.aiController.ai.computeAim(aiCannon, targetPos, game.gameMode);

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
