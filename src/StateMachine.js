export const State = {
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
  AI_AIMING: 'ai_aiming',
  AI_FIRING: 'ai_firing',
  REPLAY: 'replay',
  GAME_OVER: 'game_over',
};

const VALID_TRANSITIONS = {
  [State.MENU]:                  [State.BUILD, State.MY_TURN, State.OPPONENT_TURN, State.WAITING_OPPONENT_BUILD, State.AI_AIMING],
  [State.BUILD]:                 [State.MENU, State.PASS_DEVICE, State.WAITING_OPPONENT_BUILD, State.MY_TURN, State.OPPONENT_TURN, State.AI_AIMING],
  [State.PASS_DEVICE]:           [State.BUILD],
  [State.WAITING_OPPONENT_BUILD]:[State.MY_TURN, State.OPPONENT_TURN],
  [State.MY_TURN]:               [State.FIRING, State.GAME_OVER, State.MENU],
  [State.FIRING]:                [State.GAME_OVER, State.REPLAY, State.PASS_DEVICE_REPOSITION, State.TURN_TRANSITION, State.OPPONENT_TURN, State.MY_TURN, State.REPOSITION, State.AI_AIMING],
  [State.OPPONENT_TURN]:         [State.OPPONENT_FIRING, State.REPOSITION, State.MY_TURN, State.GAME_OVER, State.MENU],
  [State.OPPONENT_FIRING]:       [State.GAME_OVER, State.REPLAY, State.REPOSITION, State.MY_TURN, State.OPPONENT_TURN, State.TURN_TRANSITION],
  [State.REPOSITION]:            [State.MY_TURN, State.OPPONENT_TURN, State.AI_AIMING],
  [State.PASS_DEVICE_REPOSITION]:[State.REPOSITION],
  [State.TURN_TRANSITION]:       [State.MY_TURN, State.OPPONENT_TURN, State.AI_AIMING, State.REPOSITION, State.PASS_DEVICE_REPOSITION],
  [State.AI_AIMING]:             [State.AI_FIRING, State.GAME_OVER, State.MENU],
  [State.AI_FIRING]:             [State.GAME_OVER, State.REPLAY, State.TURN_TRANSITION, State.MY_TURN, State.REPOSITION],
  [State.REPLAY]:                [State.GAME_OVER],
  [State.GAME_OVER]:             [State.MENU],
};

export class StateMachine {
  /**
   * @param {Function} [onTransition] - callback(prevState, newState)
   * @param {{ strict?: boolean }} [opts]
   *   strict: if true, invalid transitions throw instead of returning false
   */
  constructor(onTransition, opts) {
    this.current = State.MENU;
    this._onTransition = onTransition || null;
    this._strict = opts?.strict ?? false;
  }

  get state() {
    return this.current;
  }

  is(...states) {
    return states.includes(this.current);
  }

  transition(newState) {
    const valid = VALID_TRANSITIONS[this.current];
    if (!valid || !valid.includes(newState)) {
      const msg = `Invalid state transition: ${this.current} → ${newState}`;
      if (this._strict) {
        throw new Error(`[Cannonfall] ${msg}`);
      }
      console.warn(`[Cannonfall] ${msg}`);
      return false;
    }
    const prev = this.current;
    this.current = newState;
    if (this._onTransition) this._onTransition(prev, newState);
    return true;
  }

  canTransitionTo(newState) {
    const valid = VALID_TRANSITIONS[this.current];
    return valid ? valid.includes(newState) : false;
  }

  reset() {
    this.current = State.MENU;
  }

  static getValidTransitions() {
    return VALID_TRANSITIONS;
  }
}
