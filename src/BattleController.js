import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Projectile } from './Projectile.js';
import * as C from './constants.js';

// Collision group flags for projectile-target detection
const COL_DEFAULT = 1;
const COL_TARGET = 2;
const COL_PROJECTILE = 4;

export class BattleController {
  constructor({ sceneManager, physicsWorld, particles, ui, network }) {
    this.sceneManager = sceneManager;
    this.physicsWorld = physicsWorld;
    this.particles = particles;
    this.ui = ui;
    this.network = network;

    // Synced from Game before each battle
    this.castles = [null, null];
    this.cannons = [null, null];
    this.currentTurn = 0;
    this.mode = null;
    this.playerIndex = 0;
    this.gameMode = null;

    // Battle state
    this.projectile = null;
    this.power = C.DEFAULT_POWER;
    this.charging = false;
    this.chargeTime = 0;
    this.settleTimer = 0;
    this.fireTime = 0;
    this._impactEmitted = false;
    this._perfectShot = false;
    this._lastProjDir = null;
    this._pendingTargetHit = false;
    this._pendingSpaceImpact = null;

    // Replay state
    this._replayData = null;
    this._replayTimeScale = 1;
    this._replayPhase = null; // 'follow' | 'orbit'
    this._replayElapsed = 0;
    this._replayImpactPos = null;

    // Trajectory / aiming visuals
    this.trajectoryLine = null;
    this.impactBeam = null;
    this.impactRing = null;
    this._createTrajectoryLine();
    this._createImpactBeam();

    // Callbacks into Game (set via setCallbacks)
    this._onHitLocal = null;
    this._onShotMiss = null;
    this._onReportShot = null;
    this._debugLog = null;
  }

  setCallbacks({ onHitLocal, onShotMiss, onReportShot, debugLog }) {
    this._onHitLocal = onHitLocal;
    this._onShotMiss = onShotMiss;
    this._onReportShot = onReportShot;
    this._debugLog = debugLog;
  }

  sync({ castles, cannons, currentTurn, mode, playerIndex, gameMode }) {
    this.castles = castles;
    this.cannons = cannons;
    this.currentTurn = currentTurn;
    this.mode = mode;
    this.playerIndex = playerIndex;
    if (gameMode) this.gameMode = gameMode;
  }

  // ── Trajectory ────────────────────────────────────────────

