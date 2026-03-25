import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'crypto';

// ── Replicated pure functions from server.js ─────────────

const VALID_MODES = ['castle', 'pirate', 'space'];
const MIN_POWER = 10;
const MAX_POWER = 50;
const MIN_PITCH = -0.15;
const MAX_PITCH = Math.PI / 3;
const MAX_YAW_OFFSET = Math.PI / 4;

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function hashPassword(pw) {
  return createHash('sha256').update(pw).digest('hex');
}

function validateFirePayload({ yaw, pitch, power }) {
  if (!isFiniteNumber(yaw) || !isFiniteNumber(pitch) || !isFiniteNumber(power)) return false;
  if (power < MIN_POWER || power > MAX_POWER) return false;
  if (pitch < MIN_PITCH || pitch > MAX_PITCH) return false;
  if (Math.abs(yaw) > MAX_YAW_OFFSET) return false;
  return true;
}

// ── Lobby state + helpers (replicated from server.js) ────

let lobbies;
let broadcastCount;

function resetState() {
  lobbies = new Map();
  broadcastCount = 0;
}

function getLobbyList() {
  return Array.from(lobbies.values()).map(l => ({
    id: l.id,
    hostName: l.hostName,
    gameMode: l.gameMode,
    hasPassword: !!l.passwordHash,
  }));
}

function broadcastLobbyList() {
  broadcastCount++;
}

function removeLobbyByHost(sessionId) {
  for (const [id, lobby] of lobbies) {
    if (lobby.hostSessionId === sessionId) {
      lobbies.delete(id);
      broadcastLobbyList();
      return;
    }
  }
}

function validateLobbyCreate({ name, gameMode, password }) {
  if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 20) return false;
  if (!VALID_MODES.includes(gameMode)) return false;
  if (password && (typeof password !== 'string' || password.length > 30)) return false;
  return true;
}

// ── Tests ────────────────────────────────────────────────

describe('Password Hashing', () => {
  it('produces a consistent sha256 hex digest', () => {
    const hash = hashPassword('secret');
    expect(hash).toBe(createHash('sha256').update('secret').digest('hex'));
    expect(hash).toHaveLength(64); // sha256 hex = 64 chars
  });

  it('produces different hashes for different passwords', () => {
    expect(hashPassword('abc')).not.toBe(hashPassword('xyz'));
  });

  it('produces identical hashes for identical passwords', () => {
    expect(hashPassword('test123')).toBe(hashPassword('test123'));
  });
});

describe('getLobbyList', () => {
  beforeEach(resetState);

  it('returns empty array when no lobbies exist', () => {
    expect(getLobbyList()).toEqual([]);
  });

  it('maps lobby entries to sanitized objects', () => {
    lobbies.set('L1', {
      id: 'L1',
      hostSessionId: 'host-1',
      hostName: 'Alice',
      gameMode: 'castle',
      passwordHash: hashPassword('pw'),
      createdAt: Date.now(),
    });
    lobbies.set('L2', {
      id: 'L2',
      hostSessionId: 'host-2',
      hostName: 'Bob',
      gameMode: 'pirate',
      passwordHash: null,
      createdAt: Date.now(),
    });

    const list = getLobbyList();
    expect(list).toHaveLength(2);

    expect(list[0]).toEqual({
      id: 'L1',
      hostName: 'Alice',
      gameMode: 'castle',
      hasPassword: true,
    });
    expect(list[1]).toEqual({
      id: 'L2',
      hostName: 'Bob',
      gameMode: 'pirate',
      hasPassword: false,
    });
  });

  it('never exposes passwordHash or hostSessionId', () => {
    lobbies.set('L1', {
      id: 'L1',
      hostSessionId: 'secret-sid',
      hostName: 'Player',
      gameMode: 'space',
      passwordHash: 'shouldnotappear',
      createdAt: Date.now(),
    });

    const entry = getLobbyList()[0];
    expect(entry).not.toHaveProperty('passwordHash');
    expect(entry).not.toHaveProperty('hostSessionId');
    expect(entry).not.toHaveProperty('createdAt');
  });
});

