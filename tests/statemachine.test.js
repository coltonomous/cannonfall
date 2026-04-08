import { describe, it, expect } from 'vitest';
import { StateMachine, State } from '../src/StateMachine.js';

describe('StateMachine', () => {
  it('should start in MENU state', () => {
    const sm = new StateMachine();
    expect(sm.state).toBe(State.MENU);
  });

  it('is() should match current state', () => {
    const sm = new StateMachine();
    expect(sm.is(State.MENU)).toBe(true);
    expect(sm.is(State.BUILD)).toBe(false);
    expect(sm.is(State.MENU, State.BUILD)).toBe(true);
  });

  it('should allow valid transitions', () => {
    const sm = new StateMachine();
    expect(sm.transition(State.BUILD)).toBe(true);
    expect(sm.state).toBe(State.BUILD);
  });

  it('should reject invalid transitions', () => {
    const sm = new StateMachine();
    expect(sm.transition(State.FIRING)).toBe(false);
    expect(sm.state).toBe(State.MENU);
  });

  it('canTransitionTo() should check without changing state', () => {
    const sm = new StateMachine();
    expect(sm.canTransitionTo(State.BUILD)).toBe(true);
    expect(sm.canTransitionTo(State.FIRING)).toBe(false);
    expect(sm.state).toBe(State.MENU);
  });

  it('reset() should return to MENU', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    sm.reset();
    expect(sm.state).toBe(State.MENU);
  });

  it('should call onTransition callback on valid transition', () => {
    const transitions = [];
    const sm = new StateMachine((prev, next) => transitions.push({ prev, next }));
    sm.transition(State.BUILD);
    expect(transitions).toEqual([{ prev: State.MENU, next: State.BUILD }]);
  });

  it('should not call onTransition callback on invalid transition', () => {
    const transitions = [];
    const sm = new StateMachine((prev, next) => transitions.push({ prev, next }));
    sm.transition(State.FIRING);
    expect(transitions).toEqual([]);
  });
});

describe('State transition coverage', () => {
  const transitions = StateMachine.getValidTransitions();

  it('every state value should have a transitions entry', () => {
    for (const s of Object.values(State)) {
      expect(transitions).toHaveProperty(s);
    }
  });

  it('every transition target should be a valid state', () => {
    const validStates = new Set(Object.values(State));
    for (const [from, targets] of Object.entries(transitions)) {
      for (const target of targets) {
        expect(validStates.has(target), `${from} → ${target} is not a valid state`).toBe(true);
      }
    }
  });

  it('MENU should not be reachable from itself', () => {
    expect(transitions[State.MENU]).not.toContain(State.MENU);
  });

  it('GAME_OVER should only transition to MENU', () => {
    expect(transitions[State.GAME_OVER]).toEqual([State.MENU]);
  });

  it('REPLAY should only transition to GAME_OVER', () => {
    expect(transitions[State.REPLAY]).toEqual([State.GAME_OVER]);
  });

  it('PASS_DEVICE should only transition to BUILD', () => {
    expect(transitions[State.PASS_DEVICE]).toEqual([State.BUILD]);
  });

  it('PASS_DEVICE_REPOSITION should only transition to REPOSITION', () => {
    expect(transitions[State.PASS_DEVICE_REPOSITION]).toEqual([State.REPOSITION]);
  });
});

