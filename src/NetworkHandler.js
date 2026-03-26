import { GAME_MODES } from './GameModes.js';
import * as C from './constants.js';

/**
 * Binds all network event listeners to the game instance.
 * Extracted from Game.js — maps socket events to game state mutations.
 */
export function setupNetworkListeners(game, State) {
  game.network.on('matched', (data) => {
    game.playerIndex = data.playerIndex;
    game.currentTurn = data.firstTurn;
    if (data.gameMode) {
      const modeKey = data.gameMode.toUpperCase();
      if (GAME_MODES[modeKey]) game.gameMode = GAME_MODES[modeKey];
    }
    game.applyGameMode();

    game.castleData[0] = game.getPlayerBuild();
    if (game.castleData[0]) {
      // Already built — send immediately, wait for opponent
      game.network.sendBuildReady(game.castleData[0]);
      game.transition(State.WAITING_OPPONENT_BUILD);
      game.ui.overlay.classList.remove('hidden');
      document.getElementById('build-screen').classList.remove('hidden');
      document.getElementById('build-screen').innerHTML =
        '<h2>Waiting for opponent...</h2><div class="spinner"></div>';
    } else {
      game.startBuildPhase(true);
    }
  });

  game.network.on('lobby:list', (lobbies) => {
    game.ui.updateLobbyList(lobbies);
  });

  game.network.on('lobby:created', () => {
    game.ui.showLobbyHosting();
  });

  game.network.on('lobby:error', ({ message }) => {
    if (game.ui.isPasswordPromptVisible()) {
      game.ui.showPasswordError(message);
    } else {
      game.ui.hidePasswordPrompt();
      game.ui.setStatus(message);
    }
  });

  game.network.on('build-complete', (data) => {
    game.buildBothCastles(data.castles[0], data.castles[1]);
    game.startBattle();
  });

  game.network.on('opponent-fired', (data) => {
    game.battle.handleOpponentFire(data);
    game.transition(State.OPPONENT_FIRING);
    game.battle.updateCamera();
  });

  game.network.on('shot-resolved', (data) => {
    if (data.hit) {
      const damagedPlayer = data.damagedPlayer;
      game.hp = [...data.hp];
      game.ui.updateHP(game.hp[0], game.hp[1]);

      if (game.hp[damagedPlayer] <= 0) {
        const won = damagedPlayer !== game.playerIndex;
        if (game.battle._replayData && game.battle.startReplay()) {
          game.transition(State.REPLAY);
          game._replayStartTime = performance.now();
          game._replayResult = { local: false, won };
          game.ui.setStatus('REPLAY');
        } else {
          game.transition(State.GAME_OVER);
          game.ui.showResult(won);
        }
      } else {
        game.ui.setStatus(`HIT! ${game.hp[damagedPlayer]} hit${game.hp[damagedPlayer] > 1 ? 's' : ''} remaining`);
        if (damagedPlayer === game.playerIndex) {
          setTimeout(() => game.startRepositionPhase(damagedPlayer), C.HIT_DISPLAY_DELAY);
        } else {
          game.transition(State.OPPONENT_TURN);
          game.ui.setStatus('Opponent repositioning...');
        }
      }
    } else {
      game.currentTurn = data.nextTurn;
      game.syncBattle();
      game.onTurnStart();
    }
  });

  game.network.on('game-over', (data) => {
    game.transition(State.GAME_OVER);
    game.ui.showResult(data.winner === game.playerIndex);
  });

  game.network.on('opponent-disconnected', () => {
    game.ui.hideDisconnectBanner();
    game.transition(State.GAME_OVER);
    game.ui.showResult(true, 'Opponent left the game');
  });

  game.network.on('opponent-disconnected-temp', () => {
    game.ui.showDisconnectBanner();
  });

  game.network.on('opponent-reconnected', () => {
    game.ui.hideDisconnectBanner();
  });

  game.network.on('reconnected', (data) => {
    handleReconnect(game, State, data);
  });
}

function handleReconnect(game, State, data) {
  game.mode = 'online';
  game.playerIndex = data.playerIndex;
  game.currentTurn = data.game.currentTurn;

  const gameMode = data.game.gameMode || 'CASTLE';
  const modeKey = typeof gameMode === 'string' ? gameMode.toUpperCase() : 'CASTLE';
  if (GAME_MODES[modeKey]) game.gameMode = GAME_MODES[modeKey];
  game.applyGameMode();

  const { phase, castles, hp } = data.game;

  // If still in build phase, we can't fully restore — go to waiting
  if (phase === 'build' || !castles[0] || !castles[1]) {
    game.transition(State.WAITING_OPPONENT_BUILD);
    game.ui.overlay.classList.remove('hidden');
    document.getElementById('build-screen').classList.remove('hidden');
    document.getElementById('build-screen').innerHTML =
      '<h2>Reconnected — waiting for builds...</h2><div class="spinner"></div>';
    return;
  }

  // Rebuild scene from server state
  game.buildBothCastles(castles[0], castles[1]);
  game.hp = [...hp];
  game.ui.updateHP(game.hp[0], game.hp[1]);
  game.ui.showGame();
  game.syncBattle();
  game.onTurnStart();
}
