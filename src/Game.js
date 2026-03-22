import * as THREE from 'three';
import { SceneManager } from './SceneManager.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Castle } from './Castle.js';
import { CannonTower } from './CannonTower.js';
import { Projectile } from './Projectile.js';
import { Network } from './Network.js';
import { UI } from './UI.js';
import { getPreset } from './Presets.js';
import { ParticleManager } from './ParticleManager.js';
import { CastleBuilder } from './CastleBuilder.js';
import { TargetRepositioner } from './TargetRepositioner.js';
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
  GAME_OVER: 'game_over',
};

export class Game {
  constructor(canvas) {
    this.sceneManager = new SceneManager(canvas);
    this.physicsWorld = new PhysicsWorld();
    this.network = new Network();
    this.ui = new UI();

    this.state = State.MENU;
    this.mode = null; // 'local' or 'online'
    this.playerIndex = 0; // 0 or 1 (which player we are / active player in local)
    this.currentTurn = 0; // whose turn (0 or 1)

    this.castles = [null, null];
    this.cannons = [null, null];
    this.castleData = [null, null]; // stored build preset data
    this.projectile = null;
    this.power = C.DEFAULT_POWER;
    this.settleTimer = 0;

    // Particles
    this.particles = new ParticleManager(this.sceneManager.scene);

    // HP
    this.hp = [C.MAX_HP, C.MAX_HP];

    // Castle builder & repositioner
    this.builder = new CastleBuilder(this.sceneManager);
    this.repositioner = new TargetRepositioner(this.sceneManager);

    // Trajectory preview (hidden by default, toggle with backtick)
    this.trajectoryLine = null;
    this.debugTrajectory = false;
    this.createTrajectoryLine();

    // Input
    this.keys = {};
    this.setupInput();
    this.setupUIListeners();
    this.setupNetworkListeners();

    this.clock = new THREE.Clock();
  }

  // ── Trajectory Preview Line ──────────────────────────────

  createTrajectoryLine() {
    const mat = new THREE.LineDashedMaterial({
      color: 0xffff00,
      dashSize: 0.5,
      gapSize: 0.3,
    });
    const geo = new THREE.BufferGeometry();
    this.trajectoryLine = new THREE.Line(geo, mat);
    this.trajectoryLine.visible = false;
    this.sceneManager.scene.add(this.trajectoryLine);
  }

  // ── Input Setup ──────────────────────────────────────────

