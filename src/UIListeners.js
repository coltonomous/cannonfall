import { GAME_MODES } from './GameModes.js';

/**
 * Binds all UI event listeners to the game instance.
 * Extracted from Game.js — pure wiring, no game logic.
 */
export function setupUIListeners(game, State) {
  const ui = game.ui;

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      game.gameMode = GAME_MODES[btn.dataset.mode];
      game.onModeChanged();
    });
  });

  document.getElementById('build-castle-btn')?.addEventListener('click', () => game.buildFromMenu());

  const requireBuild = (startFn) => {
    if (game.hasBuildForCurrentMode()) {
      startFn();
    } else {
      game.flashBuildRequired();
    }
  };

  ui.localMatchBtn.addEventListener('click', () => requireBuild(() => game.startLocal()));
  document.getElementById('ai-match-btn')?.addEventListener('click', () => requireBuild(() => game.startAIMatch()));
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      game.aiDifficulty = btn.dataset.diff;
    });
  });
  ui.onlineMatchBtn.addEventListener('click', () => requireBuild(() => game.startOnline()));

  ui.playAgainBtn.addEventListener('click', () => {
    game.cleanup();
    game.transition(State.MENU);
    ui.showMenu();
  });

  ui.passReadyBtn.addEventListener('click', () => game.onPassDeviceReady());

  ui.hamburgerBtn.addEventListener('click', () => {
    ui.menuPanel.classList.toggle('hidden');
  });

  ui.menuQuitBtn.addEventListener('click', () => {
    ui.menuPanel.classList.add('hidden');
    if (game.state === State.MENU || game.state === State.BUILD ||
        game.state === State.PASS_DEVICE || game.state === State.GAME_OVER) return;
    game.cleanup();
    game.transition(State.MENU);
    ui.showMenu();
  });

  // Debug toggles
  ui.debugPhysics.addEventListener('change', (e) => {
    game.debugPhysics = e.target.checked;
    game.updatePhysicsDebug();
  });

  ui.debugPerfect.addEventListener('change', (e) => {
    game.debugPerfectShot = e.target.checked;
  });

  ui.debugLogs.addEventListener('change', (e) => {
    game.debugLogsEnabled = e.target.checked;
  });

  // ── Lobby UI ──────────────────────────────────────────

  ui.lobbyCreateBtn.addEventListener('click', () => {
    const name = ui.getLobbyName();
    if (!name) { ui.shakeNameInput(); return; }
    ui.lobbyCreateForm.classList.remove('hidden');
    ui.lobbyCreateBtn.classList.add('hidden');
  });

  ui.lobbyCancelCreateBtn.addEventListener('click', () => {
    ui.lobbyCreateForm.classList.add('hidden');
    ui.lobbyCreateBtn.classList.remove('hidden');
  });

  ui.lobbyConfirmCreateBtn.addEventListener('click', () => {
    const name = ui.getLobbyName();
    if (!name) { ui.shakeNameInput(); return; }
    const password = ui.lobbyPasswordInput.value || null;
    game.network.createLobby(name, game.gameMode.id, password);
  });

  ui.lobbyCancelHostBtn.addEventListener('click', () => {
    game.network.cancelLobby();
    ui.hideLobbyHosting();
  });

  ui.lobbyBackBtn.addEventListener('click', () => {
    game.network.leaveLobby();
    game.network.disconnect();
    game.transition(State.MENU);
    ui.showMenu();
  });

  ui.lobbyList.addEventListener('click', (e) => {
    const btn = e.target.closest('.lobby-join-btn');
    if (!btn) return;
    const lobbyId = btn.dataset.lobbyId;
    const hasPassword = btn.dataset.hasPassword === 'true';
    const name = ui.getLobbyName();
    if (!name) { ui.shakeNameInput(); return; }

    if (hasPassword) {
      ui.showPasswordPrompt(lobbyId);
    } else {
      game.network.joinLobby(lobbyId, name, null);
    }
  });

  ui.lobbyJoinConfirmBtn.addEventListener('click', () => {
    const password = ui.lobbyJoinPassword.value;
    const name = ui.getLobbyName();
    if (ui._pendingJoinLobbyId && name) {
      game.network.joinLobby(ui._pendingJoinLobbyId, name, password);
    }
    ui.hidePasswordPrompt();
  });

  ui.lobbyJoinCancelBtn.addEventListener('click', () => {
    ui.hidePasswordPrompt();
  });
}
