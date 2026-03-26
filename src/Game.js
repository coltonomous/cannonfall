import * as THREE from 'three';
import { SceneManager } from './SceneManager.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Castle } from './Castle.js';
import { CannonTower } from './CannonTower.js';
import { Network } from './Network.js';
import { UI } from './UI.js';
import { GAME_MODES } from './GameModes.js';
import { ParticleManager } from './ParticleManager.js';
import { CastleBuilder } from './CastleBuilder.js';
import { TargetRepositioner } from './TargetRepositioner.js';
import { InputHandler } from './InputHandler.js';
import { BattleController } from './BattleController.js';
import * as C from './constants.js';

const State = {
  MENU: 'menu',
  BUILD: 'build',
  PASS_DEVICE: 'pass_device',
  WAITING_OPPONENT_BUILD: 'waiting_build',
  MY_TURN: 'my_turn',
  FIRING: 'firing',
  OPPONENT_TURN: 'opponent_turn',
  OPPONENT_FIRING: 'opponent_firing',
  REPOSITION: 'reposition',
  PASS_DEVICE_REPOSITION: 'pass_device_reposition',
  TURN_TRANSITION: 'turn_transition',
  GAME_OVER: 'game_over',
};

const VALID_TRANSITIONS = {
  [State.MENU]:                  [State.BUILD, State.MY_TURN, State.OPPONENT_TURN, State.WAITING_OPPONENT_BUILD],
  [State.BUILD]:                 [State.PASS_DEVICE, State.WAITING_OPPONENT_BUILD, State.MY_TURN, State.OPPONENT_TURN],
  [State.PASS_DEVICE]:           [State.BUILD],
  [State.WAITING_OPPONENT_BUILD]:[State.MY_TURN, State.OPPONENT_TURN],
  [State.MY_TURN]:               [State.FIRING, State.GAME_OVER, State.MENU],
  [State.FIRING]:                [State.GAME_OVER, State.PASS_DEVICE_REPOSITION, State.TURN_TRANSITION, State.OPPONENT_TURN, State.MY_TURN, State.REPOSITION],
  [State.OPPONENT_TURN]:         [State.OPPONENT_FIRING, State.REPOSITION, State.MY_TURN, State.GAME_OVER, State.MENU],
  [State.OPPONENT_FIRING]:       [State.GAME_OVER, State.REPOSITION, State.MY_TURN, State.OPPONENT_TURN, State.TURN_TRANSITION],
  [State.REPOSITION]:            [State.MY_TURN, State.OPPONENT_TURN],
  [State.PASS_DEVICE_REPOSITION]:[State.REPOSITION],
  [State.TURN_TRANSITION]:       [State.MY_TURN, State.OPPONENT_TURN],
  [State.GAME_OVER]:             [State.MENU],
};

export class Game {
  constructor(canvas) {
    this.sceneManager = new SceneManager(canvas);
    this.physicsWorld = new PhysicsWorld();
    this.network = new Network();
    this.ui = new UI();
    this.input = new InputHandler();
    this.input.setupTouchListeners(canvas);
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.particles = new ParticleManager(this.sceneManager.scene);

    this.state = State.MENU;
    this.gameMode = GAME_MODES.CASTLE;
    this.mode = null; // 'local' or 'online'
    this.playerIndex = 0;
    this.currentTurn = 0;

    this.castles = [null, null];
    this.cannons = [null, null];
    this.castleData = [null, null];

    this.hp = [C.MAX_HP, C.MAX_HP];

    // Castle builder & repositioner
    this.builder = new CastleBuilder(this.sceneManager);
    this.repositioner = new TargetRepositioner(this.sceneManager);

    // Battle controller
    this.battle = new BattleController({
      sceneManager: this.sceneManager,
      physicsWorld: this.physicsWorld,
      particles: this.particles,
      ui: this.ui,
      network: this.network,
    });
    this.battle.setCallbacks({
      onHitLocal: () => this.onTargetHit(),
      onShotMiss: () => this.onShotMiss(),
      onReportShot: (hit, perfect) => {
        this.network.sendShotResult(hit, perfect);
      },
      debugLog: (...args) => this.debugLog(...args),
    });

    // Debug
    this.debugPhysics = false;
    this.debugPerfectShot = false;
    this.debugLogsEnabled = false;

    this.setupUIListeners();
    this.setupNetworkListeners();
    this.attemptReconnect();

    this.clock = new THREE.Clock();
  }

