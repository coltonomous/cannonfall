/**
 * @vitest-environment jsdom
 *
 * Drives a real Game through online play: server events are fed in through a
 * fake socket, and the test checks what the client sends back and which state
 * it ends up in.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const sockets = vi.hoisted(() => []);

vi.mock('three', async () => await import('./helpers/mock-three.js'));
vi.mock('socket.io-client', () => ({
  io: () => {
    const socket = {
      connected: false,
      handlers: {},
      sent: [],
      io: { on: () => {} },
      on(event, fn) { socket.handlers[event] = fn; },
      emit(event, data) { socket.sent.push([event, data]); },
      disconnect() { socket.connected = false; },
    };
    sockets.push(socket);
    return socket;
  },
}));

const { Game, State } = await import('../src/Game.js');
const { getPreset } = await import('../src/Presets.js');
const { getPiratePreset } = await import('../src/PiratePresets.js');
import * as C from '../src/constants.js';
import { loadIndexHtml } from './helpers/dom.js';

const PRESETS = { castle: () => getPreset('KEEP', 'castle'), pirate: () => getPiratePreset('SLOOP') };

/** A Game connected to a fake server. */
function connectedGame() {
  loadIndexHtml();
  const game = new Game(document.getElementById('game-canvas'));
  const socket = sockets.at(-1); // opened by the reconnect check in the constructor
  socket.connected = true;
  socket.handlers.connect();
  return {
    game,
    server: (event, data) => socket.handlers[event](data),
    sent: (event) => socket.sent.filter(([e]) => e === event).map(([, d]) => d),
  };
}

/** A Game that has joined an online match and finished the build phase. */
async function onlineBattle({ gameMode = 'castle', playerIndex = 0, firstTurn = 0 } = {}) {
  const ctx = connectedGame();
  await ctx.game.startOnline();
  const castle = PRESETS[gameMode]();
  ctx.game.castleBuilds[gameMode.toUpperCase()] = castle; // built before joining
  ctx.server('matched', { playerIndex, firstTurn, gameMode });
  ctx.server('build-complete', { castles: [castle, castle] });
  return { ...ctx, castle };
}

/** Fire through the real turn update, as if the player released the charge. */
function fireLocalShot(game, power) {
  game.battle.power = power;
  vi.spyOn(game.input, 'handleInput').mockReturnValueOnce('fire');
  game.update();
}

