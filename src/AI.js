import { MIN_POWER, MAX_POWER, MIN_PITCH, MAX_PITCH, MAX_YAW_OFFSET } from './constants.js';

const DIFFICULTY = {
  EASY: {
    spreadRad: 0.18,
    powerOffset: 8,
    aimTime: 2.5,
    repositionStrategy: 'random',
    preferHighArc: true,      // takes lobbing shots — easier to dodge/read
    powerStrategy: 'random',  // picks random power, doesn't optimize
    hesitation: 0.6,          // extra pause before firing (seconds)
  },
  MEDIUM: {
    spreadRad: 0.10,
    powerOffset: 5,
    aimTime: 1.5,
    repositionStrategy: 'covered',
    preferHighArc: false,
    powerStrategy: 'balanced', // tries to optimize but not perfectly
    hesitation: 0.3,
  },
  HARD: {
    spreadRad: 0.04,
    powerOffset: 2,
    aimTime: 0.8,
    repositionStrategy: 'optimal',
    preferHighArc: false,
    powerStrategy: 'optimal',  // picks the best power for the trajectory
    hesitation: 0.0,
  },
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

    let power;
    if (this.difficulty.powerStrategy === 'random') {
      power = MIN_POWER + Math.random() * (MAX_POWER - MIN_POWER);
    } else if (this.difficulty.powerStrategy === 'optimal') {
      power = Math.min(MAX_POWER, Math.max(MIN_POWER, dist * 1.2));
    } else {
      // balanced: aim near the right power but with some variance
      const ideal = Math.min(MAX_POWER, Math.max(MIN_POWER, dist * 1.2));
      power = ideal + (Math.random() - 0.5) * 10;
      power = Math.max(MIN_POWER, Math.min(MAX_POWER, power));
    }

    return { yaw, pitch, power };
  }

  _gravityAim(dx, dy, dz, horizDist, g, facing) {
    const yaw = this._computeYaw(dx, dz, facing);

    // Solve ballistic equation for pitch given power
    // h = d*tan(θ) - g*d²/(2*p²*cos²(θ))
    let bestPitch = Math.PI / 4;
    let bestPower = (MIN_POWER + MAX_POWER) / 2;
    const preferHigh = this.difficulty.preferHighArc;

    // Power search strategy varies by difficulty
    let powerStart, powerEnd, powerStep;
    if (this.difficulty.powerStrategy === 'optimal') {
      // Hard: sweep from max down, find first valid solution
      powerStart = MAX_POWER;
      powerEnd = MIN_POWER;
      powerStep = -2;
    } else if (this.difficulty.powerStrategy === 'random') {
      // Easy: pick a random starting power, only search a narrow band
      const randomCenter = MIN_POWER + Math.random() * (MAX_POWER - MIN_POWER);
      powerStart = Math.min(MAX_POWER, randomCenter + 10);
      powerEnd = Math.max(MIN_POWER, randomCenter - 10);
      powerStep = -2;
    } else {
      // Balanced: sweep from max down like hard but with more variance later
      powerStart = MAX_POWER;
      powerEnd = MIN_POWER;
      powerStep = -2;
    }

    for (let p = powerStart; powerStep < 0 ? p >= powerEnd : p <= powerEnd; p += powerStep) {
      const d = horizDist;
      const h = dy;
      const a = (g * d * d) / (2 * p * p);
      if (a === 0) continue;
      const disc = d * d - 4 * a * (h + a);
      if (disc < 0) continue;

      // Low arc: (d - sqrt(disc)) / (2a), High arc: (d + sqrt(disc)) / (2a)
      const tanLow = (d - Math.sqrt(disc)) / (2 * a);
      const tanHigh = (d + Math.sqrt(disc)) / (2 * a);
      const pitchLow = Math.atan(tanLow);
      const pitchHigh = Math.atan(tanHigh);

      // Easy AI prefers high arc (lobbing shots), others prefer low arc (aggressive)
      const primary = preferHigh ? pitchHigh : pitchLow;
      const fallback = preferHigh ? pitchLow : pitchHigh;

      if (primary >= MIN_PITCH && primary <= MAX_PITCH) {
        bestPitch = primary;
        bestPower = p;
        break;
      }
      if (fallback >= MIN_PITCH && fallback <= MAX_PITCH) {
        bestPitch = fallback;
        bestPower = p;
        break;
      }
    }

    // Power variance by difficulty
    if (this.difficulty.powerStrategy === 'random') {
      // Easy: large random offset, often suboptimal
      bestPower += (Math.random() - 0.3) * 16;
    } else if (this.difficulty.powerStrategy === 'balanced') {
      // Medium: moderate variance
      bestPower += (Math.random() - 0.3) * 8;
    }
    // Hard: no additional variance — fire at computed optimal

    bestPower = Math.max(MIN_POWER, Math.min(MAX_POWER, bestPower));

    // Recompute pitch for the varied power
    const a2 = (g * horizDist * horizDist) / (2 * bestPower * bestPower);
    if (a2 > 0) {
      const disc2 = horizDist * horizDist - 4 * a2 * (dy + a2);
      if (disc2 >= 0) {
        const tanPrimary = preferHigh
          ? (horizDist + Math.sqrt(disc2)) / (2 * a2)
          : (horizDist - Math.sqrt(disc2)) / (2 * a2);
        const p2 = Math.atan(tanPrimary);
        if (p2 >= MIN_PITCH && p2 <= MAX_PITCH) bestPitch = p2;
      }
    }

    return { yaw, pitch: bestPitch, power: bestPower };
  }

  applySpread(aim) {
    const { spreadRad, powerOffset } = this.difficulty;
    return {
      yaw: Math.max(-MAX_YAW_OFFSET, Math.min(MAX_YAW_OFFSET,
        aim.yaw + (Math.random() - 0.5) * 2 * spreadRad)),
      pitch: Math.max(MIN_PITCH, Math.min(MAX_PITCH,
        aim.pitch + (Math.random() - 0.5) * 2 * spreadRad)),
      power: Math.max(MIN_POWER, Math.min(MAX_POWER,
        aim.power + (Math.random() - 0.5) * 2 * powerOffset)),
    };
  }

  /**
   * Choose a reposition target based on difficulty.
   * Cover = blocks between the target cell and the opponent's cannon.
   * The opponent fires from negative X, so blocks with lower X than
   * the target (same Z, any Y) act as shields.
   */
  chooseRepositionTarget(castle) {
    const gw = castle.gridWidth || 9;
    const gd = castle.gridDepth || 9;
    const strategy = this.difficulty.repositionStrategy;

    if (strategy === 'random') {
      return { x: Math.floor(Math.random() * gw), y: 0, z: Math.floor(Math.random() * gd) };
    }

    // Score each grid cell by blocks shielding it from the opponent's direction.
    // Opponent fires from -X toward +X, so count blocks at same Z with x < candidate x.
    const layout = castle.layoutData || [];
    const scores = [];
    for (let x = 0; x < gw; x++) {
      for (let z = 0; z < gd; z++) {
        // Count blocks in front (lower x) at similar z (±1) that would intercept shots
        const shielding = layout.filter(b =>
          b.x < x && Math.abs(b.z - z) <= 1
        ).length;
        // Also reward height variety — blocks stacked above offer vertical cover
        const verticalCover = layout.filter(b =>
          b.x === x && b.z === z && b.y > 0
        ).length;
        scores.push({ x, z, cover: shielding + verticalCover });
      }
    }

    if (strategy === 'optimal') {
      scores.sort((a, b) => b.cover - a.cover);
      // Hard AI picks from top 3 positions (near-optimal with slight variance)
      const top = scores.slice(0, 3);
      const pick = top[Math.floor(Math.random() * top.length)];
      return { x: pick.x, y: 0, z: pick.z };
    }

    // covered: prefer cells with some cover
    const covered = scores.filter(s => s.cover > 0);
    if (covered.length > 0) {
      const pick = covered[Math.floor(Math.random() * covered.length)];
      return { x: pick.x, y: 0, z: pick.z };
    }
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
