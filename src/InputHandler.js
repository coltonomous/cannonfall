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

    // Power charge: hold Space to charge, release to fire
    if (this.keys['Space'] && !chargeState.charging) {
      chargeState.charging = true;
      chargeState.chargeTime = 0;
      chargeState.power = C.MIN_POWER;
    }

    if (chargeState.charging) {
      chargeState.chargeTime += dt;
      const t = chargeState.chargeTime * C.CHARGE_FREQ;
      chargeState.power = C.MIN_POWER + (C.MAX_POWER - C.MIN_POWER) * (0.5 - 0.5 * Math.cos(t));
      ui.updatePower(chargeState.power, C.MIN_POWER, C.MAX_POWER);

      if (!this.keys['Space']) {
        chargeState.charging = false;
        return 'fire';
      }
    }

    return null;
  }
}