  setupInput() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();
      // Backtick toggles trajectory debug line
      if (e.code === 'Backquote') {
        this.debugTrajectory = !this.debugTrajectory;
        if (!this.debugTrajectory) this.trajectoryLine.visible = false;
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  // ── UI Listeners ─────────────────────────────────────────

  setupUIListeners() {
    this.ui.localMatchBtn.addEventListener('click', () => this.startLocal());
    this.ui.onlineMatchBtn.addEventListener('click', () => this.startOnline());

    this.ui.playAgainBtn.addEventListener('click', () => {
      this.cleanup();
      this.state = State.MENU;
      this.ui.showMenu();
    });

    this.ui.passReadyBtn.addEventListener('click', () => this.onPassDeviceReady());

    this.ui.quitBtn.addEventListener('click', () => {
      if (this.state === State.MENU || this.state === State.BUILD ||
          this.state === State.PASS_DEVICE || this.state === State.GAME_OVER) return;
      this.cleanup();
      this.state = State.MENU;
      this.ui.showMenu();
    });
  }

  // ── Network Listeners ────────────────────────────────────

  setupNetworkListeners() {
    this.network.on('matched', (data) => {
      this.playerIndex = data.playerIndex;
      this.currentTurn = data.firstTurn;
      this.startBuildPhase();
    });

    this.network.on('build-complete', (data) => {
      this.buildBothCastles(data.castles[0], data.castles[1]);
      this.startBattle();
    });

    this.network.on('opponent-fired', (data) => {
      this.handleOpponentFire(data);
    });

    this.network.on('turn', (data) => {
      this.currentTurn = data.playerIndex;
      this.onTurnStart();
    });

    this.network.on('game-over', (data) => {
      this.state = State.GAME_OVER;
      this.ui.showResult(data.winner === this.playerIndex);
    });

    this.network.on('opponent-disconnected', () => {
      this.state = State.GAME_OVER;
      this.ui.showResult(true);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // LOCAL MODE
  // ═══════════════════════════════════════════════════════════

  startLocal() {
    this.mode = 'local';
    this.playerIndex = 0; // Player 1 builds first
    this.startBuildPhase();
  }

  // ═══════════════════════════════════════════════════════════
  // ONLINE MODE
  // ═══════════════════════════════════════════════════════════

  async startOnline() {
    this.mode = 'online';
    this.ui.showMatchmaking();
    try {
      await this.network.connect();
      this.network.joinQueue();
      // Wait for 'matched' event (handled in setupNetworkListeners)
    } catch (err) {
      this.ui.setStatus('Failed to connect. Try again.');
      this.state = State.MENU;
      this.ui.showMenu();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // BUILD PHASE
  // ═══════════════════════════════════════════════════════════

  startBuildPhase() {
    this.state = State.BUILD;
    // Hide overlay — the builder renders its own UI on top of the 3D scene
    this.ui.overlay.classList.add('hidden');
    this.ui.gameUI.classList.add('hidden');

    this.builder.start((castleData) => {
      this.onBuildComplete(castleData);
    });
  }

  onBuildComplete(castleData) {
    this.builder.stop();
    this.castleData[this.playerIndex] = castleData;

    if (this.mode === 'local') {
      if (this.playerIndex === 0) {
        this.playerIndex = 1;
        this.state = State.PASS_DEVICE;
        this.ui.showPassDevice(2);
      } else {
        this.buildBothCastles(this.castleData[0], this.castleData[1]);
        this.currentTurn = Math.random() < 0.5 ? 0 : 1;
        this.startBattle();
      }
    } else {
      this.network.sendBuildReady(castleData);
      this.state = State.WAITING_OPPONENT_BUILD;
      this.ui.overlay.classList.remove('hidden');
      document.getElementById('build-screen').classList.remove('hidden');
      document.getElementById('build-screen').innerHTML =
        '<h2>Waiting for opponent...</h2><div class="spinner"></div>';
    }
  }

  onPassDeviceReady() {
    if (this.state === State.PASS_DEVICE_REPOSITION) {
      // Damaged player is ready to reposition their target
      this.startRepositionPhase(this._damagedPlayer);
    } else {
      // Player 2 is ready to build after device handoff
      this.startBuildPhase();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CASTLE BUILDING
  // ═══════════════════════════════════════════════════════════

  buildBothCastles(data0, data1) {
    // Castle 0 (player 0) at x = -CASTLE_OFFSET_X
    this.castles[0] = new Castle(
      this.sceneManager,
      this.physicsWorld,
      -C.CASTLE_OFFSET_X,
      0x8b7355
    );
    this.castles[0].buildFromLayout(data0.layout, data0.target);

    // Castle 1 (player 1) at x = +CASTLE_OFFSET_X
    this.castles[1] = new Castle(
      this.sceneManager,
      this.physicsWorld,
      C.CASTLE_OFFSET_X,
      0x6b8e9b
    );
    this.castles[1].buildFromLayout(data1.layout, data1.target);

    // Cannons: placed on top of the front wall, offset outward so barrel is clear.
    // cannonPos is defined relative to +X facing (P0's front).
    // P1's castle faces -X, so mirror the x coordinate.
    const cp0 = data0.cannonPos || { x: C.CASTLE_WIDTH - 1, z: Math.floor(C.CASTLE_WIDTH / 2) };
    const cp1Raw = data1.cannonPos || { x: C.CASTLE_WIDTH - 1, z: Math.floor(C.CASTLE_WIDTH / 2) };
    const cp1 = { x: C.CASTLE_WIDTH - 1 - cp1Raw.x, z: cp1Raw.z };
    const pos0 = this.castles[0].getCannonWorldPosition(cp0.x, cp0.z);
    const pos1 = this.castles[1].getCannonWorldPosition(cp1.x, cp1.z);
    // Push cannons well forward of the wall so camera has clear sightlines
    pos0.x += 4;
    pos1.x -= 4;
    this.cannons[0] = new CannonTower(this.sceneManager.scene, pos0, 1);
    this.cannons[1] = new CannonTower(this.sceneManager.scene, pos1, -1);
  }

  // ═══════════════════════════════════════════════════════════
  // BATTLE
  // ═══════════════════════════════════════════════════════════

  startBattle() {
    this.hp = [C.MAX_HP, C.MAX_HP];
    this.ui.updateHP(this.hp[0], this.hp[1]);
    this.ui.showGame();
    this.onTurnStart();
  }

  onTurnStart() {
    if (this.mode === 'local') {
      // In local mode, the active player is whoever's turn it is
      this.playerIndex = this.currentTurn;
      this.state = State.MY_TURN;
      this.ui.setTurn(true, this.currentTurn + 1);
    } else {
      const isMyTurn = this.currentTurn === this.playerIndex;
      this.state = isMyTurn ? State.MY_TURN : State.OPPONENT_TURN;
      this.ui.setTurn(isMyTurn);
    }

    // Show active cannon, hide opponent's
    this.cannons[this.currentTurn].group.visible = true;
    this.cannons[1 - this.currentTurn].group.visible = false;

    this.power = C.DEFAULT_POWER;
    this.ui.updatePower(this.power, C.MIN_POWER, C.MAX_POWER);
    this.ui.setStatus('');

    // Minimap shows the current player's own castle
    const myCastleX = this.currentTurn === 0 ? -C.CASTLE_OFFSET_X : C.CASTLE_OFFSET_X;
    this.sceneManager.setupMinimap(myCastleX);

    if (this.state === State.MY_TURN) {
      this.cannons[this.currentTurn].resetAim();
    }

    this.updateCamera();
  }

  // ═══════════════════════════════════════════════════════════
  // FIRING
  // ═══════════════════════════════════════════════════════════

  fire() {
    if (this.state !== State.MY_TURN) return;

    const cannon = this.cannons[this.currentTurn];
    const pos = cannon.getFirePosition();
    const dir = cannon.getFireDirection();
    const velocity = dir.multiplyScalar(this.power);

    this.projectile = new Projectile(this.sceneManager, this.physicsWorld, pos, velocity);
    this.state = State.FIRING;
    this.trajectoryLine.visible = false;
    this.settleTimer = 0;
    this.fireTime = performance.now();
    this.ui.setStatus('Firing...');

    // Muzzle flash particles
    this._impactEmitted = false;
    this.particles.emit(pos, { x: dir.x * 8, y: dir.y * 8, z: dir.z * 8 },
      5, { r: 1, g: 0.7, b: 0.2 }, 30, 0.6);
    this.sceneManager.shake(0.3, 0.2);

    if (this.mode === 'online') {
      this.network.sendFire(cannon.yaw, cannon.pitch, this.power);
    }
  }

  handleOpponentFire(data) {
    const oppIndex = 1 - this.playerIndex;
    const cannon = this.cannons[oppIndex];

    // Apply the opponent's aim
    cannon.yaw = data.yaw;
    cannon.pitch = data.pitch;
    cannon.updateAim();

    const pos = cannon.getFirePosition();
    const dir = cannon.getFireDirection();
    const velocity = dir.multiplyScalar(data.power);

    this.projectile = new Projectile(this.sceneManager, this.physicsWorld, pos, velocity);
    this.state = State.OPPONENT_FIRING;
    this.settleTimer = 0;
    this.fireTime = performance.now();
    this.ui.setStatus('Incoming!');
    this.updateCamera();

    // Muzzle flash
    this.particles.emit(pos, { x: dir.x * 8, y: dir.y * 8, z: dir.z * 8 },
      5, { r: 1, g: 0.7, b: 0.2 }, 30, 0.6);
  }

  // ═══════════════════════════════════════════════════════════
  // INPUT HANDLING
  // ═══════════════════════════════════════════════════════════

  handleInput(dt) {
    if (this.state !== State.MY_TURN) return;

    const cannon = this.cannons[this.currentTurn];

    // Yaw (left/right)
    if (this.keys['ArrowLeft'] || this.keys['KeyA']) cannon.adjustYaw(-C.AIM_SPEED);
    if (this.keys['ArrowRight'] || this.keys['KeyD']) cannon.adjustYaw(C.AIM_SPEED);

    // Pitch (up/down)
    if (this.keys['ArrowUp'] || this.keys['KeyW']) cannon.adjustPitch(C.AIM_SPEED);
    if (this.keys['ArrowDown'] || this.keys['KeyS']) cannon.adjustPitch(-C.AIM_SPEED);

    // Power (Q/E)
    if (this.keys['KeyQ']) {
      this.power = Math.max(C.MIN_POWER, this.power - C.POWER_SPEED);
      this.ui.updatePower(this.power, C.MIN_POWER, C.MAX_POWER);
    }
    if (this.keys['KeyE']) {
      this.power = Math.min(C.MAX_POWER, this.power + C.POWER_SPEED);
      this.ui.updatePower(this.power, C.MIN_POWER, C.MAX_POWER);
    }

    // Fire (Space)
    if (this.keys['Space']) {
      this.keys['Space'] = false; // consume to prevent repeat firing
      this.fire();
      return;
    }

    this.updateCamera();
    this.updateTrajectory();
  }

  // ═══════════════════════════════════════════════════════════
  // TRAJECTORY PREVIEW
  // ═══════════════════════════════════════════════════════════

  updateTrajectory() {
    if (this.state !== State.MY_TURN || !this.debugTrajectory) {
      this.trajectoryLine.visible = false;
      return;
    }

    this.trajectoryLine.visible = true;

    const cannon = this.cannons[this.currentTurn];
    const pos = cannon.getFirePosition();
    const dir = cannon.getFireDirection();
    const vel = dir.clone().multiplyScalar(this.power);

    const points = [];
    const g = 9.82;
    const step = 0.05;
    let px = pos.x, py = pos.y, pz = pos.z;
    let vx = vel.x, vy = vel.y, vz = vel.z;

    for (let i = 0; i < 120; i++) {
      points.push(new THREE.Vector3(px, py, pz));
      px += vx * step;
      py += vy * step;
      pz += vz * step;
      vy -= g * step;
      if (py < 0) break;
    }

    this.trajectoryLine.geometry.dispose();
    this.trajectoryLine.geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.trajectoryLine.computeLineDistances();
  }

  // ═══════════════════════════════════════════════════════════
  // PROJECTILE TRACKING
  // ═══════════════════════════════════════════════════════════

  checkProjectile(dt) {
    if (!this.projectile || !this.projectile.alive) return;
    if (this.state !== State.FIRING && this.state !== State.OPPONENT_FIRING) return;

    const pos = this.projectile.getPosition();

    // Out of bounds check
    if (this.projectile.isOutOfBounds()) {
      this.projectile.destroy();
      this.projectile = null;
      this.onShotComplete(false);
      return;
    }

    // Target collision
    const targetCastle = this.castles[1 - this.currentTurn];
    const targetPos = targetCastle.getTargetPosition();

    if (targetPos && pos.distanceTo(targetPos) < 1.2) {
      // Impact particles + big shake
      this.particles.emit(pos, { x: 0, y: 5, z: 0 }, 10, { r: 1, g: 0.3, b: 0.1 }, 60, 1.2);
      this.sceneManager.shake(0.8, 0.5);
      this.projectile.destroy();
      this.projectile = null;
      this.onTargetHit();
      return;
    }

    // Detect first impact (speed drop) for debris particles
    const speed = this.projectile.getSpeed();
    if (!this._impactEmitted && speed < this.power * 0.5 && pos.y < C.CANNON_HEIGHT) {
      this._impactEmitted = true;
      this.particles.emit(pos, { x: 0, y: 4, z: 0 }, 8, { r: 0.6, g: 0.5, b: 0.35 }, 40, 1.0);
      this.sceneManager.shake(0.5, 0.3);
    }

    // Projectile has come to rest
    if (speed < 0.5 && pos.y < C.CANNON_HEIGHT) {
      this.settleTimer += dt;
      if (this.settleTimer > 1.5) {
        this.projectile.destroy();
        this.projectile = null;
        this.onShotComplete(false);
      }
    } else {
      this.settleTimer = 0;
    }
  }

  onTargetHit() {
    const damagedPlayer = 1 - this.currentTurn;
    this.hp[damagedPlayer]--;
    this.ui.updateHP(this.hp[0], this.hp[1]);

    if (this.hp[damagedPlayer] <= 0) {
      // Game over
      this.state = State.GAME_OVER;
      if (this.mode === 'local') {
        this.ui.showLocalResult(this.currentTurn + 1);
      } else {
        this.network.sendHitReport();
        this.ui.showResult(this.currentTurn === this.playerIndex);
      }
    } else {
      // Damaged player repositions their target
      this.ui.setStatus(`HIT! ${this.hp[damagedPlayer]} hit${this.hp[damagedPlayer] > 1 ? 's' : ''} remaining`);

      if (this.mode === 'local') {
        // Pass device to damaged player so they can reposition privately
        setTimeout(() => {
          this.state = State.PASS_DEVICE_REPOSITION;
          this._damagedPlayer = damagedPlayer;
          this.ui.showPassDevice(damagedPlayer + 1);
        }, 1500);
      } else {
        // Online: damaged player repositions directly
        if (damagedPlayer === this.playerIndex) {
          setTimeout(() => this.startRepositionPhase(damagedPlayer), 1500);
        }
        // TODO: wait for opponent reposition complete event
      }
    }
  }

  startRepositionPhase(damagedPlayerIndex) {
    this.state = State.REPOSITION;
    this.ui.overlay.classList.add('hidden');
    this.ui.gameUI.classList.add('hidden');
    this.sceneManager.disableMinimap();

    this.repositioner.start(
      this.castles[damagedPlayerIndex],
      damagedPlayerIndex,
      (newTargetPos) => this.onRepositionComplete(damagedPlayerIndex, newTargetPos)
    );
  }

  onRepositionComplete(damagedPlayerIndex, newTargetPos) {
    this.repositioner.stop();
    this.castles[damagedPlayerIndex].repositionTarget(newTargetPos);

    // Resume battle — turn goes to the damaged player (shooter already used theirs)
    this.currentTurn = damagedPlayerIndex;
    this.ui.showGame();
    this.onTurnStart();
  }

  onShotComplete(hit) {
    if (hit) return; // handled by onTargetHit

    if (this.mode === 'local') {
      // Advance turn locally after a brief pause
      this.state = State.GAME_OVER; // temporary: prevent further physics/input
      this.ui.setStatus('');

      setTimeout(() => {
        this.currentTurn = 1 - this.currentTurn;
        this.onTurnStart();
      }, 1000);
    } else {
      // Online: server handles turn advancement via the 'turn' event
      this.state = State.OPPONENT_TURN;
      this.ui.setStatus('Waiting...');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CAMERA
  // ═══════════════════════════════════════════════════════════

  updateCamera() {
    const cannon = this.cannons[this.currentTurn];
    if (!cannon) return;

    // Fixed spectator camera: elevated view showing both castles.
    // Slightly offset toward active player's side for perspective.
    // First-person over-the-shoulder cannon view.
    // Cannon is pushed 4 units forward of the wall — camera 3 behind stays clear.
    const fireDir = cannon.getFireDirection();
    const horizDir = new THREE.Vector3(fireDir.x, 0, fireDir.z).normalize();
    const cp = cannon.group.position;

    const camPos = cp.clone().add(horizDir.clone().multiplyScalar(-3));
    camPos.y += 3;

    // Look ahead with dampened pitch so the battlefield stays visible
    const halfPitchDir = fireDir.clone();
    halfPitchDir.y *= 0.3;
    halfPitchDir.normalize();
    const lookAt = camPos.clone().add(halfPitchDir.multiplyScalar(60));

    this.sceneManager.setCameraPosition(camPos, lookAt);
  }

  followProjectile() {
    if (!this.projectile || !this.projectile.alive) return;

    const pos = this.projectile.getPosition();
    const vel = this.projectile.body.velocity;
    const speed = this.projectile.getSpeed();

    // Smoke trail
    if (speed > 2) {
      this.particles.emit(pos, { x: 0, y: 0.5, z: 0 }, 1.5,
        { r: 0.5, g: 0.5, b: 0.5 }, 2, 0.8);
    }

    // Direction from velocity (or last known if stopped)
    let dir;
    if (speed > 1) {
      dir = new THREE.Vector3(vel.x, vel.y, vel.z).normalize();
      this._lastProjDir = dir.clone();
    } else {
      dir = this._lastProjDir || new THREE.Vector3(1, 0, 0);
    }

    // Camera trails behind the projectile, elevated
    const camPos = pos.clone().sub(dir.clone().multiplyScalar(6));
    camPos.y += 3;

    this.sceneManager.setCameraPosition(camPos, pos);
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN UPDATE LOOP
  // ═══════════════════════════════════════════════════════════

  update() {
    const dt = this.clock.getDelta();

    // Non-gameplay states: just render the scene (no physics, no input)
    if (
      this.state === State.MENU ||
      this.state === State.BUILD ||
      this.state === State.PASS_DEVICE ||
      this.state === State.PASS_DEVICE_REPOSITION ||
      this.state === State.WAITING_OPPONENT_BUILD ||
      this.state === State.REPOSITION
    ) {
      this.sceneManager.render();
      return;
    }

    this.handleInput(dt);

    // Step physics during active gameplay
    if (this.state !== State.GAME_OVER) {
      this.physicsWorld.step(dt);
      this.physicsWorld.sync();
    }

    this.checkProjectile(dt);

    // Follow projectile with camera during firing
    if (this.state === State.FIRING || this.state === State.OPPONENT_FIRING) {
      if (this.projectile && this.projectile.alive) {
        this.followProjectile();
      }

      // Skip / auto-advance after firing
      const elapsed = (performance.now() - this.fireTime) / 1000;
      if (elapsed > 2 && this.state === State.FIRING) {
        this.ui.setStatus('Press Space to skip');
        if (this.keys['Space']) {
          this.keys['Space'] = false;
          if (this.projectile) { this.projectile.destroy(); this.projectile = null; }
          this.onShotComplete(false);
        }
      }
      // Auto-advance after 6 seconds regardless
      if (elapsed > 6) {
        if (this.projectile) { this.projectile.destroy(); this.projectile = null; }
        this.onShotComplete(false);
      }
    }

    // Update particles and camera
    this.particles.update(dt);
    this.sceneManager.updateCamera(dt);
    this.sceneManager.render();
  }

  // ═══════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════

  cleanup() {
    this.castles.forEach((c) => { if (c) c.clear(); });
    this.cannons.forEach((c) => { if (c) c.destroy(); });
    if (this.projectile) {
      this.projectile.destroy();
      this.projectile = null;
    }
    this.physicsWorld.clear();

    this.castles = [null, null];
    this.cannons = [null, null];
    this.castleData = [null, null];
    this.trajectoryLine.visible = false;
    this.particles.clear();
    this.builder.stop();
    this.repositioner.stop();
    this.hp = [C.MAX_HP, C.MAX_HP];
    this.sceneManager.disableMinimap();

    if (this.network.socket) this.network.disconnect();
  }
}
