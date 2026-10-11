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
      game.ui.showWaitingScreen('Waiting for opponent...');
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
    if (!data.hit) {
      game.currentTurn = data.nextTurn;
      game.syncBattle();
      game.onTurnStart();
      return;
    }

    // Non-lethal hit (a lethal one arrives as game-over): the damaged player
    // repositions their target, then reposition-done starts the next turn.
    const { damagedPlayer } = data;
    game.hp = [...data.hp];
    game.ui.updateHP(game.hp[0], game.hp[1]);
    const left = game.hp[damagedPlayer];
    game.ui.setStatus(`HIT! ${left} hit${left > 1 ? 's' : ''} remaining`);
    if (damagedPlayer === game.playerIndex) {
      game._schedule(() => game.startRepositionPhase(damagedPlayer), C.HIT_DISPLAY_DELAY,
        State.OPPONENT_FIRING, State.OPPONENT_TURN);
    } else {
      game.transition(State.OPPONENT_TURN);
      game.ui.setStatus('Opponent repositioning...');
    }
  });

  game.network.on('reposition-done', ({ player, targetPos, nextTurn }) => {
    const castle = game.castles[player];
    if (!castle) return;
    game.applyReposition(player, castle.mirrorGridPos(targetPos), nextTurn);
  });

  game.network.on('game-over', (data) => {
    game.transition(State.GAME_OVER);
    game.ui.showResult(data.winner === game.playerIndex);
  });

  game.network.on('opponent-disconnected', () => {
    game.endOnlineGame('Opponent left the game');
  });

  game.network.on('server-shutdown', () => {
    if (game.mode !== 'online' || game.state === State.MENU || game.state === State.GAME_OVER) return;
    game.endOnlineGame('Server restarted, game ended');
  });

  game.network.on('opponent-disconnected-temp', () => {
    game.ui.showDisconnectBanner();
  });

  game.network.on('opponent-reconnected', () => {
    game.ui.hideDisconnectBanner();
  });

  game.network.on('connection-lost', () => {
    if (game.mode === 'online') {
      game.ui.showConnectionLost();
    }
  });

  game.network.on('connection-restored', () => {
    game.ui.hideConnectionLost();
  });

  game.network.on('reconnected', (data) => {
    handleReconnect(game, State, data);
  });
}

/** Rebuild the game from the server's snapshot after a reload or dropped connection. */
function handleReconnect(game, State, data) {
  const { phase, castles, hp, currentTurn, repositioningPlayer, gameMode } = data.game;
  const me = data.playerIndex;

  // Still building after a dropped connection: nothing was lost
  if (phase === 'build' && game.state === State.BUILD) return;

  game.resetForResync();
  game.mode = 'online';
  game.playerIndex = me;
  game.currentTurn = currentTurn;
  const modeKey = typeof gameMode === 'string' ? gameMode.toUpperCase() : 'CASTLE';
  if (GAME_MODES[modeKey]) game.gameMode = GAME_MODES[modeKey];
  game.applyGameMode();

  if (phase === 'build') {
    if (castles[me]) {
      game.transition(State.WAITING_OPPONENT_BUILD);
      game.ui.showWaitingScreen('Reconnected — waiting for opponent...');
    } else {
      game.startBuildPhase(true);
    }
    return;
  }

  // Rebuild scene from server state
  game.buildBothCastles(castles[0], castles[1]);
  game.hp = [...hp];
  game.ui.updateHP(game.hp[0], game.hp[1]);
  game.ui.showGame();
  game.syncBattle();

  if (phase === 'reposition') {
    game.transition(State.OPPONENT_TURN);
    if (repositioningPlayer === me) {
      game.startRepositionPhase(me);
    } else {
      game.ui.setStatus('Opponent repositioning...');
    }
    return;
  }

  game.onTurnStart();
}
