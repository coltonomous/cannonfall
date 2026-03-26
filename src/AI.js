import { MIN_POWER, MAX_POWER, MIN_PITCH, MAX_PITCH, MAX_YAW_OFFSET } from './constants.js';

const DIFFICULTY = {
  EASY:   { spreadRad: 0.18, powerOffset: 8,  aimTime: 2.0, repositionStrategy: 'random' },
  MEDIUM: { spreadRad: 0.10, powerOffset: 5,  aimTime: 1.5, repositionStrategy: 'covered' },
  HARD:   { spreadRad: 0.04, powerOffset: 2,  aimTime: 1.0, repositionStrategy: 'optimal' },
};

export class AI {
  constructor(difficulty = 'MEDIUM') {
    this.difficulty = DIFFICULTY[difficulty] || DIFFICULTY.MEDIUM;
    this._aiming = false;
    this._aimProgress = 0;
    this._startYaw = 0;
    this._startPitch = 0;
    this._targetYaw = 0;
    this._targetPitch = 0;
    this._targetPower = 0;
    this._aimResolve = null;
  }

  computeAim(cannon, targetPos, gameMode) {
    const cp = cannon.group.position;
    const facing = cannon.facingDirection;
    const dx = targetPos.x - cp.x;
    const dy = targetPos.y - cp.y;
    const dz = targetPos.z - cp.z;
    const horizDist = Math.sqrt(dx * dx + dz * dz);
    const g = Math.abs(gameMode.gravity);

    if (g === 0) return this._zeroGAim(dx, dy, dz, horizDist, facing);
    return this._gravityAim(dx, dy, dz, horizDist, g, facing);
  }

  _computeYaw(dx, dz, facing) {
    const baseAngle = facing === 1 ? Math.PI / 2 : -Math.PI / 2;
    // Three.js Y-rotation: atan2(x, z) gives angle from +Z axis
    let yaw = Math.atan2(dx, dz) - baseAngle;
    while (yaw > Math.PI) yaw -= 2 * Math.PI;
    while (yaw < -Math.PI) yaw += 2 * Math.PI;
    return yaw;
  }

  _zeroGAim(dx, dy, dz, dist, facing) {
    const yaw = this._computeYaw(dx, dz, facing);
    const pitch = Math.asin(Math.max(-1, Math.min(1, dy / dist)));
    const power = Math.min(MAX_POWER, Math.max(MIN_POWER, dist * 1.2));
    return { yaw, pitch, power };
  }

  _gravityAim(dx, dy, dz, horizDist, g, facing) {
    const yaw = this._computeYaw(dx, dz, facing);

    // Solve ballistic equation for pitch given power
    // h = d*tan(θ) - g*d²/(2*p²*cos²(θ))
    // Rearranges to quadratic in tan(θ)
    let bestPitch = Math.PI / 4;
    let bestPower = (MIN_POWER + MAX_POWER) / 2;

    for (let p = MAX_POWER; p >= MIN_POWER; p -= 2) {
      const d = horizDist;
      const h = dy;
      const a = (g * d * d) / (2 * p * p);
      if (a === 0) continue;
      const disc = d * d - 4 * a * (h + a);
      if (disc < 0) continue;

      // Low arc (prefer aggressive trajectory)
      const tanTheta = (d - Math.sqrt(disc)) / (2 * a);
      const pitch = Math.atan(tanTheta);
      if (pitch >= MIN_PITCH && pitch <= MAX_PITCH) {
        bestPitch = pitch;
        bestPower = p;
        break;
      }

      // High arc fallback
      const tanTheta2 = (d + Math.sqrt(disc)) / (2 * a);
      const pitch2 = Math.atan(tanTheta2);
      if (pitch2 >= MIN_PITCH && pitch2 <= MAX_PITCH) {
        bestPitch = pitch2;
        bestPower = p;
        break;
      }
    }

    return { yaw, pitch: bestPitch, power: bestPower };
  }

  applySpread(aim) {
    const { spreadRad, powerOffset } = this.difficulty;
    return {
      yaw: aim.yaw + (Math.random() - 0.5) * 2 * spreadRad,
      pitch: aim.pitch + (Math.random() - 0.5) * 2 * spreadRad,
      power: Math.max(MIN_POWER, Math.min(MAX_POWER,
        aim.power + (Math.random() - 0.5) * 2 * powerOffset)),
    };
  }

  /**
   * Choose a reposition target based on difficulty.
   * - random: any grid cell
   * - covered: prefer cells with blocks above them
   * - optimal: pick the most protected cell (most blocks overhead)
   */
  chooseRepositionTarget(castle) {
    const gw = castle.gridWidth || 9;
    const gd = castle.gridDepth || 9;
    const strategy = this.difficulty.repositionStrategy;

    if (strategy === 'random') {
      return { x: Math.floor(Math.random() * gw), y: 0, z: Math.floor(Math.random() * gd) };
    }

    // Score each grid cell by how many blocks are above it (cover)
    const layout = castle.layoutData || [];
    const scores = [];
    for (let x = 0; x < gw; x++) {
      for (let z = 0; z < gd; z++) {
        const blocksAbove = layout.filter(b => b.x === x && b.z === z && b.y >= 0).length;
        scores.push({ x, z, cover: blocksAbove });
      }
    }

    if (strategy === 'optimal') {
      // Pick the best-covered cell
      scores.sort((a, b) => b.cover - a.cover);
      // Small random selection from top candidates to avoid being too predictable
      const top = scores.slice(0, Math.max(3, Math.floor(scores.length * 0.1)));
      const pick = top[Math.floor(Math.random() * top.length)];
      return { x: pick.x, y: 0, z: pick.z };
    }

    // covered: prefer cells with some cover, but not strictly the best
    const covered = scores.filter(s => s.cover > 0);
    if (covered.length > 0) {
      const pick = covered[Math.floor(Math.random() * covered.length)];
      return { x: pick.x, y: 0, z: pick.z };
    }
    // Fallback to random if no cover exists
    const pick = scores[Math.floor(Math.random() * scores.length)];
    return { x: pick.x, y: 0, z: pick.z };
  }

  startAiming(cannon, targetAim) {
    return new Promise((resolve) => {
      this._aiming = true;
      this._aimProgress = 0;
      this._startYaw = cannon.yaw;
      this._startPitch = cannon.pitch;
      this._targetYaw = Math.max(-MAX_YAW_OFFSET, Math.min(MAX_YAW_OFFSET, targetAim.yaw));
      this._targetPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, targetAim.pitch));
      this._targetPower = Math.max(MIN_POWER, Math.min(MAX_POWER, targetAim.power));
      this._aimResolve = resolve;
    });
  }

  /** Call each frame during AI_AIMING. Returns true when done. */
  updateAiming(dt, cannon) {
    if (!this._aiming) return false;

    this._aimProgress += dt / this.difficulty.aimTime;
    if (this._aimProgress >= 1) {
      this._aimProgress = 1;
      this._aiming = false;
      cannon.yaw = this._targetYaw;
      cannon.pitch = this._targetPitch;
      cannon.updateAim();
      if (this._aimResolve) {
        this._aimResolve({ yaw: this._targetYaw, pitch: this._targetPitch, power: this._targetPower });
        this._aimResolve = null;
      }
      return true;
    }

    // Ease-in-out
    const t = this._aimProgress;
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    cannon.yaw = this._startYaw + (this._targetYaw - this._startYaw) * ease;
    cannon.pitch = this._startPitch + (this._targetPitch - this._startPitch) * ease;
    cannon.updateAim();
    return false;
  }
}