describe('Game flow sequences', () => {
  it('full local game: menu → build → pass → build → my_turn → firing → turn_transition → my_turn', () => {
    const sm = new StateMachine();
    expect(sm.transition(State.BUILD)).toBe(true);
    expect(sm.transition(State.PASS_DEVICE)).toBe(true);
    expect(sm.transition(State.BUILD)).toBe(true);
    expect(sm.transition(State.MY_TURN)).toBe(true);
    expect(sm.transition(State.FIRING)).toBe(true);
    expect(sm.transition(State.TURN_TRANSITION)).toBe(true);
    expect(sm.transition(State.MY_TURN)).toBe(true);
  });

  it('online game: menu → build → waiting → my_turn → firing → opponent_turn → opponent_firing', () => {
    const sm = new StateMachine();
    expect(sm.transition(State.BUILD)).toBe(true);
    expect(sm.transition(State.WAITING_OPPONENT_BUILD)).toBe(true);
    expect(sm.transition(State.MY_TURN)).toBe(true);
    expect(sm.transition(State.FIRING)).toBe(true);
    expect(sm.transition(State.OPPONENT_TURN)).toBe(true);
    expect(sm.transition(State.OPPONENT_FIRING)).toBe(true);
  });

  it('AI game: menu → build → ai_aiming → ai_firing → turn_transition → my_turn', () => {
    const sm = new StateMachine();
    expect(sm.transition(State.BUILD)).toBe(true);
    expect(sm.transition(State.AI_AIMING)).toBe(true);
    expect(sm.transition(State.AI_FIRING)).toBe(true);
    expect(sm.transition(State.TURN_TRANSITION)).toBe(true);
    expect(sm.transition(State.MY_TURN)).toBe(true);
  });

  it('hit → reposition flow: firing → turn_transition → reposition → my_turn', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    sm.transition(State.MY_TURN);
    sm.transition(State.FIRING);
    expect(sm.transition(State.TURN_TRANSITION)).toBe(true);
    expect(sm.transition(State.REPOSITION)).toBe(true);
    expect(sm.transition(State.MY_TURN)).toBe(true);
  });

  it('hit → pass device reposition flow (local): firing → pass_device_reposition → reposition', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    sm.transition(State.MY_TURN);
    sm.transition(State.FIRING);
    expect(sm.transition(State.PASS_DEVICE_REPOSITION)).toBe(true);
    expect(sm.transition(State.REPOSITION)).toBe(true);
  });

  it('lethal hit → replay → game_over → menu', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    sm.transition(State.MY_TURN);
    sm.transition(State.FIRING);
    expect(sm.transition(State.REPLAY)).toBe(true);
    expect(sm.transition(State.GAME_OVER)).toBe(true);
    expect(sm.transition(State.MENU)).toBe(true);
  });

  it('lethal hit without replay → game_over directly', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    sm.transition(State.MY_TURN);
    sm.transition(State.FIRING);
    expect(sm.transition(State.GAME_OVER)).toBe(true);
  });

  it('quit from my_turn → menu', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    sm.transition(State.MY_TURN);
    expect(sm.transition(State.MENU)).toBe(true);
  });

  it('quit from opponent_turn → menu', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    sm.transition(State.WAITING_OPPONENT_BUILD);
    sm.transition(State.OPPONENT_TURN);
    expect(sm.transition(State.MENU)).toBe(true);
  });

  it('quit from ai_aiming → menu', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    sm.transition(State.AI_AIMING);
    expect(sm.transition(State.MENU)).toBe(true);
  });

  it('reconnect into waiting_build → my_turn', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    sm.transition(State.WAITING_OPPONENT_BUILD);
    expect(sm.transition(State.MY_TURN)).toBe(true);
  });

  it('reconnect into waiting_build → opponent_turn', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    sm.transition(State.WAITING_OPPONENT_BUILD);
    expect(sm.transition(State.OPPONENT_TURN)).toBe(true);
  });
});

describe('Invalid transition rejection', () => {
  it('cannot go from menu directly to firing', () => {
    const sm = new StateMachine();
    expect(sm.transition(State.FIRING)).toBe(false);
  });

  it('cannot go from build to firing', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    expect(sm.transition(State.FIRING)).toBe(false);
  });

  it('cannot go from replay to menu (must go through game_over)', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    sm.transition(State.MY_TURN);
    sm.transition(State.FIRING);
    sm.transition(State.REPLAY);
    expect(sm.transition(State.MENU)).toBe(false);
  });

  it('cannot go from game_over to build', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    sm.transition(State.MY_TURN);
    sm.transition(State.GAME_OVER);
    expect(sm.transition(State.BUILD)).toBe(false);
  });

  it('cannot go from my_turn to opponent_turn', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    sm.transition(State.MY_TURN);
    expect(sm.transition(State.OPPONENT_TURN)).toBe(false);
  });

  it('cannot go from opponent_firing to firing', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    sm.transition(State.WAITING_OPPONENT_BUILD);
    sm.transition(State.OPPONENT_TURN);
    sm.transition(State.OPPONENT_FIRING);
    expect(sm.transition(State.FIRING)).toBe(false);
  });

  it('cannot go from pass_device to menu', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    sm.transition(State.PASS_DEVICE);
    expect(sm.transition(State.MENU)).toBe(false);
  });

  it('cannot go from waiting_build to build', () => {
    const sm = new StateMachine();
    sm.transition(State.BUILD);
    sm.transition(State.WAITING_OPPONENT_BUILD);
    expect(sm.transition(State.BUILD)).toBe(false);
  });
});
