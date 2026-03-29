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

  // Com Match: toggle difficulty picker
  const picker = document.getElementById('diff-picker');
  document.getElementById('ai-match-btn')?.addEventListener('click', () => {
    if (picker) picker.classList.toggle('hidden');
  });

  // Difficulty buttons start the AI match directly
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      game.aiDifficulty = btn.dataset.diff;
      if (picker) picker.classList.add('hidden');
      game.startAIMatch();
    });
  });

  ui.localMatchBtn.addEventListener('click', () => game.startLocal());
  ui.onlineMatchBtn.addEventListener('click', () => game.startOnline());

  // Disable online button when offline
  const updateOnlineBtn = () => {
    ui.onlineMatchBtn.disabled = !navigator.onLine || !game.hasBuildForCurrentMode();
  };
  window.addEventListener('online', updateOnlineBtn);
  window.addEventListener('offline', updateOnlineBtn);
  // Also check when match buttons update
  const origUpdate = game.updateMatchButtons.bind(game);
  game.updateMatchButtons = () => { origUpdate(); updateOnlineBtn(); };
  updateOnlineBtn();

  ui.playAgainBtn.addEventListener('click', () => {
    game.cleanup();
    game.transition(State.MENU);
    ui.showMenu();
  });

  ui.passReadyBtn.addEventListener('click', () => game.onPassDeviceReady());

  ui.hamburgerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ui.menuPanel.classList.toggle('hidden');
  });

  // Close debug menu / popups when tapping outside
  document.addEventListener('click', (e) => {
    if (!ui.menuPanel.classList.contains('hidden') &&
        !e.target.closest('#hamburger-menu')) {
      ui.menuPanel.classList.add('hidden');
    }
    if (picker && !picker.classList.contains('hidden') &&
        !e.target.closest('#ai-match-btn') && !e.target.closest('#diff-picker')) {
      picker.classList.add('hidden');
    }
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

  document.getElementById('debug-axes')?.addEventListener('change', (e) => {
    game.toggleAxesHelper(e.target.checked);
  });

  document.getElementById('debug-nextshotwins')?.addEventListener('change', (e) => {
    if (e.target.checked) {
      game.hp = [1, 1];
      game.ui.updateHP(1, 1);
    }
  });

  // Lobby UI

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
