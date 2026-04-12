import * as THREE from 'three';
import { SceneManager } from './SceneManager.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Network } from './Network.js';
import { UI } from './UI.js';
import { GAME_MODES } from './GameModes.js';
import { ParticleManager } from './ParticleManager.js';
import { CastleBuilder } from './CastleBuilder.js';
import { TargetRepositioner } from './TargetRepositioner.js';
import { InputHandler } from './InputHandler.js';
import { BattleController } from './BattleController.js';
import { decode as decodeDesign } from './DesignCodec.js';
import { AIController } from './AIController.js';
import { buildBothCastles } from './CastleSetup.js';
import { setupUIListeners } from './UIListeners.js';
import { setupNetworkListeners } from './NetworkHandler.js';
import * as C from './constants.js';
import { StateMachine, State } from './StateMachine.js';

export { State };

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

    this._sm = new StateMachine();
    this.gameMode = GAME_MODES.CASTLE;
    this.mode = null; // 'local', 'online', or 'ai'
    this.playerIndex = 0;
    this.currentTurn = 0;
    this.aiController = new AIController();
    this.aiDifficulty = 'MEDIUM';

    this.castles = [null, null];
    this.cannons = [null, null];
    this.castleData = [null, null];
    this.castleBuilds = {}; // per-mode prebuild storage: { CASTLE: data, PIRATE: data, ... }

    this.hp = [C.MAX_HP, C.MAX_HP];
    this._pendingTimers = []; // tracked timeouts, cancelled on cleanup

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

    setupUIListeners(this, State);
    setupNetworkListeners(this, State);
    // Share hash takes priority over reconnecting to an old session
    if (location.hash && location.hash.includes('d=')) {
      this._checkShareHash();
    } else {
      this.attemptReconnect();
    }

    this.clock = new THREE.Clock();
    this._importedDesign = null;
  }

  _checkShareHash() {
    if (!location.hash || !location.hash.includes('d=')) return;
    const result = decodeDesign(location.hash.slice(1));
    if (!result) return;

    const modeKey = result.modeId.toUpperCase();
    if (GAME_MODES[modeKey]) {
      this.gameMode = GAME_MODES[modeKey];
      document.querySelectorAll('.mode-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.mode === modeKey);
      });
    }
    this._importedDesign = result.castleData;
    history.replaceState(null, '', window.location.pathname);
    this.onModeChanged();

    // Open builder with the shared design loaded
    this.buildFromMenu();
  }

  attemptReconnect() {
    // If we have a persisted session, try connecting to see if the server
    // has an active game for us. The 'reconnected' handler takes over if so.
    if (sessionStorage.getItem('cannonfall-session')) {
      this.network.connect(3000).catch(() => {});
    }
  }

  // ── State Machine ───────────────────────────────────────

  get state() { return this._sm.state; }
  set state(v) { this._sm.current = v; }

  transition(newState) {
    const prev = this._sm.state;
    const ok = this._sm.transition(newState);
    if (ok) this.debugLog(`State: ${prev} → ${newState}`);
    return ok;
  }

  // ── Mode Setup ───────────────────────────────────────────

  applyGameMode() {
    this.sceneManager.applyMode(this.gameMode);
    this.physicsWorld = new PhysicsWorld(this.gameMode);
    // Update battle controller's physics reference
    this.battle.physicsWorld = this.physicsWorld;
  }

  // ── Build from Menu ──────────────────────────────────────

  buildFromMenu() {
    this.applyGameMode();
    this.mode = null;
    this.playerIndex = 0;
    this._prebuild = true;
    this.startBuildPhase(true);
  }

  getModeKey() {
    return this.gameMode.id.toUpperCase();
  }

  /** Get the stored prebuild for the current mode, or null. */
  getPlayerBuild() {
    return this.castleBuilds[this.getModeKey()] || null;
  }

  onModeChanged() {
    const label = this.gameMode.structureLabel;
    const hasBuild = !!this.getPlayerBuild();

    // Update build button and ready label
    const btn = document.getElementById('build-castle-btn');
    const readyLabel = document.getElementById('castle-ready-label');
    if (btn) btn.textContent = hasBuild ? `Edit ${label}` : `Build Your ${label}`;
    if (readyLabel) {
      readyLabel.textContent = `${label} Ready`;
      readyLabel.classList.toggle('hidden', !hasBuild);
    }

    // RL agent is only trained for Castle mode
    const rlBtn = document.querySelector('.diff-btn-rl');
    if (rlBtn) rlBtn.disabled = this.gameMode.id !== 'castle';

    this.updateMatchButtons();
  }

  _showCastleReady() {
    const label = this.gameMode.structureLabel;
    const readyLabel = document.getElementById('castle-ready-label');
    const btn = document.getElementById('build-castle-btn');
    if (readyLabel) {
      readyLabel.textContent = `${label} Ready`;
      readyLabel.classList.remove('hidden');
    }
    if (btn) btn.textContent = `Edit ${label}`;
    this.updateMatchButtons();
  }

  _hideCastleReady() {
    const label = this.gameMode.structureLabel;
    const readyLabel = document.getElementById('castle-ready-label');
    const btn = document.getElementById('build-castle-btn');
    if (readyLabel) readyLabel.classList.add('hidden');
    if (btn) btn.textContent = `Build Your ${label}`;
  }

  hasBuildForCurrentMode() {
    return !!this.getPlayerBuild();
  }

  updateMatchButtons() {
    const ready = this.hasBuildForCurrentMode();
    const ids = ['ai-match-btn', 'local-match-btn', 'online-match-btn'];
    for (const id of ids) {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !ready;
    }
    // Hide difficulty picker when buttons change state
    const picker = document.getElementById('diff-picker');
    if (picker) picker.classList.add('hidden');
  }

  flashBuildRequired() {
    const btn = document.getElementById('build-castle-btn');
    if (!btn) return;
    btn.classList.remove('shake');
    void btn.offsetWidth;
    btn.classList.add('shake');
    setTimeout(() => btn.classList.remove('shake'), 600);
  }

  // ── Local Mode ───────────────────────────────────────────

  startLocal() {
    this.applyGameMode();
    this.mode = 'local';
    this.playerIndex = 0;
    this.castleData[0] = this.getPlayerBuild();
    if (this.castleData[0]) {
      // P1 already built — skip to P2
      this.playerIndex = 1;
      this.transition(State.BUILD);
      this.transition(State.PASS_DEVICE);
      this.ui.showPassDevice(2);
    } else {
      this.startBuildPhase(true);
    }
  }

  // ── AI Mode ──────────────────────────────────────────────

  async startAIMatch() {
    this.applyGameMode();
    this.mode = 'ai';
    this.playerIndex = 0;

    const result = await this.aiController.loadAI(this.aiDifficulty);
    if (result?.error) {
      const picker = document.getElementById('diff-picker');
      if (picker) {
        let msg = picker.querySelector('.rl-error');
        if (!msg) {
          msg = document.createElement('span');
          msg.className = 'rl-error';
          picker.appendChild(msg);
        }
        msg.textContent = `RL model failed: ${result.error.message}`;
        picker.classList.remove('hidden');
      }
      return;
    }

    this._continueAIMatch();
  }

  _continueAIMatch() {
    this.aiController.resetGame();
    this.castleData[0] = this.getPlayerBuild();
    if (this.castleData[0]) {
      this._startAIBattle();
    } else {
      this.startBuildPhase(true);
    }
  }

  async _startAIBattle() {
    this.castleData[1] = await this.aiController.getAICastle(this.gameMode);
    this.buildBothCastles(this.castleData[0], this.castleData[1]);
    this.currentTurn = Math.random() < 0.5 ? 0 : 1;
    this.startBattle();
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

    if (this._importedDesign) {
      this.builder.loadFromDesignData(this._importedDesign);
      this._importedDesign = null;
    } else if (this._prebuild && this.getPlayerBuild()) {
      // Re-entering builder with existing build — load it
      this.builder.loadFromDesignData(this.getPlayerBuild());
    }
  }

  onBuildComplete(castleData) {
    this.builder.stop();
    this.castleData[this.playerIndex] = castleData;

    // Prebuild from menu: save castle per-mode and return to menu
    if (this._prebuild) {
      this._prebuild = false;
      this.castleBuilds[this.getModeKey()] = castleData;
      this.transition(State.MENU);
      this.ui.hideConnectionLost();
      this.ui.showMenu();
      this._showCastleReady();
      return;
    }

    if (this.mode === 'ai') {
      this._startAIBattle();
    } else if (this.mode === 'local') {
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
    this._cleanupTargetMarkers();
    const result = buildBothCastles({
      sceneManager: this.sceneManager,
      physicsWorld: this.physicsWorld,
      gameMode: this.gameMode,
      data0,
      data1,
    });
    this.castles = result.castles;
    this.cannons = result.cannons;
    this.targetMarkers = result.targetMarkers;
  }

  // ── Battle ───────────────────────────────────────────────

  startBattle() {
    this.hp = [C.MAX_HP, C.MAX_HP];
    this.ui.updateHP(this.hp[0], this.hp[1]);
    this.ui.showGame();

    // Hide debug menu during online play
    const debugSection = document.getElementById('debug-section');
    if (debugSection) debugSection.classList.toggle('hidden', this.mode === 'online');
    if (this.mode === 'online') {
      this.debugPhysics = false;
      this.debugPerfectShot = false;
    }

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
    // Clear stale input from previous turn
    this.input.keys['Space'] = false;
    this.input.resetTouchState();

    if (this.mode === 'ai') {
      if (this.currentTurn === 0) {
        this.transition(State.MY_TURN);
        this.ui.setTurn(true);
      } else {
        this.transition(State.AI_AIMING);
        this.ui.setTurn(false);
        this.ui.setStatus('AI is aiming...');
      }
    } else if (this.mode === 'local') {
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

    // Only show your own target on minimap — never reveal the opponent's
    if (this.targetMarkers) {
      for (let i = 0; i < this.targetMarkers.length; i++) {
        this.targetMarkers[i].visible = (i === this.playerIndex);
      }
    }

    const defaultPitch = this.gameMode.defaultPitch;
    if (this.state === State.MY_TURN) {
      this.cannons[this.currentTurn].resetAim(defaultPitch);
      this.input.resetTouchState();
      this.ui.setControlsHint(this.isTouch);
    }
    if (this.state === State.AI_AIMING) {
      this.cannons[this.currentTurn].resetAim(defaultPitch);
      this._startAITurn();
    }

    this.syncBattle();
    this.battle.updateCamera(true);
  }

  async _startAITurn() {
    await this.aiController.executeTurn({
      cannon: this.cannons[1],
      targetPos: this.castles[0].getTargetPosition(),
      gameMode: this.gameMode,
      castle: this.castles[0],
      battle: this.battle,
      ui: this.ui,
      schedule: (fn, delay, ...states) => this._schedule(fn, delay, ...states),
      getState: () => this.state,
      aimingState: State.AI_AIMING,
      onFire: () => this.transition(State.AI_FIRING),
    });
  }

  /**
   * Wait for physics to settle (blocks stop moving) then call fn.
   * Minimum wait: 800ms. Max wait: 4s. Checks block velocities via polling.
   */
  _waitForSettle(fn) {
    const startTime = performance.now();
    const MIN_WAIT = 800;
    const MAX_WAIT = 4000;
    const SPEED_THRESHOLD = 1.5;

    const check = () => {
      const elapsed = performance.now() - startTime;

      // Always wait at least MIN_WAIT
      if (elapsed < MIN_WAIT) {
        this._schedule(check, 100, State.TURN_TRANSITION);
        return;
      }

      // After MAX_WAIT, proceed regardless
      if (elapsed >= MAX_WAIT) { fn(); return; }

      // Check if blocks have settled
      let maxSpeed = 0;
      for (const castle of this.castles) {
        if (!castle) continue;
        for (const { body } of castle.blocks) {
          if (body.mass === 0) continue;
          const speed = body.velocity.length();
          if (speed > maxSpeed) maxSpeed = speed;
        }
      }

      if (maxSpeed < SPEED_THRESHOLD) {
        fn();
      } else {
        this._schedule(check, 100, State.TURN_TRANSITION);
      }
    };

    this._schedule(check, MIN_WAIT, State.TURN_TRANSITION);
  }

  /** Schedule a delayed action that is cancelled on cleanup and guarded against stale state. */
  _schedule(fn, delay, ...validStates) {
    const id = setTimeout(() => {
      this._pendingTimers = this._pendingTimers.filter(t => t !== id);
      if (validStates.length > 0 && !validStates.includes(this.state)) return;
      fn();
    }, delay);
    this._pendingTimers.push(id);
    return id;
  }

  _cancelPendingTimers() {
    for (const id of this._pendingTimers) clearTimeout(id);
    this._pendingTimers = [];
  }

  // ── Hit / Miss Handlers ──────────────────────────────────

  // Local/AI mode — online hits resolved by server via shot-resolved
  onTargetHit() {
    const damagedPlayer = 1 - this.currentTurn;
    const damage = this.battle._perfectShot ? 2 : 1;
    this.hp[damagedPlayer] = Math.max(0, this.hp[damagedPlayer] - damage);
    this.ui.updateHP(this.hp[0], this.hp[1]);

    // Track hit for RL agent observation state
    if (this.mode === 'ai') {
      if (this.currentTurn === 1) {
        this.aiController.updateAfterShot(true, 0);
      } else {
        this.aiController.updateAfterOpponentShot(true);
      }
    }
    this.debugLog('Target hit!', { damage, perfect: this.battle._perfectShot, hp: [...this.hp] });

    if (this.hp[damagedPlayer] <= 0) {
      // Try cinematic replay before showing result
      if (this.battle._replayData && this.battle.startReplay()) {
        this.transition(State.REPLAY);
        this._replayStartTime = performance.now();
        this._replayResult = this.mode === 'local'
          ? { local: true, winner: this.currentTurn + 1 }
          : { local: false, won: this.currentTurn === 0 };
        this.ui.setStatus('REPLAY');
      } else {
        this.transition(State.GAME_OVER);
        if (this.mode === 'ai') {
          this.ui.showResult(this.currentTurn === 0);
        } else {
          this.ui.showLocalResult(this.currentTurn + 1);
        }
      }
    } else {
      this.ui.setStatus(`HIT! ${this.hp[damagedPlayer]} hit${this.hp[damagedPlayer] > 1 ? 's' : ''} remaining`);
      this.transition(State.TURN_TRANSITION);
      this._waitForSettle(() => {
        if (this.state !== State.TURN_TRANSITION) return;
        if (this.mode === 'ai') {
          this.startRepositionPhase(damagedPlayer);
        } else {
          this.transition(State.PASS_DEVICE_REPOSITION);
          this._damagedPlayer = damagedPlayer;
          this.ui.showPassDevice(damagedPlayer + 1);
        }
      });
    }
  }

  onShotMiss() {
    // Track miss for RL agent observation state
    if (this.mode === 'ai') {
      if (this.currentTurn === 1) {
        this.aiController.updateAfterShot(false, Infinity);
      } else {
        this.aiController.updateAfterOpponentShot(false);
      }
    }

    if (this.mode === 'local' || this.mode === 'ai') {
      this.transition(State.TURN_TRANSITION);
      this.ui.setStatus('');
      this._waitForSettle(() => {
        if (this.state !== State.TURN_TRANSITION) return;
        this.currentTurn = 1 - this.currentTurn;
        this.syncBattle();
        this.onTurnStart();
      });
    } else {
      this.network.sendShotResult(false);
      this.transition(State.OPPONENT_TURN);
      this.ui.setStatus('Waiting...');
    }
  }

  _endReplay() {
    this.battle.destroyProjectile();
    this.battle._replayTimeScale = 1;
    this.battle._replayPhase = null;
    this.transition(State.GAME_OVER);
    const r = this._replayResult;
    if (r?.local) {
      this.ui.showLocalResult(r.winner);
    } else {
      this.ui.showResult(r?.won);
    }
  }

  // ── Reposition ───────────────────────────────────────────

  startRepositionPhase(damagedPlayerIndex) {
    // AI auto-repositions using difficulty-based strategy
    if (this.mode === 'ai' && damagedPlayerIndex === 1) {
      const newPos = this.aiController.chooseRepositionTarget(this.castles[1]);
      this.onRepositionComplete(1, newPos);
      return;
    }

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

    // Non-gameplay states: disable input, just render
    if (
      this.state === State.MENU ||
      this.state === State.BUILD ||
      this.state === State.PASS_DEVICE ||
      this.state === State.PASS_DEVICE_REPOSITION ||
      this.state === State.WAITING_OPPONENT_BUILD ||
      this.state === State.REPOSITION
    ) {
      this.input.enabled = false;
      this.input.resetTouchState();
      this.sceneManager.render();
      return;
    }

    // Turn transition: run physics so blocks tumble, wait for settling
    if (this.state === State.TURN_TRANSITION) {
      this.input.enabled = false;
      this.input.resetTouchState();
      this.physicsWorld.step(dt);
      this.physicsWorld.sync();
      this.battle.cleanupFallenBlocks();
      this.battle.updateThrusters();
      this.particles.update(dt);
      this.sceneManager.updateCamera(dt);
      this.sceneManager.render();
      return;
    }
    this.input.enabled = true;

    // Replay state
    if (this.state === State.REPLAY) {
      const scaledDt = dt * this.battle._replayTimeScale;
      this.physicsWorld.step(scaledDt);
      this.physicsWorld.sync();
      this.battle.cleanupFallenBlocks();

      if (this.battle.projectile?.alive) {
        if (this.battle._pendingTargetHit || this.battle._pendingSpaceImpact) {
          const pos = this.battle.projectile.getPosition();
          this.battle.onReplayImpact(pos);
          this.particles.emit(pos, { x: 0, y: 5, z: 0 }, 10, { r: 1, g: 0.3, b: 0.1 }, 60, 1.2);
          this.sceneManager.shake(0.8, 0.5);
          this.battle.destroyProjectile();
          this.battle._pendingTargetHit = false;
          this.battle._pendingSpaceImpact = null;
        }
      }

      this.battle.updateReplayCamera(scaledDt);

      const realElapsed = (performance.now() - this._replayStartTime) / 1000;
      if (realElapsed > C.REPLAY_DURATION) this._endReplay();
      if (this.input.keys['Space'] || this.input._touchTapped) {
        this.input.keys['Space'] = false;
        this.input._touchTapped = false;
        this._endReplay();
      }

      this.particles.update(scaledDt);
      this.sceneManager.updateCamera(scaledDt);
      this.sceneManager.render();
      return;
    }

    // Input during aiming
    if (this.state === State.MY_TURN) {
      const action = this.input.handleInput(dt, this.cannons[this.currentTurn], this.battle, this.ui);
      if (action === 'fire') {
        this.battle.fire(this.debugPerfectShot);
        this.transition(State.FIRING);
        this.input.resetTouchState(); // Clear stale tap from aiming so it doesn't trigger skip
      } else {
        this.battle.updateCamera();
        this.battle.updateTrajectory();
      }
    }

    // AI aiming animation
    if (this.state === State.AI_AIMING) {
      this.aiController.updateAiming(dt, this.cannons[this.currentTurn]);
      // Animate power meter and trajectory during AI aim
      const progress = this.aiController.aimProgress;
      const aiPower = C.MIN_POWER + (this.aiController.targetPower - C.MIN_POWER) * progress;
      this.battle.power = aiPower;
      this.ui.updatePower(aiPower, C.MIN_POWER, C.MAX_POWER);
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
    if (this.state === State.FIRING || this.state === State.OPPONENT_FIRING || this.state === State.AI_FIRING) {
      this.battle.checkProjectile(dt);
    }

    // Follow projectile + skip/auto-advance (only if still in firing state)
    if (this.state === State.FIRING || this.state === State.OPPONENT_FIRING || this.state === State.AI_FIRING) {
      if (this.battle.projectile?.alive) {
        this.battle.followProjectile();
      }

      const elapsed = (performance.now() - this.battle.fireTime) / 1000;
      // Skip prompt — only for the player's own shot, not AI
      if (elapsed > C.SKIP_PROMPT_DELAY && this.state === State.FIRING) {
        this.ui.setStatus(this.isTouch ? 'Tap to skip' : 'Press Space to skip');
        if (this.input.keys['Space'] || this.input._touchTapped) {
          this.input.keys['Space'] = false;
          this.input._touchTapped = false;
          this.battle.destroyProjectile();
          this.onShotMiss();
        }
      }
      if (elapsed > C.AUTO_MISS_TIMEOUT && (this.state === State.FIRING || this.state === State.OPPONENT_FIRING || this.state === State.AI_FIRING)) {
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
    this._sm.reset();
    this._cancelPendingTimers();
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
    this.ui.hideConnectionLost();

    // Reset debug state and checkboxes
    this.debugPhysics = false;
    this.debugPerfectShot = false;
    this.debugLogsEnabled = false;
    if (this.ui.debugPhysics) this.ui.debugPhysics.checked = false;
    if (this.ui.debugPerfect) this.ui.debugPerfect.checked = false;
    if (this.ui.debugLogs) this.ui.debugLogs.checked = false;
    const debugAxes = document.getElementById('debug-axes');
    if (debugAxes) debugAxes.checked = false;
    const debugNextShot = document.getElementById('debug-nextshotwins');
    if (debugNextShot) debugNextShot.checked = false;

    this.onModeChanged();

    if (this.network.socket) {
      this.network.leaveLobby();
      this.network.disconnect();
    }
  }

  // ── Debug ────────────────────────────────────────────────

  toggleAxesHelper(enabled) {
    this._showBlockAxes = enabled;
    this._syncBlockAxes();
  }

  _syncBlockAxes() {
    // Remove existing
    if (this._blockAxes) {
      for (const helper of this._blockAxes) {
        helper.parent?.remove(helper);
        helper.dispose();
      }
      this._blockAxes = null;
    }

    if (!this._showBlockAxes) return;

    this._blockAxes = [];
    for (const castle of this.castles) {
      if (!castle) continue;
      for (const { mesh } of castle.blocks) {
        if (!mesh) continue;
        const axes = new THREE.AxesHelper(0.6);
        mesh.add(axes); // parent to mesh so it moves/rotates with the block
        this._blockAxes.push(axes);
      }
    }
  }

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
    this._schedule(() => { line.style.opacity = '0'; line.style.transition = 'opacity 1s'; }, 5000);
    this._schedule(() => line.remove(), 6000);
  }
}
