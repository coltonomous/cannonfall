import * as C from './constants.js';

export class InputHandler {
  constructor() {
    this.keys = {};
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // Touch state
    this._touchActive = false;
    this._touchStart = null;
    this._touchLast = null;
    this._touchAimDelta = { yaw: 0, pitch: 0 };
    this._touchTapped = false;
    this._touchSwiping = false; // true once finger moves past threshold
    this._canvas = null;
    this.enabled = true; // disabled during non-gameplay states
  }

  setupTouchListeners(canvas) {
    this._canvas = canvas;
    this._onTouchStart = this._handleTouchStart.bind(this);
    this._onTouchMove = this._handleTouchMove.bind(this);
    this._onTouchEnd = this._handleTouchEnd.bind(this);
    canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this._onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', this._onTouchEnd, { passive: false });
  }

  _handleTouchStart(e) {
    if (!this.enabled || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    this._touchActive = true;
    this._touchTapped = false;
    this._touchSwiping = false;
    this._touchStart = { x: t.clientX, y: t.clientY };
    this._touchLast = { x: t.clientX, y: t.clientY };
  }

  _handleTouchMove(e) {
    if (!this.enabled || !this._touchActive || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - this._touchLast.x;
    const dy = t.clientY - this._touchLast.y;
    this._touchAimDelta.yaw += dx * -C.TOUCH_AIM_SENSITIVITY;
    this._touchAimDelta.pitch += dy * -C.TOUCH_AIM_SENSITIVITY;
    this._touchLast = { x: t.clientX, y: t.clientY };

    // Mark as swipe once finger moves past threshold — swipes aim but don't fire
    if (!this._touchSwiping && this._touchStart) {
      const totalDx = t.clientX - this._touchStart.x;
      const totalDy = t.clientY - this._touchStart.y;
      if (Math.abs(totalDx) > 15 || Math.abs(totalDy) > 15) {
        this._touchSwiping = true;
      }
    }
  }

  _handleTouchEnd(e) {
    if (!this.enabled || !this._touchActive) return;
    e.preventDefault();
    this._touchActive = false;
    // Only register as tap/fire if the finger didn't swipe
    if (!this._touchSwiping) {
      this._touchTapped = true;
    }
    this._touchSwiping = false;
  }

  resetTouchState() {
    this._touchActive = false;
    this._touchStart = null;
    this._touchLast = null;
    this._touchAimDelta = { yaw: 0, pitch: 0 };
    this._touchTapped = false;
    this._touchSwiping = false;
  }

  /**
   * Process aiming and charging input during the active player's turn.
   * @param {number} dt - delta time
   * @param {CannonTower} cannon - the active cannon
   * @param {object} chargeState - { charging, chargeTime, power } mutated in place
   * @param {UI} ui - for power meter updates
   * @returns {'fire' | null} - returns 'fire' when player releases space
   */
  handleInput(dt, cannon, chargeState, ui) {
    // Yaw
    if (this.keys['ArrowLeft'] || this.keys['KeyA']) cannon.adjustYaw(-C.AIM_SPEED);
    if (this.keys['ArrowRight'] || this.keys['KeyD']) cannon.adjustYaw(C.AIM_SPEED);

    // Pitch
    if (this.keys['ArrowUp'] || this.keys['KeyW']) cannon.adjustPitch(C.AIM_SPEED);
    if (this.keys['ArrowDown'] || this.keys['KeyS']) cannon.adjustPitch(-C.AIM_SPEED);

    // Touch aim deltas
    if (this._touchAimDelta.yaw !== 0 || this._touchAimDelta.pitch !== 0) {
      cannon.adjustYaw(this._touchAimDelta.yaw);
      cannon.adjustPitch(this._touchAimDelta.pitch);
      this._touchAimDelta.yaw = 0;
      this._touchAimDelta.pitch = 0;
    }

    // Power charge: hold Space or tap-hold (not swipe) to charge, release to fire
    const holding = this.keys['Space'] || (this._touchActive && !this._touchSwiping);
    if (holding && !chargeState.charging) {
      chargeState.charging = true;
      chargeState.chargeTime = 0;
      chargeState.power = C.MIN_POWER;
    }

    if (chargeState.charging) {
      chargeState.chargeTime += dt;
      const t = chargeState.chargeTime * C.CHARGE_FREQ;
      chargeState.power = C.MIN_POWER + (C.MAX_POWER - C.MIN_POWER) * (0.5 - 0.5 * Math.cos(t));
      ui.updatePower(chargeState.power, C.MIN_POWER, C.MAX_POWER);

      if (!holding) {
        chargeState.charging = false;
        return 'fire';
      }
    }

    return null;
  }
}
