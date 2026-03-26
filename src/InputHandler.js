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

    // Touch state — swipe to aim only, no charge/fire logic
    this._touchActive = false;
    this._touchLast = null;
    this._touchAimDelta = { yaw: 0, pitch: 0 };
    this._touchTapped = false; // used for skip (FIRING/REPLAY), not for firing
    this._canvas = null;
    this.enabled = true;

    // Fire button state — completely separate from touch aiming
    this._fireButtonDown = false;
    this._fireBtn = null;
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

  setupFireButton(btn) {
    this._fireBtn = btn;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.enabled) this._fireButtonDown = true;
    });
    btn.addEventListener('pointerup', () => {
      this._fireButtonDown = false;
    });
    btn.addEventListener('pointercancel', () => {
      this._fireButtonDown = false;
    });
    btn.addEventListener('pointerleave', () => {
      this._fireButtonDown = false;
    });
  }

  _handleTouchStart(e) {
    if (!this.enabled || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    this._touchActive = true;
    this._touchTapped = false;
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
    // Tap signal for skip actions (FIRING/REPLAY), not for firing
    this._touchTapped = true;
  }

  resetTouchState() {
    this._touchActive = false;
    this._touchLast = null;
    this._touchAimDelta = { yaw: 0, pitch: 0 };
    this._touchTapped = false;
    this._fireButtonDown = false;
  }

  handleInput(dt, cannon, chargeState, ui) {
    // Yaw
    if (this.keys['ArrowLeft'] || this.keys['KeyA']) cannon.adjustYaw(-C.AIM_SPEED);
    if (this.keys['ArrowRight'] || this.keys['KeyD']) cannon.adjustYaw(C.AIM_SPEED);

    // Pitch
    if (this.keys['ArrowUp'] || this.keys['KeyW']) cannon.adjustPitch(C.AIM_SPEED);
    if (this.keys['ArrowDown'] || this.keys['KeyS']) cannon.adjustPitch(-C.AIM_SPEED);

    // Touch aim deltas (swipe always aims, never charges)
    if (this._touchAimDelta.yaw !== 0 || this._touchAimDelta.pitch !== 0) {
      cannon.adjustYaw(this._touchAimDelta.yaw);
      cannon.adjustPitch(this._touchAimDelta.pitch);
      this._touchAimDelta.yaw = 0;
      this._touchAimDelta.pitch = 0;
    }

    // Power charge: Space bar or fire button (completely independent of touch aiming)
    const holding = this.keys['Space'] || this._fireButtonDown;
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

      // Update fire button visual
      if (this._fireBtn) {
        const pct = ((chargeState.power - C.MIN_POWER) / (C.MAX_POWER - C.MIN_POWER)) * 100;
        this._fireBtn.style.setProperty('--charge-pct', pct + '%');
        this._fireBtn.classList.toggle('charging', true);
      }

      if (!holding) {
        chargeState.charging = false;
        if (this._fireBtn) this._fireBtn.classList.remove('charging');
        return 'fire';
      }
    }

    return null;
  }
}