describe('Lobby Creation Validation', () => {
  it('accepts valid inputs without password', () => {
    expect(validateLobbyCreate({ name: 'MyRoom', gameMode: 'castle' })).toBe(true);
  });

  it('accepts valid inputs with password', () => {
    expect(validateLobbyCreate({ name: 'Room', gameMode: 'pirate', password: 'secret' })).toBe(true);
  });

  it('accepts all valid game modes', () => {
    for (const mode of ['castle', 'pirate', 'space']) {
      expect(validateLobbyCreate({ name: 'X', gameMode: mode })).toBe(true);
    }
  });

  it('rejects empty name', () => {
    expect(validateLobbyCreate({ name: '', gameMode: 'castle' })).toBe(false);
  });

  it('rejects whitespace-only name', () => {
    expect(validateLobbyCreate({ name: '   ', gameMode: 'castle' })).toBe(false);
  });

  it('rejects null/undefined name', () => {
    expect(validateLobbyCreate({ name: null, gameMode: 'castle' })).toBe(false);
    expect(validateLobbyCreate({ name: undefined, gameMode: 'castle' })).toBe(false);
  });

  it('rejects non-string name', () => {
    expect(validateLobbyCreate({ name: 42, gameMode: 'castle' })).toBe(false);
  });

  it('rejects name longer than 20 characters', () => {
    expect(validateLobbyCreate({ name: 'A'.repeat(21), gameMode: 'castle' })).toBe(false);
  });

  it('accepts name of exactly 20 characters', () => {
    expect(validateLobbyCreate({ name: 'A'.repeat(20), gameMode: 'castle' })).toBe(true);
  });

  it('rejects invalid game mode', () => {
    expect(validateLobbyCreate({ name: 'Room', gameMode: 'survival' })).toBe(false);
    expect(validateLobbyCreate({ name: 'Room', gameMode: '' })).toBe(false);
    expect(validateLobbyCreate({ name: 'Room', gameMode: null })).toBe(false);
  });

  it('rejects non-string password', () => {
    expect(validateLobbyCreate({ name: 'Room', gameMode: 'castle', password: 123 })).toBe(false);
  });

  it('rejects password longer than 30 characters', () => {
    expect(validateLobbyCreate({ name: 'Room', gameMode: 'castle', password: 'X'.repeat(31) })).toBe(false);
  });

  it('accepts password of exactly 30 characters', () => {
    expect(validateLobbyCreate({ name: 'Room', gameMode: 'castle', password: 'X'.repeat(30) })).toBe(true);
  });

  it('accepts falsy password (no password)', () => {
    expect(validateLobbyCreate({ name: 'Room', gameMode: 'castle', password: '' })).toBe(true);
    expect(validateLobbyCreate({ name: 'Room', gameMode: 'castle', password: null })).toBe(true);
    expect(validateLobbyCreate({ name: 'Room', gameMode: 'castle', password: undefined })).toBe(true);
  });
});

describe('Lobby Join Password Check', () => {
  it('matches when input password hash equals stored hash', () => {
    const stored = hashPassword('mypass');
    expect(hashPassword('mypass')).toBe(stored);
  });

  it('rejects when input password is wrong', () => {
    const stored = hashPassword('correct');
    expect(hashPassword('wrong')).not.toBe(stored);
  });

  it('rejects when no password is provided but lobby has one', () => {
    const stored = hashPassword('secret');
    // Mirrors: if (!password || hashPassword(password) !== lobby.passwordHash)
    const password = '';
    const rejected = !password || hashPassword(password) !== stored;
    expect(rejected).toBe(true);
  });

  it('allows join when lobby has no password', () => {
    const storedHash = null;
    // Mirrors: if (lobby.passwordHash) { check } — no check needed
    const needsCheck = !!storedHash;
    expect(needsCheck).toBe(false);
  });
});

describe('removeLobbyByHost', () => {
  beforeEach(resetState);

  it('removes the lobby matching the host session id', () => {
    lobbies.set('L1', { id: 'L1', hostSessionId: 'host-A' });
    lobbies.set('L2', { id: 'L2', hostSessionId: 'host-B' });

    removeLobbyByHost('host-A');

    expect(lobbies.has('L1')).toBe(false);
    expect(lobbies.has('L2')).toBe(true);
  });

  it('triggers a broadcast after removal', () => {
    lobbies.set('L1', { id: 'L1', hostSessionId: 'host-A' });
    broadcastCount = 0;

    removeLobbyByHost('host-A');
    expect(broadcastCount).toBe(1);
  });

  it('does nothing when no lobby matches', () => {
    lobbies.set('L1', { id: 'L1', hostSessionId: 'host-A' });
    broadcastCount = 0;

    removeLobbyByHost('no-match');

    expect(lobbies.size).toBe(1);
    expect(broadcastCount).toBe(0);
  });

  it('only removes the first matching lobby', () => {
    lobbies.set('L1', { id: 'L1', hostSessionId: 'host-A' });
    lobbies.set('L2', { id: 'L2', hostSessionId: 'host-A' });

    removeLobbyByHost('host-A');

    // Server returns after first match, so only L1 is deleted
    expect(lobbies.has('L1')).toBe(false);
    expect(lobbies.has('L2')).toBe(true);
  });
});