beforeEach(() => {
  sessionStorage.clear();
  sockets.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('online client: build and fire', () => {
  it('sends a prebuilt castle on match and starts the battle on build-complete', async () => {
    const { game, sent, castle } = await onlineBattle({ playerIndex: 0, firstTurn: 0 });
    expect(sent('build-ready')).toEqual([{ castleData: castle }]);
    expect(game.state).toBe(State.MY_TURN);
  });

  it('reports the charged power when firing', async () => {
    const { game, sent } = await onlineBattle({ playerIndex: 0, firstTurn: 0 });
    fireLocalShot(game, 30);
    expect(game.state).toBe(State.FIRING);
    expect(sent('fire')).toEqual([{ yaw: expect.any(Number), pitch: expect.any(Number), power: 30 }]);
  });

  it('replays the opponent\'s shot with the server\'s perfect-shot verdict', async () => {
    vi.useFakeTimers();
    const { game, server } = await onlineBattle({ playerIndex: 0, firstTurn: 1 });
    expect(game.state).toBe(State.OPPONENT_TURN);

    server('opponent-fired', { yaw: 0, pitch: 0.4, power: 37, perfect: true });
    expect(game.state).toBe(State.OPPONENT_FIRING);
    expect(game.battle._perfectShot).toBe(true);
    expect(game.battle.power).toBe(37); // drives blast scaling, so it must match the shooter's

    vi.advanceTimersByTime(C.PERFECT_FIRE_DELAY);
    // Perfect shots launch at full power on both clients
    expect(game.battle.projectile.body.velocity.length()).toBeCloseTo(C.MAX_POWER, 5);
  });
});

describe('online client: hits and reposition', () => {
  it('lets the player who was hit reposition, sending layout coordinates', async () => {
    vi.useFakeTimers();
    // Pirate mode mirrors player 0's ship along Z, so rendered and layout coords differ
    const { game, server, sent } = await onlineBattle({ gameMode: 'pirate', playerIndex: 0, firstTurn: 1 });
    server('opponent-fired', { yaw: 0, pitch: 0.4, power: 20, perfect: false });
    server('shot-resolved', { hit: true, damagedPlayer: 0, hp: [2, 3] });
    expect(game.hp).toEqual([2, 3]);

    vi.advanceTimersByTime(C.HIT_DISPLAY_DELAY);
    expect(game.state).toBe(State.REPOSITION);

    game.repositioner.targetPos = { x: 2, y: 0, z: 1 }; // as if the player clicked a cell
    document.getElementById('reposition-confirm-btn').click();
    const gridDepth = game.gameMode.gridDepth;
    expect(sent('reposition-complete')).toEqual([{ targetPos: { x: 2, y: 0, z: gridDepth - 1 - 1 } }]);
    expect(game.state).toBe(State.OPPONENT_TURN); // waits for the server

    server('reposition-done', { player: 0, targetPos: { x: 2, y: 0, z: gridDepth - 2 }, nextTurn: 0 });
    expect(game.state).toBe(State.MY_TURN);
    // Rendered back at the clicked cell
    const halfD = Math.floor(gridDepth / 2);
    expect(game.castles[0].getTargetPosition().z).toBeCloseTo((1 - halfD) * C.BLOCK_SIZE);
  });

  it('keeps the attacker waiting through the opponent\'s reposition and turn', async () => {
    const { game, server } = await onlineBattle({ playerIndex: 0, firstTurn: 0 });
    fireLocalShot(game, 30);
    server('shot-resolved', { hit: true, damagedPlayer: 1, hp: [3, 2] });
    expect(game.state).toBe(State.OPPONENT_TURN);
    expect(game.ui.statusText.textContent).toBe('Opponent repositioning...');

    server('reposition-done', { player: 1, targetPos: { x: 1, y: 0, z: 2 }, nextTurn: 1 });
    expect(game.state).toBe(State.OPPONENT_TURN);
    const halfD = Math.floor(game.gameMode.gridDepth / 2);
    expect(game.castles[1].getTargetPosition().z).toBeCloseTo((2 - halfD) * C.BLOCK_SIZE);
  });

  it('hands the turn over after a miss', async () => {
    const { game, server, sent } = await onlineBattle({ playerIndex: 0, firstTurn: 0 });
    fireLocalShot(game, 30);
    game.events.emit('shot-miss');
    expect(sent('shot-result')).toEqual([{ hit: false }]);
    expect(game.state).toBe(State.OPPONENT_TURN);

    server('shot-resolved', { hit: false, nextTurn: 1 });
    expect(game.state).toBe(State.OPPONENT_TURN);
    expect(game.currentTurn).toBe(1);
  });
});

describe('online client: reconnect', () => {
  function reconnectPayload(castle, overrides) {
    return {
      gameId: 'g1',
      playerIndex: 1,
      game: { phase: 'battle', currentTurn: 0, repositioningPlayer: null, castles: [castle, castle], hp: [3, 2], gameMode: 'castle', ...overrides },
    };
  }

  it('resumes repositioning when this player was the one hit', () => {
    const { game, server } = connectedGame();
    const castle = PRESETS.castle();
    server('reconnected', reconnectPayload(castle, { phase: 'reposition', repositioningPlayer: 1 }));
    expect(game.state).toBe(State.REPOSITION);
    expect(game.hp).toEqual([3, 2]);
  });

  it('waits when the opponent is repositioning', () => {
    const { game, server } = connectedGame();
    const castle = PRESETS.castle();
    server('reconnected', reconnectPayload(castle, { phase: 'reposition', repositioningPlayer: 0 }));
    expect(game.state).toBe(State.OPPONENT_TURN);
    expect(game.ui.statusText.textContent).toBe('Opponent repositioning...');
  });

  it('resumes the battle on the server\'s turn', () => {
    const { game, server } = connectedGame();
    const castle = PRESETS.castle();
    server('reconnected', reconnectPayload(castle, { currentTurn: 1 }));
    expect(game.state).toBe(State.MY_TURN);
  });

  it('reopens the builder when this player had not submitted a castle', () => {
    const { game, server } = connectedGame();
    const castle = PRESETS.castle();
    server('reconnected', reconnectPayload(castle, { phase: 'build', castles: [castle, null] }));
    expect(game.state).toBe(State.BUILD);
  });
});

describe('online client: games ending early', () => {
  it('ends the game when the opponent leaves during the build phase', async () => {
    const { game, server } = connectedGame();
    await game.startOnline();
    server('matched', { playerIndex: 0, firstTurn: 0, gameMode: 'castle' });
    expect(game.state).toBe(State.BUILD);

    server('opponent-disconnected');
    expect(game.state).toBe(State.GAME_OVER);
    expect(game.ui.resultText.textContent).toBe('Opponent left the game');
  });

  it('ends a game in progress when the server restarts', async () => {
    const { game, server } = await onlineBattle();
    server('server-shutdown');
    expect(game.state).toBe(State.GAME_OVER);
    expect(game.ui.resultText.textContent).toBe('Server restarted, game ended');
  });
});
