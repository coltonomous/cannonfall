export class UI {
  constructor() {
    // Cache all DOM element references
    this.overlay = document.getElementById('overlay');
    this.gameUI = document.getElementById('game-ui');

    // Screens
    this.menuScreen = document.getElementById('menu-screen');
    this.matchingScreen = document.getElementById('matching-screen');
    this.buildScreen = document.getElementById('build-screen');
    this.passScreen = document.getElementById('pass-device-screen');
    this.resultScreen = document.getElementById('result-screen');

    // Elements
    this.localMatchBtn = document.getElementById('local-match-btn');
    this.onlineMatchBtn = document.getElementById('online-match-btn');
    this.passReadyBtn = document.getElementById('pass-ready-btn');
    this.playAgainBtn = document.getElementById('play-again-btn');
    this.resultText = document.getElementById('result-text');
    this.turnIndicator = document.getElementById('turn-indicator');
    this.powerFill = document.getElementById('power-fill');
    this.powerValue = document.getElementById('power-value');
    this.statusText = document.getElementById('status-text');
    this.passTitle = document.getElementById('pass-title'); // "Pass to Player X"
    this.hamburgerBtn = document.getElementById('hamburger-btn');
    this.menuPanel = document.getElementById('menu-panel');
    this.menuQuitBtn = document.getElementById('menu-quit-btn');
    this.debugPhysics = document.getElementById('debug-physics');
    this.debugPerfect = document.getElementById('debug-perfect');
    this.debugLogs = document.getElementById('debug-logs');
    this.hpLeft = document.getElementById('hp-left');
    this.hpRight = document.getElementById('hp-right');
    this.minimapFrame = document.getElementById('minimap-frame');

    // Lobby screen
    this.lobbyScreen = document.getElementById('lobby-screen');
    this.lobbyNameInput = document.getElementById('lobby-name-input');
    this.lobbyCreateBtn = document.getElementById('lobby-create-btn');
    this.lobbyCreateForm = document.getElementById('lobby-create-form');
    this.lobbyPasswordInput = document.getElementById('lobby-password-input');
    this.lobbyConfirmCreateBtn = document.getElementById('lobby-confirm-create-btn');
    this.lobbyCancelCreateBtn = document.getElementById('lobby-cancel-create-btn');
    this.lobbyHosting = document.getElementById('lobby-hosting');
    this.lobbyCancelHostBtn = document.getElementById('lobby-cancel-host-btn');
    this.lobbyList = document.getElementById('lobby-list');
    this.lobbyPasswordPrompt = document.getElementById('lobby-password-prompt');
    this.lobbyJoinPassword = document.getElementById('lobby-join-password');
    this.lobbyJoinConfirmBtn = document.getElementById('lobby-join-confirm-btn');
    this.lobbyJoinCancelBtn = document.getElementById('lobby-join-cancel-btn');
    this.lobbyBackBtn = document.getElementById('lobby-back-btn');
    this.lobbyPasswordError = document.getElementById('lobby-password-error');
    this._pendingJoinLobbyId = null;
  }

  hideAllScreens() {
    // Hide all overlay screens
    [this.menuScreen, this.matchingScreen, this.buildScreen, this.passScreen, this.resultScreen, this.lobbyScreen]
      .forEach(s => s && s.classList.add('hidden'));
  }

  showMenu() {
    this.overlay.classList.remove('hidden');
    this.gameUI.classList.add('hidden');
    this.hideAllScreens();
    this.menuScreen.classList.remove('hidden');
  }

  showMatchmaking() {
    this.hideAllScreens();
    this.matchingScreen.classList.remove('hidden');
  }

  showPassDevice(playerNumber) {
    this.overlay.classList.remove('hidden');
    this.gameUI.classList.add('hidden');
    this.hideAllScreens();
    this.passScreen.classList.remove('hidden');
    if (this.passTitle) {
      this.passTitle.textContent = `Pass to Player ${playerNumber}`;
    }
  }

  showGame() {
    this.overlay.classList.add('hidden');
    this.gameUI.classList.remove('hidden');
  }

  showResult(won) {
    this.overlay.classList.remove('hidden');
    this.gameUI.classList.add('hidden');
    this.hideAllScreens();
    this.resultScreen.classList.remove('hidden');
    this.resultText.textContent = won ? 'YOU WIN!' : 'YOU LOSE!';
  }

  // For local mode, show "Player X Wins!"
  showLocalResult(winnerNumber) {
    this.overlay.classList.remove('hidden');
    this.gameUI.classList.add('hidden');
    this.hideAllScreens();
    this.resultScreen.classList.remove('hidden');
    this.resultText.textContent = `Player ${winnerNumber} Wins!`;
  }

  setTurn(isMyTurn, playerNumber) {
    if (playerNumber !== undefined) {
      // Local mode: show player number
      this.turnIndicator.textContent = `PLAYER ${playerNumber}'S TURN`;
      this.turnIndicator.className = isMyTurn ? 'my-turn' : 'their-turn';
    } else {
      this.turnIndicator.textContent = isMyTurn ? 'YOUR TURN - Aim and Fire!' : "OPPONENT'S TURN";
      this.turnIndicator.className = isMyTurn ? 'my-turn' : 'their-turn';
    }
  }

  updatePower(power, min, max) {
    const pct = ((power - min) / (max - min)) * 100;
    this.powerFill.style.height = pct + '%';
    this.powerValue.textContent = Math.round(power);
  }

  updateHP(hp0, hp1) {
    const icons0 = this.hpLeft.querySelectorAll('.hp-icon');
    const icons1 = this.hpRight.querySelectorAll('.hp-icon');
    icons0.forEach((icon, i) => {
      icon.className = i < hp0 ? 'hp-icon full' : 'hp-icon empty';
    });
    icons1.forEach((icon, i) => {
      icon.className = i < hp1 ? 'hp-icon full' : 'hp-icon empty';
    });
  }

  setStatus(text) {
    this.statusText.textContent = text || '';
  }

  setControlsHint(isTouch) {
    const el = document.getElementById('controls-hint');
    if (!el) return;
    if (isTouch) {
      el.innerHTML = '<span>Swipe: Aim</span><span>Hold &amp; Release: Fire</span>';
    } else {
      el.innerHTML = '<span>WASD/Arrows: Aim</span><span>Hold Space: Charge &amp; Release to Fire</span>';
    }
  }

  // ── Lobby ───────────────────────────────────────────

  showLobby() {
    this.overlay.classList.remove('hidden');
    this.gameUI.classList.add('hidden');
    this.hideAllScreens();
    this.lobbyScreen.classList.remove('hidden');
    const savedName = sessionStorage.getItem('cannonfall-name') || '';
    this.lobbyNameInput.value = savedName;
    this.lobbyCreateForm.classList.add('hidden');
    this.lobbyHosting.classList.add('hidden');
    this.lobbyPasswordPrompt.classList.add('hidden');
    this.lobbyCreateBtn.classList.remove('hidden');
    this.lobbyNameInput.disabled = false;
  }

  showLobbyHosting() {
    this.lobbyCreateBtn.classList.add('hidden');
    this.lobbyCreateForm.classList.add('hidden');
    this.lobbyHosting.classList.remove('hidden');
    this.lobbyNameInput.disabled = true;
  }

  hideLobbyHosting() {
    this.lobbyHosting.classList.add('hidden');
    this.lobbyCreateBtn.classList.remove('hidden');
    this.lobbyNameInput.disabled = false;
  }

  updateLobbyList(lobbies) {
    this.lobbyList.innerHTML = '';
    if (lobbies.length === 0) {
      this.lobbyList.innerHTML = '<p class="lobby-empty">No open games. Create one!</p>';
      return;
    }
    for (const lobby of lobbies) {
      const row = document.createElement('div');
      row.className = 'lobby-row';
      row.innerHTML = `
        <div class="lobby-row-info">
          <div class="lobby-host-name">${this._escapeHtml(lobby.hostName)}</div>
          <div class="lobby-mode-tag">${lobby.gameMode}</div>
        </div>
        ${lobby.hasPassword ? '<span class="lobby-lock">&#128274;</span>' : ''}
        <button class="lobby-join-btn" data-lobby-id="${lobby.id}" data-has-password="${lobby.hasPassword}">Join</button>
      `;
      this.lobbyList.appendChild(row);
    }
  }

  showPasswordPrompt(lobbyId) {
    this._pendingJoinLobbyId = lobbyId;
    this.lobbyJoinPassword.value = '';
    if (this.lobbyPasswordError) this.lobbyPasswordError.classList.add('hidden');
    this.lobbyPasswordPrompt.classList.remove('hidden');
    this.lobbyJoinPassword.focus();
  }

  hidePasswordPrompt() {
    this._pendingJoinLobbyId = null;
    this.lobbyPasswordPrompt.classList.add('hidden');
    if (this.lobbyPasswordError) this.lobbyPasswordError.classList.add('hidden');
  }

  isPasswordPromptVisible() {
    return this._pendingJoinLobbyId !== null && !this.lobbyPasswordPrompt.classList.contains('hidden');
  }

  showPasswordError(message) {
    if (this.lobbyPasswordError) {
      this.lobbyPasswordError.textContent = message;
      this.lobbyPasswordError.classList.remove('hidden');
    }
    this.lobbyJoinPassword.value = '';
    this.lobbyJoinPassword.focus();
  }

  getLobbyName() {
    const name = this.lobbyNameInput.value.trim();
    if (name) sessionStorage.setItem('cannonfall-name', name);
    return name;
  }

  shakeNameInput() {
    this.lobbyNameInput.classList.remove('shake');
    // Force reflow so re-adding the class restarts the animation
    void this.lobbyNameInput.offsetWidth;
    this.lobbyNameInput.classList.add('shake');
    this.lobbyNameInput.focus();
    this.lobbyNameInput.setAttribute('placeholder', 'Enter a name first');
    setTimeout(() => {
      this.lobbyNameInput.classList.remove('shake');
      this.lobbyNameInput.setAttribute('placeholder', 'Your name');
    }, 1500);
  }

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