  _createTrajectoryLine() {
    const mat = new THREE.LineDashedMaterial({
      color: 0xffff00,
      dashSize: 0.5,
      gapSize: 0.3,
    });
    // Pre-allocate trajectory buffers to avoid per-frame geometry allocation
    this._trajMaxPoints = 120;
    this._trajPositions = new Float32Array(this._trajMaxPoints * 3);
    this._trajDistances = new Float32Array(this._trajMaxPoints);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._trajPositions, 3));
    geo.setAttribute('lineDistance', new THREE.BufferAttribute(this._trajDistances, 1));
    geo.setDrawRange(0, 0);
    this.trajectoryLine = new THREE.Line(geo, mat);
    this.trajectoryLine.visible = false;
    this.sceneManager.scene.add(this.trajectoryLine);

    // Reticle for zero-G modes (crosshair at aim point)
    const reticleGroup = new THREE.Group();
    const rMat = new THREE.LineBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.8 });
    const size = 0.6;
    // Horizontal line
    const hGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-size, 0, 0), new THREE.Vector3(size, 0, 0),
    ]);
    reticleGroup.add(new THREE.Line(hGeo, rMat));
    // Vertical line
    const vGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -size, 0), new THREE.Vector3(0, size, 0),
    ]);
    reticleGroup.add(new THREE.Line(vGeo, rMat));
    // Circle
    const circlePoints = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      circlePoints.push(new THREE.Vector3(Math.cos(a) * size * 0.7, Math.sin(a) * size * 0.7, 0));
    }
    const cGeo = new THREE.BufferGeometry().setFromPoints(circlePoints);
    reticleGroup.add(new THREE.Line(cGeo, rMat));

    reticleGroup.visible = false;
    this.reticle = reticleGroup;
    this.sceneManager.scene.add(this.reticle);
  }

  _createImpactBeam() {
    const beamHeight = 8;
    const beamGeo = new THREE.CylinderGeometry(0.06, 0.06, beamHeight, 8);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xff2222,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.impactBeam = new THREE.Mesh(beamGeo, beamMat);
    this.impactBeam.visible = false;
    this.sceneManager.scene.add(this.impactBeam);

    // Outer glow cylinder — wider, more transparent
    const glowGeo = new THREE.CylinderGeometry(0.2, 0.2, beamHeight, 8);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    });
    this.impactBeamGlow = new THREE.Mesh(glowGeo, glowMat);
    this.impactBeam.add(this.impactBeamGlow);

    // Base ring
    const ringGeo = new THREE.RingGeometry(0.4, 0.7, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff2222,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.impactRing = new THREE.Mesh(ringGeo, ringMat);
    this.impactRing.rotation.x = -Math.PI / 2;
    this.impactRing.visible = false;
    this.sceneManager.scene.add(this.impactRing);

    // Inner dot
    const dotGeo = new THREE.RingGeometry(0, 0.15, 12);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xff4444,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.impactDot = new THREE.Mesh(dotGeo, dotMat);
    this.impactDot.rotation.x = -Math.PI / 2;
    this.impactRing.add(this.impactDot);
  }

  _findArcImpact(pos, vel, g) {
    const step = 0.05;
    let px = pos.x, py = pos.y, pz = pos.z;
    let vx = vel.x, vy = vel.y, vz = vel.z;
    let prevX = px, prevY = py, prevZ = pz;

    const groundY = this.gameMode.waterSurface ? 0 : 0;
    const ray = new CANNON.Ray();

    for (let i = 0; i < this._trajMaxPoints; i++) {
      prevX = px; prevY = py; prevZ = pz;
      px += vx * step;
      py += vy * step;
      pz += vz * step;
      vy -= g * step;

      // Check for block collision via physics raycast between arc segments
      if (i > 0) {
        const from = new CANNON.Vec3(prevX, prevY, prevZ);
        const to = new CANNON.Vec3(px, py, pz);
        const result = new CANNON.RaycastResult();
        const hit = this.physicsWorld.world.raycastClosest(
          from, to,
          { skipBackfaces: true, collisionFilterMask: -1 },
          result
        );
        if (hit && result.hasHit) {
          const hp = result.hitPointWorld;
          // Skip ground plane hits — we handle ground intersection via the arc math
          if (result.body !== this.physicsWorld.groundBody &&
              !result.body.isTarget) {
            return { x: hp.x, y: hp.y, z: hp.z };
          }
        }
      }

      // Ground intersection
      if (py <= groundY) {
        // Interpolate exact ground hit
        const t = (prevY - groundY) / (prevY - py);
        return {
          x: prevX + (px - prevX) * t,
          y: groundY,
          z: prevZ + (pz - prevZ) * t,
        };
      }

      if (py < this.gameMode.outOfBoundsY) break;
    }

    return null; // no impact found (shot goes out of bounds or too far)
  }

  updateTrajectory() {
    const cannon = this.cannons[this.currentTurn];
    const pos = cannon.getFirePosition();
    const dir = cannon.getFireDirection();
    const g = Math.abs(this.gameMode.gravity);

    if (g === 0) {
      // Zero-G: show reticle while aiming (hides on fire via fire())
      this.trajectoryLine.visible = false;
      this.reticle.visible = true;

      // Lerp reticle to aim point for smooth feel; snap on first frame
      const reticleDist = 40;
      const target = pos.clone().add(dir.clone().multiplyScalar(reticleDist));
      if (!this._reticleInitialized) {
        this.reticle.position.copy(target);
        this._reticleInitialized = true;
      } else {
        this.reticle.position.lerp(target, 0.15);
      }
      this.reticle.lookAt(this.sceneManager.camera.position);

      // Gentle pulse
      const pulse = 1.0 + 0.15 * Math.sin(performance.now() * 0.004);
      this.reticle.scale.setScalar(pulse);
    } else {
      // Normal gravity: show impact beam at predicted landing point
      this.reticle.visible = false;
      this.trajectoryLine.visible = false;

      const vel = dir.clone().multiplyScalar(this.power);
      const impact = this._findArcImpact(pos, vel, g);

      if (impact) {
        const beamHeight = 8;
        this.impactBeam.position.set(impact.x, impact.y + beamHeight / 2, impact.z);
        this.impactBeam.visible = true;

        this.impactRing.position.set(impact.x, impact.y + 0.05, impact.z);
        this.impactRing.visible = true;

        // Pulse
        const t = performance.now() * 0.005;
        const pulse = 0.3 + 0.15 * Math.sin(t);
        this.impactBeam.material.opacity = pulse;
        this.impactBeamGlow.material.opacity = pulse * 0.3;
        this.impactRing.material.opacity = pulse + 0.15;
        this.impactDot.material.opacity = pulse + 0.25;

        // Ring pulse scale
        const ringPulse = 1.0 + 0.1 * Math.sin(t * 1.5);
        this.impactRing.scale.setScalar(ringPulse);
      } else {
        this.impactBeam.visible = false;
        this.impactRing.visible = false;
      }
    }
  }

  // ── Projectile Collision Setup ───────────────────────────

  _setupProjectileCollision() {
    this._pendingTargetHit = false;
    this._pendingSpaceImpact = null;
    this._collisionListener = (e) => {
      if (!this.projectile || !this.projectile.alive) return;
      if (e.body.isTarget) {
        // Defer — can't remove bodies mid-physics step
        this._pendingTargetHit = true;
        return;
      }
      if (this.gameMode.explosiveProjectile && !this._pendingSpaceImpact) {
        this._pendingSpaceImpact = e.body;
      }
    };
    this.projectile.body.addEventListener('collide', this._collisionListener);
  }

  _handleDirectTargetHit() {
    const pos = this.projectile.getPosition();
    this.particles.emit(pos, { x: 0, y: 5, z: 0 }, 10, { r: 1, g: 0.3, b: 0.1 }, 60, 1.2);
    this.sceneManager.shake(0.8, 0.5);
    this.projectile.destroy();
    this.projectile = null;

    if (this.mode === 'online') {
      this._onReportShot(true, this._perfectShot);
      this.ui.setStatus('Hit detected...');
    } else {
      this._onHitLocal();
    }
  }

  // ── Firing ────────────────────────────────────────────────

  fire(debugPerfectShot) {
    const powerFrac = (this.power - C.MIN_POWER) / (C.MAX_POWER - C.MIN_POWER);
    this._perfectShot = debugPerfectShot || (powerFrac >= C.PERFECT_MIN && powerFrac <= C.PERFECT_MAX);
    if (this._debugLog) this._debugLog('Fire:', { power: this.power.toFixed(1), perfect: this._perfectShot, powerFrac: powerFrac.toFixed(3) });

    const cannon = this.cannons[this.currentTurn];
    const pos = cannon.getFirePosition();
    const dir = cannon.getFireDirection();
    // Perfect shots guarantee max power — the reward for hitting the sweet spot
    const power = this._perfectShot ? C.MAX_POWER : this.power;

    this.trajectoryLine.visible = false;
    this.reticle.visible = false;
    if (this.impactBeam) this.impactBeam.visible = false;
    if (this.impactRing) this.impactRing.visible = false;
    this._reticleInitialized = false;
    this._impactEmitted = false;
    this.settleTimer = 0;
    this.fireTime = performance.now();

    // Capture for potential replay
    this._replayData = { firePos: pos.clone(), fireDir: dir.clone(), power, isPerfect: this._perfectShot };

    if (this.mode === 'online') {
      this.network.sendFire(cannon.yaw, cannon.pitch, power);
    }

    const launchProjectile = () => {
      const velocity = dir.clone().multiplyScalar(power);
      this.projectile = new Projectile(this.sceneManager, this.physicsWorld, pos, velocity, this._perfectShot, this.gameMode);
      this._setupProjectileCollision();

      // Muzzle flash
      if (this._perfectShot) {
        this.particles.emit(pos, { x: dir.x * 12, y: dir.y * 12, z: dir.z * 12 },
          7, this.gameMode.perfectMuzzleColor, 60, 1.0);
        this.sceneManager.shake(0.7, 0.4);
      } else {
        this.particles.emit(pos, { x: dir.x * 8, y: dir.y * 8, z: dir.z * 8 },
          5, this.gameMode.muzzleColor, 30, 0.6);
        this.sceneManager.shake(0.3, 0.2);
      }
    };

    if (this._perfectShot) {
      this.ui.setStatus('PERFECT!');
      this.sceneManager.shake(0.2, 0.3);
      this.particles.emit(pos, { x: 0, y: 3, z: 0 }, 3, { r: 1, g: 0.9, b: 0.3 }, 25, 0.5);
      setTimeout(() => launchProjectile(), C.PERFECT_FIRE_DELAY);
    } else {
      this.ui.setStatus('Firing...');
      launchProjectile();
    }
  }

  handleOpponentFire(data) {
    const oppIndex = 1 - this.playerIndex;
    const cannon = this.cannons[oppIndex];

    cannon.yaw = data.yaw;
    cannon.pitch = data.pitch;
    cannon.updateAim();

    const pos = cannon.getFirePosition();
    const dir = cannon.getFireDirection();
    const velocity = dir.multiplyScalar(data.power);

    this.projectile = new Projectile(this.sceneManager, this.physicsWorld, pos, velocity, false, this.gameMode);
    this._setupProjectileCollision();

    this.settleTimer = 0;
    this.fireTime = performance.now();
    this.ui.setStatus('Incoming!');

    // Muzzle flash
    this.particles.emit(pos, { x: dir.x * 8, y: dir.y * 8, z: dir.z * 8 },
      5, this.gameMode.muzzleColor, 30, 0.6);
  }

  // ── Projectile Tracking ───────────────────────────────────

  checkProjectile(dt) {
    if (!this.projectile || !this.projectile.alive) return false;

    // Process deferred collision events (can't remove bodies mid-physics step)
    if (this._pendingTargetHit) {
      this._pendingTargetHit = false;
      this._handleDirectTargetHit();
      return true;
    }
    if (this._pendingSpaceImpact) {
      const hitBody = this._pendingSpaceImpact;
      this._pendingSpaceImpact = null;
      this._handleSpaceImpact(hitBody);
      return true;
    }

    const pos = this.projectile.getPosition();

    // Out of bounds
    if (this.projectile.isOutOfBounds()) {
      this.projectile.destroy();
      this.projectile = null;
      this._onShotMiss();
      return true;
    }

    // First impact debris
    const speed = this.projectile.getSpeed();
    if (!this._impactEmitted && speed < this.power * C.IMPACT_SPEED_RATIO && pos.y < C.CANNON_HEIGHT) {
      this._impactEmitted = true;
      this.particles.emit(pos, { x: 0, y: 4, z: 0 }, 8, this.gameMode.impactColor, 40, 1.0);
      this.sceneManager.shake(0.5, 0.3);
    }

    // Settled
    if (speed < C.SETTLE_SPEED && pos.y < C.CANNON_HEIGHT) {
      this.settleTimer += dt;
      if (this.settleTimer > C.SETTLE_TIME) {
        this.projectile.destroy();
        this.projectile = null;
        this._onShotMiss();
        return true;
      }
    } else {
      this.settleTimer = 0;
    }

    return false;
  }

  followProjectile() {
    if (!this.projectile || !this.projectile.alive) return;

    const pos = this.projectile.getPosition();
    const vel = this.projectile.body.velocity;
    const speed = this.projectile.getSpeed();

    // Smoke trail
    if (speed > 2) {
      this.particles.emit(pos, { x: 0, y: 0.5, z: 0 }, 1.5,
        this.gameMode.trailColor, 2, 0.8);
    }

    let dir;
    if (speed > 1) {
      dir = new THREE.Vector3(vel.x, vel.y, vel.z).normalize();
      this._lastProjDir = dir.clone();
    } else {
      dir = this._lastProjDir || new THREE.Vector3(1, 0, 0);
    }

    const camPos = pos.clone().sub(dir.clone().multiplyScalar(6));
    camPos.y += 3;

    this.sceneManager.setCameraPosition(camPos, pos);
  }

  // ── Space Explosion ───────────────────────────────────────

  _handleSpaceImpact(hitBody) {
    if (!this.projectile || !this.projectile.alive) return;

    const impactPos = this.projectile.getPosition();
    const gm = this.gameMode;

    // Scale explosion by charge power (0.3 at min power, 1.0 at max)
    const powerFrac = Math.max(0.3, (this.power - C.MIN_POWER) / (C.MAX_POWER - C.MIN_POWER));

    // Shields absorb most of the blast energy
    const shieldDampen = hitBody?.isShield ? 0.2 : 1.0;
    const baseRadius = this._perfectShot ? (gm.perfectBlastRadius || 6) : (gm.blastRadius || 4);
    const baseForce = this._perfectShot ? (gm.perfectBlastForce || 25) : (gm.blastForce || 12);
    const blastRadius = baseRadius * powerFrac * shieldDampen;
    const blastForce = baseForce * powerFrac * shieldDampen;

    // Explosive impulse to nearby blocks
    for (const castle of this.castles) {
      if (!castle) continue;
      for (const { body } of castle.blocks) {
        if (body.mass === 0) continue;
        const dx = body.position.x - impactPos.x;
        const dy = body.position.y - impactPos.y;
        const dz = body.position.z - impactPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < blastRadius && dist > 0.1) {
          const strength = blastForce * (1 - dist / blastRadius);
          const nx = dx / dist;
          const ny = dy / dist;
          const nz = dz / dist;
          body.applyImpulse(
            new CANNON.Vec3(nx * strength, ny * strength, nz * strength)
          );
          body.wakeUp();
        }
      }
    }

    // Explosion effect — big radial burst + flash
    const isPerfect = this._perfectShot;
    const shakeIntensity = isPerfect ? 1.5 : 1.0;
    const shakeDuration = isPerfect ? 0.8 : 0.6;
    const particleCount = isPerfect ? 100 : 60;
    const burstSpeed = isPerfect ? 15 : 10;

    // Radial burst — particles fly outward in all directions
    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = burstSpeed * (0.3 + Math.random() * 0.7);
      const vel = {
        x: Math.sin(phi) * Math.cos(theta) * speed,
        y: Math.sin(phi) * Math.sin(theta) * speed,
        z: Math.cos(phi) * speed,
      };
      this.particles.emit(impactPos, vel, 1.5,
        this.gameMode.impactColor, 1, 1.0 + Math.random() * 0.5, { noGravity: true });
    }
    // Core flash — bright hot center
    this.particles.emit(impactPos, { x: 0, y: 0, z: 0 }, 3,
      { r: 1, g: 0.9, b: 0.6 }, 20, 0.3, { noGravity: true });

    this.sceneManager.shake(shakeIntensity, shakeDuration);

    // AoE target check — explosion can damage the target even without direct contact
    const targetCastle = this.castles[1 - this.currentTurn];
    const targetPos = targetCastle.getTargetPosition();
    if (targetPos && impactPos.distanceTo(targetPos) < C.EXPLOSIVE_HIT_RADIUS) {
      this.projectile.destroy();
      this.projectile = null;

      if (this.mode === 'online') {
        this._onReportShot(true, this._perfectShot);
        this.ui.setStatus('Hit detected...');
      } else {
        this._onHitLocal();
      }
      return;
    }

    this.projectile.destroy();
    this.projectile = null;
    this._onShotMiss();
  }

  // ── Camera ────────────────────────────────────────────────

  updateCamera(snap = false) {
    const cannon = this.cannons[this.currentTurn];
    if (!cannon) return;

    const fireDir = cannon.getFireDirection();
    const horizDir = new THREE.Vector3(fireDir.x, 0, fireDir.z).normalize();
    const cp = cannon.group.position;

    const camPos = cp.clone().add(horizDir.clone().multiplyScalar(-3));
    camPos.y += 3;

    const halfPitchDir = fireDir.clone();
    halfPitchDir.y *= 0.3;
    halfPitchDir.normalize();
    const lookAt = camPos.clone().add(halfPitchDir.multiplyScalar(60));

    if (snap) {
      this.sceneManager.snapCamera(camPos, lookAt);
    } else {
      this.sceneManager.setCameraPosition(camPos, lookAt);
    }

    // Rock camera with the ship in water mode
    if (this.physicsWorld.waterSurface && this.physicsWorld._shipWaveCache) {
      const myCastleX = this.castles[this.currentTurn]?.centerX;
      const wave = this.physicsWorld._shipWaveCache.get(myCastleX);
      if (wave) {
        this.sceneManager.camera.rotation.z = wave.roll * 1.2;
      }
    }
  }

  // ── Replay ──────────────────────────────────────────────

  startReplay() {
    if (!this._replayData) return false;
    this._replayTimeScale = C.REPLAY_TIME_SCALE;
    this._replayPhase = 'follow';
    this._replayElapsed = 0;
    this._replayImpactPos = null;

    this.destroyProjectile();

    const { firePos, fireDir, power, isPerfect } = this._replayData;
    const velocity = fireDir.clone().multiplyScalar(power);
    this.projectile = new Projectile(this.sceneManager, this.physicsWorld, firePos, velocity, isPerfect, this.gameMode);
    this._setupProjectileCollision();
    this.fireTime = performance.now();
    this._impactEmitted = false;
    this.settleTimer = 0;
    return true;
  }

  updateReplayCamera(dt) {
    this._replayElapsed += dt;

    if (this._replayPhase === 'follow' && this.projectile?.alive) {
      const pos = this.projectile.getPosition();
      const vel = this.projectile.body.velocity;
      const speed = this.projectile.getSpeed();

      let dir;
      if (speed > 1) {
        dir = new THREE.Vector3(vel.x, vel.y, vel.z).normalize();
        this._lastProjDir = dir.clone();
      } else {
        dir = this._lastProjDir || new THREE.Vector3(1, 0, 0);
      }

      const sideOffset = Math.sin(this._replayElapsed * 0.3) * 3;
      const camPos = pos.clone()
        .sub(dir.clone().multiplyScalar(10))
        .add(new THREE.Vector3(0, 5, sideOffset));
      this.sceneManager.setCameraPosition(camPos, pos);

      if (speed > 2) {
        this.particles.emit(pos, { x: 0, y: 0.5, z: 0 }, 1.5, this.gameMode.trailColor, 2, 0.8);
      }
    } else if (this._replayPhase === 'orbit' && this._replayImpactPos) {
      const center = this._replayImpactPos;
      const t = this._replayElapsed;
      const radius = Math.max(5, 12 - t * 1.5);
      const angle = t * 0.8;
      const height = 4 + Math.sin(t * 0.5) * 2;
      const camPos = new THREE.Vector3(
        center.x + Math.cos(angle) * radius,
        center.y + height,
        center.z + Math.sin(angle) * radius
      );
      this.sceneManager.setCameraPosition(camPos, center);
    }
  }

  onReplayImpact(pos) {
    this._replayImpactPos = pos.clone();
    this._replayPhase = 'orbit';
    this._replayElapsed = 0;
  }

  // ── Fallen Blocks ─────────────────────────────────────────

  cleanupFallenBlocks() {
    const debrisField = this.gameMode.debrisField;
    const boundsX = debrisField ? 100 : 60;
    const boundsZ = debrisField ? 100 : 60;

    for (const castle of this.castles) {
      if (!castle) continue;
      for (let i = castle.blocks.length - 1; i >= 0; i--) {
        const { mesh, body } = castle.blocks[i];

        // In debris field mode, keep drifting blocks awake so they float visibly
        if (debrisField && body.mass > 0) {
          body.allowSleep = false;
        }

        // Shield fade: mark as hit when knocked, then fade out steadily
        if (body.isShield && mesh && body.mass > 0) {
          const speed = body.velocity.length();
          if (speed > 0.5) body._shieldHit = true;
          if (body._shieldHit) {
            mesh.material.opacity = Math.max(0, mesh.material.opacity - 0.03);
            mesh.material.transparent = true;
            if (mesh.material.opacity <= 0) {
              castle.sceneManager.scene.remove(mesh);
              mesh.material.dispose();
              castle.physicsWorld.world.removeBody(body);
              const pairIdx = castle.physicsWorld.pairs.findIndex(p => p.mesh === mesh);
              if (pairIdx >= 0) castle.physicsWorld.pairs.splice(pairIdx, 1);
              castle.blocks.splice(i, 1);
              continue;
            }
          }
        }

        if (body.position.y < this.gameMode.outOfBoundsY || Math.abs(body.position.x) > boundsX || Math.abs(body.position.z) > boundsZ) {
          if (mesh) castle.sceneManager.scene.remove(mesh);
          castle.physicsWorld.world.removeBody(body);
          const pairIdx = castle.physicsWorld.pairs.findIndex(p => p.mesh === mesh);
          if (pairIdx >= 0) castle.physicsWorld.pairs.splice(pairIdx, 1);
          castle.blocks.splice(i, 1);
        }
      }
    }
  }

  // ── Thruster Exhaust ────────────────────────────────────

  updateThrusters() {
    for (const castle of this.castles) {
      if (!castle) continue;
      for (const thruster of castle.thrusters) {
        // Only emit if the thruster block is still alive (body in world)
        if (!thruster.body.world) continue;

        // Emit position: block center + offset along exhaust direction
        const pos = thruster.mesh.position.clone()
          .add(thruster.exhaustDir.clone().multiplyScalar(0.4));

        // Emit a small puff along the exhaust direction
        const vel = {
          x: thruster.exhaustDir.x * 8,
          y: thruster.exhaustDir.y * 8,
          z: thruster.exhaustDir.z * 8,
        };

        this.particles.emit(pos, vel, 2.5,
          this.gameMode.muzzleColor, 2, 0.6, { noGravity: true });
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────

  destroyProjectile() {
    if (this.projectile) {
      if (this._collisionListener) {
        this.projectile.body.removeEventListener('collide', this._collisionListener);
        this._collisionListener = null;
      }
      this.projectile.destroy();
      this.projectile = null;
    }
  }

  reset() {
    this.destroyProjectile();
    this.trajectoryLine.visible = false;
    this.reticle.visible = false;
    if (this.impactBeam) this.impactBeam.visible = false;
    if (this.impactRing) this.impactRing.visible = false;
    this.power = C.DEFAULT_POWER;
    this.charging = false;
    this.chargeTime = 0;
    this.settleTimer = 0;
    this._lastProjDir = null;
    this._perfectShot = false;
    this._impactEmitted = false;
    this._pendingTargetHit = false;
    this._pendingSpaceImpact = null;
    this._reticleInitialized = false;
  }
}
