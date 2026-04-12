import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { randomUUID, createHash } from 'crypto';
import {
  MIN_POWER, MAX_POWER, MIN_PITCH, MAX_PITCH, MAX_YAW_OFFSET,
  MAX_LAYOUT_BLOCKS, MAX_GRID_SIZE, MAX_LAYERS,
  SHOT_RESOLVE_TIMEOUT, FIRE_SAFETY_TIMEOUT, VALID_MODES,
} from './shared/constants.js';

const app = express();
const http = createServer(app);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : null;
const corsConfig = allowedOrigins
  ? { origin: allowedOrigins }
  : process.env.NODE_ENV === 'production'
    ? { origin: false }           // same-origin only in production
    : { origin: '*' };            // permissive in development
const io = new Server(http, { cors: corsConfig });

app.use(express.static('dist'));
app.get('/health', (req, res) => res.send('ok'));

// ── In-memory state ───────────────────────────────────

const games = new Map();        // gameId → game object
const players = new Map();      // sessionId → { gameId, playerIndex }
const graceTimers = new Map();  // "gameId:playerIndex" → timeout handle
const liveSockets = new Map();  // sessionId → socket
const turnTimeouts = new Map(); // gameId → timeout handle
const pendingShots = new Map(); // gameId → { reports, timer }
const lobbies = new Map();      // lobbyId → { id, hostSessionId, hostName, gameMode, passwordHash, createdAt }
const lobbyClients = new Set(); // sessionIds currently viewing the lobby

const RECONNECT_GRACE = 30;
const MAX_LOBBIES = 100;
const MAX_GAMES = 200;

// ── Rate Limiting (per-action buckets) ───────────────

const rateLimitCounters = new Map(); // sessionId → Map<bucket, { count, resetAt }>

const RATE_BUCKETS = {
  fire:       { window: 5000, max: 2 },
  'shot-result': { window: 5000, max: 2 },
  'build-ready': { window: 5000, max: 2 },
  'reposition-complete': { window: 5000, max: 2 },
  lobby:      { window: 2000, max: 5 },  // lobby:create, lobby:join, lobby:cancel, etc.
  _default:   { window: 2000, max: 30 },
};

function getBucket(event) {
  if (RATE_BUCKETS[event]) return event;
  if (event.startsWith('lobby:')) return 'lobby';
  return '_default';
}

function rateLimit(sessionId, event) {
  const bucket = getBucket(event);
  const config = RATE_BUCKETS[bucket];
  const now = Date.now();

  let sessionBuckets = rateLimitCounters.get(sessionId);
  if (!sessionBuckets) {
    sessionBuckets = new Map();
    rateLimitCounters.set(sessionId, sessionBuckets);
  }

  let entry = sessionBuckets.get(bucket);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + config.window };
    sessionBuckets.set(bucket, entry);
  }
  entry.count++;
  return entry.count > config.max;
}

function cleanupRateLimit(sessionId) {
  rateLimitCounters.delete(sessionId);
}

// ── Input Validation ──────────────────────────────────

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateFirePayload({ yaw, pitch, power }) {
  if (!isFiniteNumber(yaw) || !isFiniteNumber(pitch) || !isFiniteNumber(power)) return false;
  if (power < MIN_POWER || power > MAX_POWER) return false;
  if (pitch < MIN_PITCH || pitch > MAX_PITCH) return false;
  if (Math.abs(yaw) > MAX_YAW_OFFSET) return false;
  return true;
}

function validateCastleData(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.layout) || data.layout.length > MAX_LAYOUT_BLOCKS) return false;
  if (!data.target || !isFiniteNumber(data.target.x) || !isFiniteNumber(data.target.z)) return false;
  if (data.target.x < 0 || data.target.x >= MAX_GRID_SIZE) return false;
  if (data.target.z < 0 || data.target.z >= MAX_GRID_SIZE) return false;
  for (const block of data.layout) {
    if (!block || typeof block !== 'object') return false;
    if (!isFiniteNumber(block.x) || !isFiniteNumber(block.y) || !isFiniteNumber(block.z)) return false;
    if (typeof block.type !== 'string' || block.type.length > 20) return false;
    if (block.x < 0 || block.x >= MAX_GRID_SIZE) return false;
    if (block.y < 0 || block.y >= MAX_LAYERS) return false;
    if (block.z < 0 || block.z >= MAX_GRID_SIZE) return false;
  }
  // Target must not overlap any block in the same column
  const tx = data.target.x, tz = data.target.z;
  if (data.layout.some(b => b.x === tx && b.z === tz)) return false;
  return true;
}

