/**
 * Runs the real game server on a random port and drives it with socket.io
 * clients, the same way browsers talk to it.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { io as ioClient } from 'socket.io-client';
import {
  createGameServer, corsOptions, validateFire, validateName, RATE_LIMITS,
} from '../server/game-server.js';
import { logger } from '../server/logger.js';
import { MIN_POWER, MAX_POWER, PERFECT_MIN, PERFECT_MAX, MAX_HP } from '../shared/constants.js';

const FAST = {
  shotResolveTimeout: 50,
  fireSafetyTimeout: 300,
  reconnectGraceMs: 200,
  gameCleanupDelayMs: 50,
  disconnectCleanupDelayMs: 50,
  // Flow tests fire and report faster than any human; the limits get their own test
  rateLimits: Object.fromEntries(Object.keys(RATE_LIMITS).map(k => [k, { window: 1000, max: 1000 }])),
};

const CASTLE = { layout: [{ x: 0, y: 0, z: 0, type: 'CUBE' }], target: { x: 4, y: 0, z: 4 }, cannonPos: { x: 8, z: 4 } };
const SHOT = { yaw: 0, pitch: 0.5, power: 30 };
const PERFECT_POWER = MIN_POWER + (MAX_POWER - MIN_POWER) * (PERFECT_MIN + PERFECT_MAX) / 2;

const servers = [];
const clients = [];
let nextSession = 0;

async function startServer(options = FAST) {
  const server = createGameServer(options);
  const port = await server.listen(0);
  servers.push(server);
  return `http://localhost:${port}`;
}

let url;
beforeAll(async () => {
  for (const level of ['debug', 'info', 'warn', 'error']) vi.spyOn(logger, level).mockImplementation(() => {});
  url = await startServer();
});
afterEach(() => {
  for (const c of clients.splice(0)) c.disconnect();
});
afterAll(async () => {
  await Promise.all(servers.map(s => s.close()));
  vi.restoreAllMocks();
});

/** Create a client socket; it connects on the next tick, so listeners can be attached first. */
function open(sessionId = `session-${++nextSession}`, serverUrl = url) {
  const socket = ioClient(serverUrl, {
    auth: sessionId === null ? {} : { sessionId },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  clients.push(socket);
  return socket;
}

async function connect(sessionId, serverUrl) {
  const socket = open(sessionId, serverUrl);
  await next(socket, 'connect');
  return socket;
}

/** Resolve with the next payload of `event`, or reject after `ms`. */
function next(socket, event, ms = 1000) {
  return new Promise((resolve, reject) => {
    const onEvent = (data) => {
      clearTimeout(timer);
      resolve(data);
    };
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timed out waiting for "${event}"`));
    }, ms);
    socket.once(event, onEvent);
  });
}

/** Resolve true if `event` does not arrive within `ms`. */
function stays(socket, event, ms = 150) {
  return next(socket, event, ms).then(() => false, () => true);
}

async function createLobby(host, opts = {}) {
  const created = next(host, 'lobby:created');
  host.emit('lobby:create', { name: 'Host', gameMode: 'castle', ...opts });
  return (await created).lobbyId;
}

async function matchPlayers(gameMode = 'castle', serverUrl = url) {
  const host = await connect(undefined, serverUrl);
  const guest = await connect(undefined, serverUrl);
  const lobbyId = await createLobby(host, { gameMode });
  const matched = [next(host, 'matched'), next(guest, 'matched')];
  guest.emit('lobby:join', { lobbyId, name: 'Guest' });
  const [hostMatch, guestMatch] = await Promise.all(matched);
  return { host, guest, hostMatch, guestMatch, seats: [host, guest] };
}

/** Two players past the build phase, labelled by who shoots first. */
async function startBattle(gameMode = 'castle', castle = CASTLE) {
  const m = await matchPlayers(gameMode);
  const done = [next(m.host, 'build-complete'), next(m.guest, 'build-complete')];
  m.host.emit('build-ready', { castleData: castle });
  m.guest.emit('build-ready', { castleData: castle });
  const [buildComplete] = await Promise.all(done);
  const first = m.hostMatch.firstTurn;
  return {
    ...m,
    buildComplete,
    attacker: m.seats[first],
    defender: m.seats[1 - first],
    attackerIndex: first,
    defenderIndex: 1 - first,
  };
}

async function fire(b, shot = SHOT) {
  const relayed = next(b.defender, 'opponent-fired');
  b.attacker.emit('fire', shot);
  return relayed;
}

/** Fire and have both clients agree it hit. */
async function landHit(b, shot = SHOT) {
  await fire(b, shot);
  const resolved = next(b.defender, 'shot-resolved');
  b.attacker.emit('shot-result', { hit: true });
  b.defender.emit('shot-result', { hit: true });
  return resolved;
}

// ── HTTP ───────────────────────────────────────────────

describe('HTTP', () => {
  it('answers the health check', async () => {
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
});

// ── Connections & malformed input ──────────────────────

describe('connections', () => {
  it('disconnects clients without a session id', async () => {
    const socket = open(null);
    expect(await next(socket, 'disconnect')).toBe('io server disconnect');
  });

  it('survives malformed payloads on every event', async () => {
    const b = await startBattle();
    const garbage = [undefined, null, 5, 'x', [], {}, { castleData: null }, { targetPos: null }, { hit: 'yes' }];
    const events = ['lobby:enter', 'lobby:leave', 'lobby:create', 'lobby:join', 'lobby:cancel',
      'build-ready', 'fire', 'shot-result', 'reposition-complete'];
    for (const socket of [b.attacker, b.defender, await connect()]) {
      for (const event of events) for (const payload of garbage) socket.emit(event, payload);
    }

    // Still running, and the game still works
    const relayed = await fire(b);
    expect(relayed).toMatchObject(SHOT);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

// ── Lobby ──────────────────────────────────────────────

describe('lobby', () => {
  it('lists a new lobby for other players but not for its host', async () => {
    const host = await connect();
    const viewer = await connect();
    const initial = next(viewer, 'lobby:list');
    viewer.emit('lobby:enter');
    await initial;
    host.emit('lobby:enter');
    await next(host, 'lobby:list');

    const hostList = next(host, 'lobby:list');
    const viewerList = next(viewer, 'lobby:list');
    const lobbyId = await createLobby(host, { name: 'Alice', password: 'pw' });
    expect(await hostList).toEqual([]);
    expect(await viewerList).toContainEqual({ id: lobbyId, hostName: 'Alice', gameMode: 'castle', hasPassword: true });
  });

  it('ignores invalid lobby:create payloads', async () => {
    const host = await connect();
    for (const payload of [
      { name: 'x'.repeat(21), gameMode: 'castle' },
      { name: '   ', gameMode: 'castle' },
      { name: 'Bob', gameMode: 'moon' },
      { name: 'Bob', gameMode: 'castle', password: 1234 },
    ]) host.emit('lobby:create', payload);
    expect(await stays(host, 'lobby:created')).toBe(true);
  });

  it('checks the password, then seats both players in one game', async () => {
    const host = await connect();
    const guest = await connect();
    const lobbyId = await createLobby(host, { password: 'secret' });

    const error = next(guest, 'lobby:error');
    guest.emit('lobby:join', { lobbyId, password: 'wrong' });
    expect(await error).toEqual({ message: 'Incorrect password' });

    const matched = [next(host, 'matched'), next(guest, 'matched')];
    guest.emit('lobby:join', { lobbyId, password: 'secret' });
    const [h, g] = await Promise.all(matched);
    expect(h).toMatchObject({ playerIndex: 0, gameMode: 'castle' });
    expect(g).toMatchObject({ playerIndex: 1, gameMode: 'castle' });
    expect(g.firstTurn).toBe(h.firstTurn);

    // The lobby is gone once the game starts
    const late = await connect();
    const lateError = next(late, 'lobby:error');
    late.emit('lobby:join', { lobbyId });
    expect(await lateError).toEqual({ message: 'Lobby no longer exists' });
  });

  it('keeps players in a game out of other lobbies', async () => {
    const m = await matchPlayers();
    m.host.emit('lobby:create', { name: 'Again', gameMode: 'castle' });
    expect(await stays(m.host, 'lobby:created')).toBe(true);
  });

  it('tells the joiner when the server is full', async () => {
    const fullUrl = await startServer({ ...FAST, maxGames: 0 });
    const host = await connect(undefined, fullUrl);
    const guest = await connect(undefined, fullUrl);
    const lobbyId = await createLobby(host);
    const error = next(guest, 'lobby:error');
    guest.emit('lobby:join', { lobbyId });
    expect(await error).toEqual({ message: 'Server is full, try again soon' });
  });
});

// ── Build phase ────────────────────────────────────────

describe('build phase', () => {
  it('rejects castles that break the mode rules', async () => {
    const m = await matchPlayers();
    m.guest.emit('build-ready', { castleData: CASTLE });
    for (const castleData of [
      { ...CASTLE, layout: [{ x: 9, y: 0, z: 0, type: 'CUBE' }] },        // castle grid is 9 wide
      { ...CASTLE, layout: [{ x: 0, y: 0, z: 0, type: 'THRUSTER' }] },    // excluded in castle mode
      { ...CASTLE, layout: Array.from({ length: 201 }, (_, i) =>          // 603 > 600 budget
        ({ x: i % 9, y: Math.floor(i / 81), z: Math.floor(i / 9) % 9, type: 'CUBE' })) },
      { ...CASTLE, target: { x: 20, z: 4 } },
    ]) m.host.emit('build-ready', { castleData });
    expect(await stays(m.guest, 'build-complete')).toBe(true);
  });

  it('broadcasts normalized castles once both players are ready', async () => {
    const b = await startBattle('castle', {
      ...CASTLE,
      layout: [{ x: 1, y: 0, z: 1, type: 'RAMP', rotation: 5, payload: 'x'.repeat(1000) }],
      extra: 'ignored',
    });
    const [castle] = b.buildComplete.castles;
    expect(castle).toEqual({
      layout: [{ x: 1, y: 0, z: 1, type: 'RAMP', rotation: 1 }],
      target: { x: 4, y: 0, z: 4 },
      cannonPos: { x: 8, z: 4 },
    });
  });
});

// ── Shots ──────────────────────────────────────────────

describe('shots', () => {
  it('relays a shot to the opponent with the server\'s perfect-shot verdict', async () => {
    const b = await startBattle();
    expect(await fire(b, SHOT)).toEqual({ ...SHOT, perfect: false });

    const b2 = await startBattle();
    expect(await fire(b2, { ...SHOT, power: PERFECT_POWER })).toMatchObject({ perfect: true });
  });

  it('ignores shots out of turn, out of range, or while another is in flight', async () => {
    const b = await startBattle();
    b.defender.emit('fire', SHOT);
    b.attacker.emit('fire', { ...SHOT, power: MAX_POWER + 1 });
    b.attacker.emit('fire', { ...SHOT, yaw: Math.PI });
    expect(await stays(b.attacker, 'opponent-fired')).toBe(true);
    expect(await stays(b.defender, 'opponent-fired')).toBe(true);

    await fire(b);
    b.attacker.emit('fire', SHOT);
    expect(await stays(b.defender, 'opponent-fired')).toBe(true);
  });

  it('ignores hit reports when no shot was fired', async () => {
    const b = await startBattle();
    b.attacker.emit('shot-result', { hit: true });
    expect(await stays(b.defender, 'shot-resolved', FAST.fireSafetyTimeout + 200)).toBe(true);
  });

  it('trusts the defender\'s report over the attacker\'s', async () => {
    const b = await startBattle();
    await fire(b);
    const resolved = next(b.attacker, 'shot-resolved');
    b.attacker.emit('shot-result', { hit: true });
    b.defender.emit('shot-result', { hit: false });
    expect(await resolved).toEqual({ hit: false, nextTurn: b.defenderIndex });
  });

  it('does double damage for a perfect shot', async () => {
    const b = await startBattle();
    const resolved = await landHit(b, { ...SHOT, power: PERFECT_POWER });
    const hp = [MAX_HP, MAX_HP];
    hp[b.defenderIndex] -= 2;
    expect(resolved).toEqual({ hit: true, damagedPlayer: b.defenderIndex, hp });
  });

  it('falls back to the attacker\'s report when the defender never reports', async () => {
    const b = await startBattle();
    await fire(b);
    const resolved = next(b.attacker, 'shot-resolved', FAST.fireSafetyTimeout + 500);
    b.attacker.emit('shot-result', { hit: true });
    expect(await resolved).toMatchObject({ hit: true, damagedPlayer: b.defenderIndex });
  });

  it('counts a shot nobody reports as a miss', async () => {
    const b = await startBattle();
    await fire(b);
    const resolved = await next(b.attacker, 'shot-resolved', FAST.fireSafetyTimeout + 500);
    expect(resolved).toEqual({ hit: false, nextTurn: b.defenderIndex });
  });

  it('ends the game on a lethal hit', async () => {
    const b = await startBattle();
    await landHit(b, { ...SHOT, power: PERFECT_POWER }); // 3 → 1

    // Defender repositions, takes their turn and misses
    const repositioned = next(b.attacker, 'reposition-done');
    b.defender.emit('reposition-complete', { targetPos: { x: 2, z: 2 } });
    await repositioned;
    const swapped = { ...b, attacker: b.defender, defender: b.attacker };
    await fire(swapped);
    const missed = next(b.attacker, 'shot-resolved');
    b.attacker.emit('shot-result', { hit: false });
    b.defender.emit('shot-result', { hit: false });
    await missed;

    await fire(b);
    const over = [next(b.attacker, 'game-over'), next(b.defender, 'game-over')];
    b.attacker.emit('shot-result', { hit: true });
    b.defender.emit('shot-result', { hit: true });
    for (const result of await Promise.all(over)) expect(result).toEqual({ winner: b.attackerIndex });
  });
});

// ── Reposition ─────────────────────────────────────────

describe('reposition', () => {
  it('only accepts a new target from the player who was hit', async () => {
    const b = await startBattle();
    await landHit(b);

    b.attacker.emit('reposition-complete', { targetPos: { x: 1, z: 1 } });
    expect(await stays(b.defender, 'reposition-done')).toBe(true);

    const done = [next(b.attacker, 'reposition-done'), next(b.defender, 'reposition-done')];
    b.defender.emit('reposition-complete', { targetPos: { x: 2, z: 3 } });
    for (const payload of await Promise.all(done)) {
      expect(payload).toEqual({ player: b.defenderIndex, targetPos: { x: 2, y: 0, z: 3 }, nextTurn: b.defenderIndex });
    }

    // The player who was hit shoots next
    const relayed = next(b.attacker, 'opponent-fired');
    b.defender.emit('fire', SHOT);
    expect(await relayed).toMatchObject(SHOT);
  });

  it('rejects targets outside the grid', async () => {
    const b = await startBattle();
    await landHit(b);
    b.defender.emit('reposition-complete', { targetPos: { x: 9, z: 0 } });
    b.defender.emit('reposition-complete', { targetPos: { x: 1.5, z: 0 } });
    expect(await stays(b.attacker, 'reposition-done')).toBe(true);
  });
});

// ── Reconnect ──────────────────────────────────────────

describe('reconnect', () => {
  it('restores the game for a returning session, including who is repositioning', async () => {
    const b = await startBattle();
    await landHit(b);
    const defenderId = b.defender.auth.sessionId;

    const dropped = next(b.attacker, 'opponent-disconnected-temp');
    b.defender.disconnect();
    await dropped;

    const returning = open(defenderId);
    const restored = next(returning, 'reconnected');
    const back = next(b.attacker, 'opponent-reconnected');
    const { playerIndex, game } = await restored;
    await back;
    expect(playerIndex).toBe(b.defenderIndex);
    expect(game).toMatchObject({
      phase: 'reposition',
      currentTurn: b.attackerIndex,
      repositioningPlayer: b.defenderIndex,
      gameMode: 'castle',
    });
    expect(game.castles).toHaveLength(2);
  });

  it('ends the game when a player does not come back in time', async () => {
    const b = await startBattle();
    const ended = next(b.attacker, 'opponent-disconnected', FAST.reconnectGraceMs + 500);
    b.defender.disconnect();
    await ended;
  });

  it('keeps a newer connection for the same session when the old one closes', async () => {
    const id = `dup-${++nextSession}`;
    const first = await connect(id);
    const second = await connect(id);
    first.disconnect();
    await new Promise(r => setTimeout(r, 50));

    const lobbyId = await createLobby(second);
    const guest = await connect();
    const matched = next(second, 'matched');
    guest.emit('lobby:join', { lobbyId });
    expect(await matched).toMatchObject({ playerIndex: 0 });
  });
});

// ── Rate limiting ──────────────────────────────────────

describe('rate limiting', () => {
  it('drops lobby events beyond the per-session limit', async () => {
    const limitedUrl = await startServer({ ...FAST, rateLimits: RATE_LIMITS });
    const host = await connect(undefined, limitedUrl);
    let created = 0;
    host.on('lobby:created', () => created++);
    for (let i = 0; i < RATE_LIMITS.lobby.max + 3; i++) host.emit('lobby:create', { name: 'Spam', gameMode: 'castle' });
    await new Promise(r => setTimeout(r, 200));
    expect(created).toBe(RATE_LIMITS.lobby.max);
  });
});

// ── Pure helpers ───────────────────────────────────────

describe('corsOptions', () => {
  it('uses an explicit allow-list when ALLOWED_ORIGINS is set', () => {
    expect(corsOptions({ ALLOWED_ORIGINS: 'https://a.com, https://b.com' }))
      .toEqual({ origin: ['https://a.com', 'https://b.com'] });
  });

  it('is same-origin only in production and open in development', () => {
    expect(corsOptions({ NODE_ENV: 'production' })).toEqual({ origin: false });
    expect(corsOptions({})).toEqual({ origin: '*' });
  });
});

describe('validateFire', () => {
  it('accepts shots inside the aim and power limits', () => {
    expect(validateFire(SHOT)).toBe(true);
    expect(validateFire({ yaw: Math.PI / 4, pitch: Math.PI / 3, power: MAX_POWER })).toBe(true);
  });

  it('rejects non-numbers and out-of-range values', () => {
    expect(validateFire({ ...SHOT, yaw: '0' })).toBe(false);
    expect(validateFire({ ...SHOT, pitch: NaN })).toBe(false);
    expect(validateFire({ ...SHOT, power: Infinity })).toBe(false);
    expect(validateFire({ ...SHOT, power: MIN_POWER - 1 })).toBe(false);
    expect(validateFire({ ...SHOT, pitch: 2 })).toBe(false);
    expect(validateFire({ ...SHOT, yaw: -1 })).toBe(false);
  });
});

describe('validateName', () => {
  it('trims names and rejects empty, long or non-string ones', () => {
    expect(validateName('  Ada ')).toBe('Ada');
    expect(validateName('   ')).toBeNull();
    expect(validateName('x'.repeat(21))).toBeNull();
    expect(validateName(42)).toBeNull();
  });
});
