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
  }

  hideAllScreens() {
    // Hide all overlay screens
    [this.menuScreen, this.matchingScreen, this.buildScreen, this.passScreen, this.resultScreen]
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
}