function validateRepositionPayload({ targetPos }) {
  if (!targetPos || typeof targetPos !== 'object') return false;
  if (!isFiniteNumber(targetPos.x) || !isFiniteNumber(targetPos.z)) return false;
  if (targetPos.x < 0 || targetPos.x >= MAX_GRID_SIZE) return false;
  if (targetPos.z < 0 || targetPos.z >= MAX_GRID_SIZE) return false;
  return true;
}

// ── Lobby helpers ─────────────────────────────────────

function hashPassword(pw) {
  return createHash('sha256').update(pw).digest('hex');
}

function getLobbyList(forSessionId) {
  return Array.from(lobbies.values())
    .filter(l => l.hostSessionId !== forSessionId)
    .map(l => ({
      id: l.id,
      hostName: l.hostName,
      gameMode: l.gameMode,
      hasPassword: !!l.passwordHash,
    }));
}

function broadcastLobbyList() {
  for (const sid of lobbyClients) {
    const s = liveSockets.get(sid);
    if (s) s.emit('lobby:list', getLobbyList(sid));
  }
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

// ── Matchmaking ───────────────────────────────────────

function matchPlayers(s1, s2, gameMode) {
  if (games.size >= MAX_GAMES) return;
  const gameId = randomUUID();
  const currentTurn = Math.random() < 0.5 ? 0 : 1;

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
}

// ── Shot resolution (server-authoritative) ────────────

function resolveShot(gameId) {
  const pending = pendingShots.get(gameId);
  if (!pending) return;

  if (pending.timer) clearTimeout(pending.timer);
  pendingShots.delete(gameId);

  const game = games.get(gameId);
  if (!game || game.phase !== 'battle') return;

  if (turnTimeouts.has(gameId)) {
    clearTimeout(turnTimeouts.get(gameId));
    turnTimeouts.delete(gameId);
  }

  const attacker = game.currentTurn;
  const defender = 1 - attacker;

  const attackerReport = pending.reports.get(attacker);
  const defenderReport = pending.reports.get(defender);

  let isHit;
  if (defenderReport) {
    isHit = defenderReport.hit;
  } else if (attackerReport) {
    isHit = attackerReport.hit;
  } else {
    isHit = false;
  }

  if (isHit) {
    const perfect = attackerReport?.perfect || false;
    const damage = perfect ? 2 : 1;
    const damagedPlayer = defender;
    game.hp[damagedPlayer] = Math.max(0, game.hp[damagedPlayer] - damage);

    if (game.hp[damagedPlayer] <= 0) {
      game.phase = 'over';
      for (const sid of game.sessionIds) {
        const s = liveSockets.get(sid);
        if (s) s.emit('game-over', { winner: attacker });
      }
      setTimeout(() => {
        games.delete(gameId);
        for (const sid of game.sessionIds) players.delete(sid);
      }, 10000);
    } else {
      game.phase = 'reposition';
      for (const sid of game.sessionIds) {
        const s = liveSockets.get(sid);
        if (s) s.emit('shot-resolved', { hit: true, damagedPlayer, hp: [...game.hp] });
      }
    }
  } else {
    game.currentTurn = 1 - game.currentTurn;
    for (const sid of game.sessionIds) {
      const s = liveSockets.get(sid);
      if (s) s.emit('shot-resolved', { hit: false, nextTurn: game.currentTurn });
    }
  }
}

// ── Socket.io ─────────────────────────────────────────

io.on('connection', (socket) => {
  const sessionId = socket.handshake.auth.sessionId;
  if (!sessionId) {
    socket.disconnect();
    return;
  }

  liveSockets.set(sessionId, socket);
  socket.sessionId = sessionId;

  // Rate-limit wrapper — drop events from abusive clients (per-action buckets)
  socket.use(([event], next) => {
    if (rateLimit(sessionId, event)) {
      return; // silently drop
    }
    next();
  });

  // Check for active game to reconnect to
  const playerInfo = players.get(sessionId);
  if (playerInfo) {
    const game = games.get(playerInfo.gameId);
    if (game && game.phase !== 'over') {
      socket.gameId = game.id;
      socket.playerIndex = playerInfo.playerIndex;

      const graceKey = `${game.id}:${playerInfo.playerIndex}`;
      if (graceTimers.has(graceKey)) {
        clearTimeout(graceTimers.get(graceKey));
        graceTimers.delete(graceKey);
      }

      socket.emit('reconnected', {
        gameId: game.id,
        playerIndex: playerInfo.playerIndex,
        game: {
          phase: game.phase,
          currentTurn: game.currentTurn,
          castles: game.castles,
          hp: game.hp,
          firstTurn: game.currentTurn,
          gameMode: game.gameMode,
        },
      });

      const oppSessionId = game.sessionIds[1 - playerInfo.playerIndex];
      const oppSocket = liveSockets.get(oppSessionId);
      if (oppSocket) oppSocket.emit('opponent-reconnected');
      return;
    }
  }

  // Lobby

  socket.on('lobby:enter', () => {
    lobbyClients.add(sessionId);
    socket.emit('lobby:list', getLobbyList(sessionId));
  });

  socket.on('lobby:leave', () => {
    lobbyClients.delete(sessionId);
    removeLobbyByHost(sessionId);
  });

  socket.on('lobby:create', ({ name, gameMode, password }) => {
    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 20) return;
    if (!VALID_MODES.includes(gameMode)) return;
    if (password && (typeof password !== 'string' || password.length > 30)) return;

    removeLobbyByHost(sessionId);
    if (lobbies.size >= MAX_LOBBIES) return;

    const lobbyId = randomUUID();
    lobbies.set(lobbyId, {
      id: lobbyId,
      hostSessionId: sessionId,
      hostName: name.trim(),
      gameMode,
      passwordHash: password ? hashPassword(password) : null,
      createdAt: Date.now(),
    });

    socket.lobbyId = lobbyId;
    socket.emit('lobby:created', { lobbyId });
    broadcastLobbyList();
  });

  socket.on('lobby:join', ({ lobbyId, name, password }) => {
    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 20) return;

    const lobby = lobbies.get(lobbyId);
    if (!lobby) {
      socket.emit('lobby:error', { message: 'Lobby no longer exists' });
      return;
    }
    if (lobby.hostSessionId === sessionId) return;

    if (lobby.passwordHash) {
      if (!password || hashPassword(password) !== lobby.passwordHash) {
        socket.emit('lobby:error', { message: 'Incorrect password' });
        return;
      }
    }

    const hostSocket = liveSockets.get(lobby.hostSessionId);
    if (!hostSocket) {
      lobbies.delete(lobbyId);
      broadcastLobbyList();
      socket.emit('lobby:error', { message: 'Host disconnected' });
      return;
    }

    // Clean up lobby state for both players
    lobbies.delete(lobbyId);
    lobbyClients.delete(sessionId);
    lobbyClients.delete(lobby.hostSessionId);
    broadcastLobbyList();

    matchPlayers(hostSocket, socket, lobby.gameMode);
  });

  socket.on('lobby:cancel', () => {
    removeLobbyByHost(sessionId);
  });

  // Build phase

  socket.on('build-ready', ({ castleData }) => {
    if (!socket.gameId) return;
    if (!validateCastleData(castleData)) return;
    const game = games.get(socket.gameId);
    if (!game || game.phase !== 'build') return;

    game.castles[socket.playerIndex] = castleData;

    if (game.castles[0] !== null && game.castles[1] !== null) {
      game.phase = 'battle';
    }

    if (game.phase === 'battle') {
      const s0 = liveSockets.get(game.sessionIds[0]);
      const s1 = liveSockets.get(game.sessionIds[1]);
      const payload = { castles: [game.castles[0], game.castles[1]] };
      if (s0) s0.emit('build-complete', payload);
      if (s1) s1.emit('build-complete', payload);
    }
  });

  // Battle phase

  socket.on('fire', ({ yaw, pitch, power }) => {
    if (!socket.gameId) return;
    if (!validateFirePayload({ yaw, pitch, power })) return;
    const game = games.get(socket.gameId);
    if (!game || game.phase !== 'battle') return;
    if (socket.playerIndex !== game.currentTurn) return;

    const oppSessionId = game.sessionIds[1 - socket.playerIndex];
    const oppSocket = liveSockets.get(oppSessionId);
    if (oppSocket) oppSocket.emit('opponent-fired', { yaw, pitch, power });

    if (turnTimeouts.has(game.id)) clearTimeout(turnTimeouts.get(game.id));
    const firedByTurn = game.currentTurn;
    turnTimeouts.set(game.id, setTimeout(() => {
      turnTimeouts.delete(game.id);
      const g = games.get(game.id);
      if (!g || g.phase !== 'battle') return;
      if (g.currentTurn !== firedByTurn) return;
      if (pendingShots.has(game.id)) return;
      g.currentTurn = 1 - g.currentTurn;
      for (const sid of g.sessionIds) {
        const s = liveSockets.get(sid);
        if (s) s.emit('shot-resolved', { hit: false, nextTurn: g.currentTurn });
      }
    }, FIRE_SAFETY_TIMEOUT));
  });

  // Shot result

  socket.on('shot-result', ({ hit, perfect }) => {
    if (!socket.gameId) return;
    if (typeof hit !== 'boolean' && hit !== undefined) return;
    const game = games.get(socket.gameId);
    if (!game || game.phase !== 'battle') return;

    let pending = pendingShots.get(game.id);
    if (!pending) {
      pending = { reports: new Map(), timer: null };
      pendingShots.set(game.id, pending);
      pending.timer = setTimeout(() => resolveShot(game.id), SHOT_RESOLVE_TIMEOUT);
    }

    pending.reports.set(socket.playerIndex, { hit: !!hit, perfect: !!perfect });

    if (pending.reports.size >= 2) {
      resolveShot(game.id);
    }
  });

  // Reposition

  socket.on('reposition-complete', (data) => {
    if (!socket.gameId) return;
    if (!validateRepositionPayload(data)) return;
    const { targetPos } = data;
    const game = games.get(socket.gameId);
    if (!game || game.phase !== 'reposition') return;

    // Track repositioned target for reconnection state
    if (game.castles[socket.playerIndex]) {
      game.castles[socket.playerIndex].target = { ...targetPos };
    }

    game.phase = 'battle';
    game.currentTurn = 1 - game.currentTurn;

    for (const sid of game.sessionIds) {
      const s = liveSockets.get(sid);
      if (s) s.emit('reposition-done', { targetPos, nextTurn: game.currentTurn });
    }
  });

  // Disconnect

  socket.on('disconnect', () => {
    liveSockets.delete(sessionId);
    lobbyClients.delete(sessionId);
    removeLobbyByHost(sessionId);
    cleanupRateLimit(sessionId);

    if (!socket.gameId) return;

    const game = games.get(socket.gameId);
    if (!game || game.phase === 'over') return;

    const oppSessionId = game.sessionIds[1 - socket.playerIndex];
    const oppSocket = liveSockets.get(oppSessionId);
    if (oppSocket) oppSocket.emit('opponent-disconnected-temp');

    const graceKey = `${game.id}:${socket.playerIndex}`;
    const timer = setTimeout(() => {
      if (!graceTimers.has(graceKey)) return; // player reconnected
      graceTimers.delete(graceKey);

      const g = games.get(socket.gameId);
      if (!g || g.phase === 'over') return;

      g.phase = 'over';

      const opp = liveSockets.get(oppSessionId);
      if (opp) opp.emit('opponent-disconnected');

      setTimeout(() => {
        games.delete(game.id);
        for (const sid of game.sessionIds) players.delete(sid);
      }, 5000);
    }, RECONNECT_GRACE * 1000);

    graceTimers.set(graceKey, timer);
  });
});

// ── Lobby TTL cleanup ────────────────────────────────

const LOBBY_TTL = 5 * 60 * 1000; // 5 minutes

setInterval(() => {
  const now = Date.now();
  let pruned = false;
  for (const [id, lobby] of lobbies) {
    if (now - lobby.createdAt > LOBBY_TTL) {
      lobbies.delete(id);
      pruned = true;
    }
  }
  if (pruned) broadcastLobbyList();
}, 60_000); // check every minute

// ── Graceful shutdown ────────────────────────────────

function gracefulShutdown(signal) {
  console.log(`${signal} received — draining connections...`);
  io.emit('server-shutdown');
  io.close(() => {
    http.close(() => {
      console.log('Server shut down gracefully.');
      process.exit(0);
    });
  });
  // Force exit after 15 seconds if draining stalls
  setTimeout(() => {
    console.warn('Forced shutdown after timeout.');
    process.exit(1);
  }, 15_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ── Start ────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Cannonfall server listening on port ${PORT}`);
});