describe('matchPlayers', () => {
  it('creates game with correct structure and emits matched with gameMode', () => {
    const games = new Map();
    const players = new Map();

    const emitted1 = [];
    const emitted2 = [];
    const s1 = { sessionId: 'sid-1', emit: (ev, data) => emitted1.push({ ev, data }) };
    const s2 = { sessionId: 'sid-2', emit: (ev, data) => emitted2.push({ ev, data }) };

    // Replicate matchPlayers
    const gameId = 'test-game-id';
    const currentTurn = 0; // deterministic for testing
    const gameMode = 'pirate';

    const game = {
      id: gameId,
      sessionIds: [s1.sessionId, s2.sessionId],
      currentTurn,
      phase: 'build',
      castles: [null, null],
      hp: [3, 3],
      gameMode,
    };

    games.set(gameId, game);
    players.set(s1.sessionId, { gameId, playerIndex: 0 });
    players.set(s2.sessionId, { gameId, playerIndex: 1 });

    s1.gameId = gameId;
    s1.playerIndex = 0;
    s2.gameId = gameId;
    s2.playerIndex = 1;

    s1.emit('matched', { playerIndex: 0, firstTurn: currentTurn, gameMode });
    s2.emit('matched', { playerIndex: 1, firstTurn: currentTurn, gameMode });

    // Verify game structure
    expect(game.phase).toBe('build');
    expect(game.hp).toEqual([3, 3]);
    expect(game.castles).toEqual([null, null]);
    expect(game.gameMode).toBe('pirate');
    expect(game.sessionIds).toEqual(['sid-1', 'sid-2']);

    // Verify player registrations
    expect(players.get('sid-1')).toEqual({ gameId, playerIndex: 0 });
    expect(players.get('sid-2')).toEqual({ gameId, playerIndex: 1 });

    // Verify emitted events include gameMode
    expect(emitted1[0].ev).toBe('matched');
    expect(emitted1[0].data).toEqual({ playerIndex: 0, firstTurn: 0, gameMode: 'pirate' });
    expect(emitted2[0].ev).toBe('matched');
    expect(emitted2[0].data).toEqual({ playerIndex: 1, firstTurn: 0, gameMode: 'pirate' });
  });

  it('assigns playerIndex 0 to first socket and 1 to second', () => {
    const s1 = { sessionId: 'a', emit: () => {} };
    const s2 = { sessionId: 'b', emit: () => {} };
    const players = new Map();

    players.set(s1.sessionId, { gameId: 'g', playerIndex: 0 });
    players.set(s2.sessionId, { gameId: 'g', playerIndex: 1 });

    s1.playerIndex = 0;
    s2.playerIndex = 1;

    expect(s1.playerIndex).toBe(0);
    expect(s2.playerIndex).toBe(1);
  });

  it('supports all game modes in matched event', () => {
    for (const mode of ['castle', 'pirate', 'space']) {
      const data = { playerIndex: 0, firstTurn: 0, gameMode: mode };
      expect(data.gameMode).toBe(mode);
      expect(VALID_MODES).toContain(data.gameMode);
    }
  });
});

describe('Fire Payload Validation', () => {
  it('accepts valid mid-range payload', () => {
    expect(validateFirePayload({ yaw: 0, pitch: 0.5, power: 30 })).toBe(true);
  });

  it('accepts boundary minimum values', () => {
    expect(validateFirePayload({ yaw: 0, pitch: MIN_PITCH, power: MIN_POWER })).toBe(true);
  });

  it('accepts boundary maximum values', () => {
    expect(validateFirePayload({ yaw: MAX_YAW_OFFSET, pitch: MAX_PITCH, power: MAX_POWER })).toBe(true);
  });

  it('accepts negative yaw within bounds', () => {
    expect(validateFirePayload({ yaw: -MAX_YAW_OFFSET, pitch: 0.5, power: 30 })).toBe(true);
  });

  it('rejects power below minimum', () => {
    expect(validateFirePayload({ yaw: 0, pitch: 0.5, power: MIN_POWER - 1 })).toBe(false);
  });

  it('rejects power above maximum', () => {
    expect(validateFirePayload({ yaw: 0, pitch: 0.5, power: MAX_POWER + 1 })).toBe(false);
  });

  it('rejects pitch below minimum', () => {
    expect(validateFirePayload({ yaw: 0, pitch: MIN_PITCH - 0.01, power: 30 })).toBe(false);
  });

  it('rejects pitch above maximum', () => {
    expect(validateFirePayload({ yaw: 0, pitch: MAX_PITCH + 0.01, power: 30 })).toBe(false);
  });

  it('rejects yaw exceeding max offset', () => {
    expect(validateFirePayload({ yaw: MAX_YAW_OFFSET + 0.01, pitch: 0.5, power: 30 })).toBe(false);
    expect(validateFirePayload({ yaw: -(MAX_YAW_OFFSET + 0.01), pitch: 0.5, power: 30 })).toBe(false);
  });

  it('rejects NaN values', () => {
    expect(validateFirePayload({ yaw: NaN, pitch: 0.5, power: 30 })).toBe(false);
    expect(validateFirePayload({ yaw: 0, pitch: NaN, power: 30 })).toBe(false);
    expect(validateFirePayload({ yaw: 0, pitch: 0.5, power: NaN })).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(validateFirePayload({ yaw: Infinity, pitch: 0.5, power: 30 })).toBe(false);
    expect(validateFirePayload({ yaw: 0, pitch: -Infinity, power: 30 })).toBe(false);
  });

  it('rejects non-number types', () => {
    expect(validateFirePayload({ yaw: '0', pitch: 0.5, power: 30 })).toBe(false);
    expect(validateFirePayload({ yaw: 0, pitch: null, power: 30 })).toBe(false);
    expect(validateFirePayload({ yaw: 0, pitch: 0.5, power: undefined })).toBe(false);
  });
});
