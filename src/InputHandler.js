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
    this._touchLast = null;
    this._touchAimDelta = { yaw: 0, pitch: 0 };
    this._touchTapped = false;  // short tap for skip (FIRING/REPLAY)
    this._touchCharging = false; // finger down on canvas → charging
    this._touchFired = false;    // finger released while charging → fire
    this._canvas = null;
    this.enabled = true;
  }

  setupTouchListeners(canvas) {
    this._canvas = canvas;
    canvas.addEventListener('touchstart', this._handleTouchStart.bind(this), { passive: false });
    canvas.addEventListener('touchmove', this._handleTouchMove.bind(this), { passive: false });
    canvas.addEventListener('touchend', this._handleTouchEnd.bind(this), { passive: false });
    canvas.addEventListener('touchcancel', this._handleTouchEnd.bind(this), { passive: false });
  }

  _handleTouchStart(e) {
    if (!this.enabled || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    this._touchActive = true;
    this._touchTapped = false;
    this._touchFired = false;
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
  }

  _handleTouchEnd(e) {
    if (!this.enabled || !this._touchActive) return;
    e.preventDefault();
    this._touchActive = false;
    if (this._touchCharging) {
      // Was charging → release fires
      this._touchFired = true;
    } else {
      // Quick tap → skip signal
      this._touchTapped = true;
    }
    this._touchCharging = false;
  }

  resetTouchState() {
    this._touchActive = false;
    this._touchLast = null;
    this._touchAimDelta = { yaw: 0, pitch: 0 };
    this._touchTapped = false;
    this._touchCharging = false;
    this._touchFired = false;
  }

  handleInput(dt, cannon, chargeState, ui) {
    // Keyboard aim
    if (this.keys['ArrowLeft'] || this.keys['KeyA']) cannon.adjustYaw(-C.AIM_SPEED);
    if (this.keys['ArrowRight'] || this.keys['KeyD']) cannon.adjustYaw(C.AIM_SPEED);
    if (this.keys['ArrowUp'] || this.keys['KeyW']) cannon.adjustPitch(C.AIM_SPEED);
    if (this.keys['ArrowDown'] || this.keys['KeyS']) cannon.adjustPitch(-C.AIM_SPEED);

    // Touch aim (swipe pans while charging)
    if (this._touchAimDelta.yaw !== 0 || this._touchAimDelta.pitch !== 0) {
      cannon.adjustYaw(this._touchAimDelta.yaw);
      cannon.adjustPitch(this._touchAimDelta.pitch);
      this._touchAimDelta.yaw = 0;
      this._touchAimDelta.pitch = 0;
    }

    // Power charge: Space bar or touch hold
    const holding = this.keys['Space'] || this._touchActive;

    // Mark touch as charging once handleInput sees it (distinguishes aim-touch from skip-tap)
    if (this._touchActive && !this._touchCharging) {
      this._touchCharging = true;
    }

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

      if (!holding || this._touchFired) {
        chargeState.charging = false;
        this._touchFired = false;
        return 'fire';
      }
    }

    // Consume stale fire signal
    if (this._touchFired) this._touchFired = false;

    return null;
  }
}