  attemptReconnect() {
    // If we have a persisted session, try connecting to see if the server
    // has an active game for us. The 'reconnected' handler takes over if so.
    if (sessionStorage.getItem('cannonfall-session')) {
      this.network.connect(3000).catch(() => {});
    }
  }

  // ── State Machine ───────────────────────────────────────

  transition(newState) {
    const valid = VALID_TRANSITIONS[this.state];
    if (!valid || !valid.includes(newState)) {
      console.warn(`[Cannonfall] Invalid state transition: ${this.state} → ${newState}`);
      return false;
    }
    this.debugLog(`State: ${this.state} → ${newState}`);
    this.state = newState;
    return true;
  }

  // ── UI Listeners ─────────────────────────────────────────

  setupUIListeners() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.gameMode = GAME_MODES[btn.dataset.mode];
      });
    });

    this.ui.localMatchBtn.addEventListener('click', () => this.startLocal());
    this.ui.onlineMatchBtn.addEventListener('click', () => this.startOnline());

    this.ui.playAgainBtn.addEventListener('click', () => {
      this.cleanup();
      this.transition(State.MENU);
      this.ui.showMenu();
    });

    this.ui.passReadyBtn.addEventListener('click', () => this.onPassDeviceReady());

    this.ui.hamburgerBtn.addEventListener('click', () => {
      this.ui.menuPanel.classList.toggle('hidden');
    });

    this.ui.menuQuitBtn.addEventListener('click', () => {
      this.ui.menuPanel.classList.add('hidden');
      if (this.state === State.MENU || this.state === State.BUILD ||
          this.state === State.PASS_DEVICE || this.state === State.GAME_OVER) return;
      this.cleanup();
      this.transition(State.MENU);
      this.ui.showMenu();
    });

    // Debug toggles
    this.ui.debugPhysics.addEventListener('change', (e) => {
      this.debugPhysics = e.target.checked;
      this.updatePhysicsDebug();
    });

    this.ui.debugPerfect.addEventListener('change', (e) => {
      this.debugPerfectShot = e.target.checked;
    });

    this.ui.debugLogs.addEventListener('change', (e) => {
      this.debugLogsEnabled = e.target.checked;
    });

    // ── Lobby UI ──────────────────────────────────────────

    this.ui.lobbyCreateBtn.addEventListener('click', () => {
      const name = this.ui.getLobbyName();
      if (!name) { this.ui.shakeNameInput(); return; }
      this.ui.lobbyCreateForm.classList.remove('hidden');
      this.ui.lobbyCreateBtn.classList.add('hidden');
    });

    this.ui.lobbyCancelCreateBtn.addEventListener('click', () => {
      this.ui.lobbyCreateForm.classList.add('hidden');
      this.ui.lobbyCreateBtn.classList.remove('hidden');
    });

    this.ui.lobbyConfirmCreateBtn.addEventListener('click', () => {
      const name = this.ui.getLobbyName();
      if (!name) { this.ui.shakeNameInput(); return; }
      const password = this.ui.lobbyPasswordInput.value || null;
      this.network.createLobby(name, this.gameMode.id, password);
    });

    this.ui.lobbyCancelHostBtn.addEventListener('click', () => {
      this.network.cancelLobby();
      this.ui.hideLobbyHosting();
    });

    this.ui.lobbyBackBtn.addEventListener('click', () => {
      this.network.leaveLobby();
      this.network.disconnect();
      this.transition(State.MENU);
      this.ui.showMenu();
    });

    this.ui.lobbyList.addEventListener('click', (e) => {
      const btn = e.target.closest('.lobby-join-btn');
      if (!btn) return;
      const lobbyId = btn.dataset.lobbyId;
      const hasPassword = btn.dataset.hasPassword === 'true';
      const name = this.ui.getLobbyName();
      if (!name) { this.ui.shakeNameInput(); return; }

      if (hasPassword) {
        this.ui.showPasswordPrompt(lobbyId);
      } else {
        this.network.joinLobby(lobbyId, name, null);
      }
    });

    this.ui.lobbyJoinConfirmBtn.addEventListener('click', () => {
      const password = this.ui.lobbyJoinPassword.value;
      const name = this.ui.getLobbyName();
      if (this.ui._pendingJoinLobbyId && name) {
        this.network.joinLobby(this.ui._pendingJoinLobbyId, name, password);
      }
      this.ui.hidePasswordPrompt();
    });

    this.ui.lobbyJoinCancelBtn.addEventListener('click', () => {
      this.ui.hidePasswordPrompt();
    });
  }

  // ── Network Listeners ────────────────────────────────────

  setupNetworkListeners() {
    this.network.on('matched', (data) => {
      this.playerIndex = data.playerIndex;
      this.currentTurn = data.firstTurn;
      // Server is authoritative on game mode for online matches
      if (data.gameMode) {
        const modeKey = data.gameMode.toUpperCase();
        if (GAME_MODES[modeKey]) this.gameMode = GAME_MODES[modeKey];
      }
      this.applyGameMode();
      this.startBuildPhase(true);
    });

    this.network.on('lobby:list', (lobbies) => {
      this.ui.updateLobbyList(lobbies);
    });

    this.network.on('lobby:created', () => {
      this.ui.showLobbyHosting();
    });

    this.network.on('lobby:error', ({ message }) => {
      if (this.ui.isPasswordPromptVisible()) {
        this.ui.showPasswordError(message);
      } else {
        this.ui.hidePasswordPrompt();
        this.ui.setStatus(message);
      }
    });

    this.network.on('build-complete', (data) => {
      this.buildBothCastles(data.castles[0], data.castles[1]);
      this.startBattle();
    });

    this.network.on('opponent-fired', (data) => {
      this.battle.handleOpponentFire(data);
      this.transition(State.OPPONENT_FIRING);
      this.battle.updateCamera();
    });

    this.network.on('shot-resolved', (data) => {
      if (data.hit) {
        const damagedPlayer = data.damagedPlayer;
        this.hp = [...data.hp];
        this.ui.updateHP(this.hp[0], this.hp[1]);

        if (this.hp[damagedPlayer] <= 0) {
          this.transition(State.GAME_OVER);
          this.ui.showResult(damagedPlayer !== this.playerIndex);
        } else {
          this.ui.setStatus(`HIT! ${this.hp[damagedPlayer]} hit${this.hp[damagedPlayer] > 1 ? 's' : ''} remaining`);
          if (damagedPlayer === this.playerIndex) {
            setTimeout(() => this.startRepositionPhase(damagedPlayer), C.HIT_DISPLAY_DELAY);
          } else {
            this.transition(State.OPPONENT_TURN);
            this.ui.setStatus('Opponent repositioning...');
          }
        }
      } else {
        this.currentTurn = data.nextTurn;
        this.syncBattle();
        this.onTurnStart();
      }
    });

    this.network.on('game-over', (data) => {
      this.transition(State.GAME_OVER);
      this.ui.showResult(data.winner === this.playerIndex);
    });

    this.network.on('opponent-disconnected', () => {
      this.ui.hideDisconnectBanner();
      this.transition(State.GAME_OVER);
      this.ui.showResult(true, 'Opponent left the game');
    });

    this.network.on('opponent-disconnected-temp', () => {
      this.ui.showDisconnectBanner();
    });

    this.network.on('opponent-reconnected', () => {
      this.ui.hideDisconnectBanner();
    });

    this.network.on('reconnected', (data) => {
      this.handleReconnect(data);
    });
  }

  handleReconnect(data) {
    this.mode = 'online';
    this.playerIndex = data.playerIndex;
    this.currentTurn = data.game.currentTurn;

    const gameMode = data.game.gameMode || 'CASTLE';
    const modeKey = typeof gameMode === 'string' ? gameMode.toUpperCase() : 'CASTLE';
    if (GAME_MODES[modeKey]) this.gameMode = GAME_MODES[modeKey];
    this.applyGameMode();

    const { phase, castles, hp } = data.game;

    // If still in build phase, we can't fully restore — go to waiting
    if (phase === 'build' || !castles[0] || !castles[1]) {
      this.transition(State.WAITING_OPPONENT_BUILD);
      this.ui.overlay.classList.remove('hidden');
      document.getElementById('build-screen').classList.remove('hidden');
      document.getElementById('build-screen').innerHTML =
        '<h2>Reconnected — waiting for builds...</h2><div class="spinner"></div>';
      return;
    }

    // Rebuild scene from server state
    this.buildBothCastles(castles[0], castles[1]);
    this.hp = [...hp];
    this.ui.updateHP(this.hp[0], this.hp[1]);
    this.ui.showGame();
    this.syncBattle();
    this.onTurnStart();
  }

  // ── Mode Setup ───────────────────────────────────────────

  applyGameMode() {
    this.sceneManager.applyMode(this.gameMode);
    this.physicsWorld = new PhysicsWorld(this.gameMode);
    // Update battle controller's physics reference
    this.battle.physicsWorld = this.physicsWorld;
  }

  // ── Local Mode ───────────────────────────────────────────

  startLocal() {
    this.applyGameMode();
    this.mode = 'local';
    this.playerIndex = 0;
    this.startBuildPhase(true);
  }

  // ── Online Mode ──────────────────────────────────────────

  async startOnline() {
    this.mode = 'online';
    this.ui.showLobby();
    try {
      await this.network.connect();
      this.network.enterLobby();
    } catch (err) {
      this.ui.setStatus('Failed to connect to server.');
      this.transition(State.MENU);
      this.ui.showMenu();
    }
  }

  // ── Build Phase ──────────────────────────────────────────

  requestFullscreen() {
    // Android Chrome: request fullscreen on first match start (not needed for PWA/iOS)
    if (!this._fullscreenRequested
        && this.isTouch
        && document.documentElement.requestFullscreen
        && !window.matchMedia('(display-mode: standalone)').matches) {
      this._fullscreenRequested = true;
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  startBuildPhase(fromMenu = false) {
    if (fromMenu) {
      this.requestFullscreen();
      this.transition(State.BUILD);
    } else {
      // Coming from PASS_DEVICE — already validated
      this.transition(State.BUILD);
    }
    this.ui.overlay.classList.add('hidden');
    this.ui.gameUI.classList.add('hidden');

    this.builder.start((castleData) => {
      this.onBuildComplete(castleData);
    }, this.gameMode);
  }

  onBuildComplete(castleData) {
    this.builder.stop();
    this.castleData[this.playerIndex] = castleData;

    if (this.mode === 'local') {
      if (this.playerIndex === 0) {
        this.playerIndex = 1;
        this.transition(State.PASS_DEVICE);
        this.ui.showPassDevice(2);
      } else {
        this.buildBothCastles(this.castleData[0], this.castleData[1]);
        this.currentTurn = Math.random() < 0.5 ? 0 : 1;
        this.startBattle();
      }
    } else {
      this.network.sendBuildReady(castleData);
      this.transition(State.WAITING_OPPONENT_BUILD);
      this.ui.overlay.classList.remove('hidden');
      document.getElementById('build-screen').classList.remove('hidden');
      document.getElementById('build-screen').innerHTML =
        '<h2>Waiting for opponent...</h2><div class="spinner"></div>';
    }
  }

  onPassDeviceReady() {
    if (this.state === State.PASS_DEVICE_REPOSITION) {
      this.startRepositionPhase(this._damagedPlayer);
    } else {
      this.startBuildPhase();
    }
  }

  // ── Castle Building ──────────────────────────────────────

  buildBothCastles(data0, data1) {
    this.castles[0] = new Castle(
      this.sceneManager,
      this.physicsWorld,
      -(this.gameMode.castleOffsetX || C.CASTLE_OFFSET_X),
      this.gameMode.player0Color,
      { gridWidth: this.gameMode.gridWidth, gridDepth: this.gameMode.gridDepth, blockMassMultiplier: this.gameMode.blockMassMultiplier, blockDamping: this.gameMode.blockDamping }
    );
    const mirror = !!this.gameMode.mirrorZ;
    this.castles[0].buildFromLayout(data0.layout, data0.target, data0.floor, mirror);

    this.castles[1] = new Castle(
      this.sceneManager,
      this.physicsWorld,
      (this.gameMode.castleOffsetX || C.CASTLE_OFFSET_X),
      this.gameMode.player1Color,
      { gridWidth: this.gameMode.gridWidth, gridDepth: this.gameMode.gridDepth, blockMassMultiplier: this.gameMode.blockMassMultiplier, blockDamping: this.gameMode.blockDamping }
    );
    this.castles[1].buildFromLayout(data1.layout, data1.target, data1.floor);

    // Cannon positions
    const gw = this.gameMode.gridWidth;
    const gd = this.gameMode.gridDepth;
    const cp0 = data0.cannonPos || { x: gw - 1, z: Math.floor(gd / 2) };
    const cp1Raw = data1.cannonPos || { x: gw - 1, z: Math.floor(gd / 2) };
    const cp1 = { x: gw - 1 - cp1Raw.x, z: cp1Raw.z };
    const pos0 = this.castles[0].getCannonWorldPosition(cp0.x, cp0.z);
    const pos1 = this.castles[1].getCannonWorldPosition(cp1.x, cp1.z);
    pos0.x += C.CANNON_OFFSET_FROM_CASTLE;
    pos1.x -= C.CANNON_OFFSET_FROM_CASTLE;
    const cannonColors = { baseColor: this.gameMode.cannonBaseColor, barrelColor: this.gameMode.cannonBarrelColor };
    const cannonStyle = this.gameMode.cannonStyle;
    this.cannons[0] = new CannonTower(this.sceneManager.scene, pos0, 1, cannonColors, cannonStyle);
    this.cannons[1] = new CannonTower(this.sceneManager.scene, pos1, -1, cannonColors, cannonStyle);

    // Cannons on layer 1 — visible to main camera, hidden from minimap
    for (const c of this.cannons) {
      c.group.traverse(obj => { obj.layers.set(1); });
    }

    // Target markers on layer 2 — minimap only
    this._cleanupTargetMarkers();
    this.targetMarkers = [];
    for (let i = 0; i < 2; i++) {
      const tp = this.castles[i].getTargetPosition();
      if (!tp) continue;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(C.MINIMAP_RING_INNER, C.MINIMAP_RING_OUTER, 16),
        new THREE.MeshBasicMaterial({ color: 0xff2222, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(tp.x, C.MINIMAP_RING_Y, tp.z);
      ring.layers.set(2);
      this.sceneManager.scene.add(ring);
      this.targetMarkers.push(ring);
    }
  }

  // ── Battle ───────────────────────────────────────────────

  startBattle() {
    this.hp = [C.MAX_HP, C.MAX_HP];
    this.ui.updateHP(this.hp[0], this.hp[1]);
    this.ui.showGame();
    this.syncBattle();
    this.onTurnStart();
  }

  syncBattle() {
    this.battle.sync({
      castles: this.castles,
      cannons: this.cannons,
      currentTurn: this.currentTurn,
      mode: this.mode,
      playerIndex: this.playerIndex,
      gameMode: this.gameMode,
    });
  }

  onTurnStart() {
    this.debugLog('Turn:', this.currentTurn, 'State:', this.state);
    if (this.mode === 'local') {
      this.playerIndex = this.currentTurn;
      this.transition(State.MY_TURN);
      this.ui.setTurn(true, this.currentTurn + 1);
    } else {
      const isMyTurn = this.currentTurn === this.playerIndex;
      this.transition(isMyTurn ? State.MY_TURN : State.OPPONENT_TURN);
      this.ui.setTurn(isMyTurn);
    }

    this.cannons[this.currentTurn].group.visible = true;
    this.cannons[1 - this.currentTurn].group.visible = false;

    this.battle.power = C.MIN_POWER;
    this.battle.charging = false;
    this.battle.chargeTime = 0;
    this.ui.updatePower(C.MIN_POWER, C.MIN_POWER, C.MAX_POWER);
    this.ui.setStatus('');

    const myCastleX = this.currentTurn === 0 ? -(this.gameMode.castleOffsetX || C.CASTLE_OFFSET_X) : (this.gameMode.castleOffsetX || C.CASTLE_OFFSET_X);
    this.sceneManager.setupMinimap(myCastleX);

    if (this.state === State.MY_TURN) {
      this.cannons[this.currentTurn].resetAim();
      this.input.resetTouchState();
      this.ui.setControlsHint(this.isTouch);
    }

    this.syncBattle();
    this.battle.updateCamera(true);
  }

  // ── Hit / Miss Handlers ──────────────────────────────────

  // Local mode only — online hits resolved by server via shot-resolved
  onTargetHit() {
    const damagedPlayer = 1 - this.currentTurn;
    const damage = this.battle._perfectShot ? 2 : 1;
    this.hp[damagedPlayer] = Math.max(0, this.hp[damagedPlayer] - damage);
    this.ui.updateHP(this.hp[0], this.hp[1]);
    this.debugLog('Target hit!', { damage, perfect: this.battle._perfectShot, hp: [...this.hp] });

    if (this.hp[damagedPlayer] <= 0) {
      this.transition(State.GAME_OVER);
      this.ui.showLocalResult(this.currentTurn + 1);
    } else {
      this.ui.setStatus(`HIT! ${this.hp[damagedPlayer]} hit${this.hp[damagedPlayer] > 1 ? 's' : ''} remaining`);
      setTimeout(() => {
        this.transition(State.PASS_DEVICE_REPOSITION);
        this._damagedPlayer = damagedPlayer;
        this.ui.showPassDevice(damagedPlayer + 1);
      }, C.HIT_DISPLAY_DELAY);
    }
  }

  onShotMiss() {
    if (this.mode === 'local') {
      this.transition(State.TURN_TRANSITION);
      this.ui.setStatus('');
      setTimeout(() => {
        this.currentTurn = 1 - this.currentTurn;
        this.syncBattle();
        this.onTurnStart();
      }, C.MISS_TURN_DELAY);
    } else {
      this.network.sendShotResult(false);
      this.transition(State.OPPONENT_TURN);
      this.ui.setStatus('Waiting...');
    }
  }

  // ── Reposition ───────────────────────────────────────────

  startRepositionPhase(damagedPlayerIndex) {
    this.transition(State.REPOSITION);
    this.ui.overlay.classList.add('hidden');
    this.ui.gameUI.classList.add('hidden');
    this.sceneManager.disableMinimap();

    this.cannons[0].group.visible = false;
    this.cannons[1].group.visible = false;

    this.repositioner.start(
      this.castles[damagedPlayerIndex],
      damagedPlayerIndex,
      (newTargetPos) => this.onRepositionComplete(damagedPlayerIndex, newTargetPos),
      this.gameMode.maxLayers
    );
  }

  onRepositionComplete(damagedPlayerIndex, newTargetPos) {
    this.repositioner.stop();
    this.castles[damagedPlayerIndex].repositionTarget(newTargetPos);

    const tp = this.castles[damagedPlayerIndex].getTargetPosition();
    if (tp && this.targetMarkers && this.targetMarkers[damagedPlayerIndex]) {
      this.targetMarkers[damagedPlayerIndex].position.set(tp.x, C.MINIMAP_RING_Y, tp.z);
    }

    this.currentTurn = damagedPlayerIndex;
    this.ui.showGame();
    this.syncBattle();
    this.onTurnStart();
  }

  // ── Main Update Loop ─────────────────────────────────────

  update() {
    const dt = this.clock.getDelta();

    // Non-gameplay states: just render
    if (
      this.state === State.MENU ||
      this.state === State.BUILD ||
      this.state === State.PASS_DEVICE ||
      this.state === State.PASS_DEVICE_REPOSITION ||
      this.state === State.WAITING_OPPONENT_BUILD ||
      this.state === State.REPOSITION ||
      this.state === State.TURN_TRANSITION
    ) {
      this.sceneManager.render();
      return;
    }

    // Input during aiming
    if (this.state === State.MY_TURN) {
      const action = this.input.handleInput(dt, this.cannons[this.currentTurn], this.battle, this.ui);
      if (action === 'fire') {
        this.battle.fire(this.debugPerfectShot);
        this.transition(State.FIRING);
      }
      this.battle.updateCamera();
      this.battle.updateTrajectory();
    }

    // Physics
    if (this.state !== State.GAME_OVER) {
      this.physicsWorld.step(dt);
      this.physicsWorld.sync();
      this.battle.cleanupFallenBlocks();
    }

    // Projectile tracking (before firing block so state changes take effect)
    if (this.state === State.FIRING || this.state === State.OPPONENT_FIRING) {
      this.battle.checkProjectile(dt);
    }

    // Follow projectile + skip/auto-advance (only if still in firing state)
    if (this.state === State.FIRING || this.state === State.OPPONENT_FIRING) {
      if (this.battle.projectile?.alive) {
        this.battle.followProjectile();
      }

      const elapsed = (performance.now() - this.battle.fireTime) / 1000;
      if (elapsed > C.SKIP_PROMPT_DELAY && this.state === State.FIRING) {
        this.ui.setStatus(this.isTouch ? 'Tap to skip' : 'Press Space to skip');
        if (this.input.keys['Space'] || this.input._touchTapped) {
          this.input.keys['Space'] = false;
          this.input._touchTapped = false;
          this.battle.destroyProjectile();
          this.onShotMiss();
        }
      }
      if (elapsed > C.AUTO_MISS_TIMEOUT && (this.state === State.FIRING || this.state === State.OPPONENT_FIRING)) {
        this.battle.destroyProjectile();
        this.onShotMiss();
      }
    }

    this.battle.updateThrusters();
    this.particles.update(dt);
    this.sceneManager.updateCamera(dt);
    this.sceneManager.render();
  }

  // ── Target Marker Cleanup ────────────────────────────

  _cleanupTargetMarkers() {
    if (this.targetMarkers) {
      for (const m of this.targetMarkers) {
        this.sceneManager.scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
      this.targetMarkers = [];
    }
  }

  // ── Cleanup ──────────────────────────────────────────────

  cleanup() {
    this.castles.forEach((c) => { if (c) c.clear(); });
    this.cannons.forEach((c) => { if (c) c.destroy(); });
    this.battle.reset();
    this.physicsWorld.clear();

    this.castles = [null, null];
    this.cannons = [null, null];
    this.castleData = [null, null];
    this.particles.clear();
    this.builder.stop();
    this.repositioner.stop();
    this._cleanupTargetMarkers();
    this.hp = [C.MAX_HP, C.MAX_HP];
    this.sceneManager.disableMinimap();
    const debugOverlay = document.getElementById('debug-log-overlay');
    if (debugOverlay) debugOverlay.remove();
    this.ui.menuPanel.classList.add('hidden');
    this.ui.hideDisconnectBanner();

    if (this.network.socket) {
      this.network.leaveLobby();
      this.network.disconnect();
    }
  }

  // ── Debug ────────────────────────────────────────────────

  updatePhysicsDebug() {
    for (const castle of this.castles) {
      if (!castle) continue;
      for (const { mesh } of castle.blocks) {
        if (!mesh) continue;
        mesh.material.wireframe = this.debugPhysics;
      }
    }
  }

  debugLog(...args) {
    if (this.debugLogsEnabled) {
      console.log('[Cannonfall]', ...args);
      this.addDebugOverlay(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    }
  }

  addDebugOverlay(msg) {
    let container = document.getElementById('debug-log-overlay');
    if (!container) {
      container = document.createElement('div');
      container.id = 'debug-log-overlay';
      container.style.cssText = 'position:fixed; bottom:80px; left:16px; width:350px; max-height:200px; overflow-y:auto; pointer-events:none; z-index:15; display:flex; flex-direction:column-reverse; gap:2px;';
      document.body.appendChild(container);
    }
    const line = document.createElement('div');
    line.style.cssText = 'background:rgba(0,0,0,0.7); color:#0f0; font-family:monospace; font-size:0.7rem; padding:2px 6px; border-radius:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    container.prepend(line);
    while (container.children.length > 15) container.lastChild.remove();
    setTimeout(() => { line.style.opacity = '0'; line.style.transition = 'opacity 1s'; }, 5000);
    setTimeout(() => line.remove(), 6000);
  }
}
