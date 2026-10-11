import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { randomUUID, randomInt, createHash } from 'crypto';
import { logger } from './logger.js';
import {
  MIN_POWER, MAX_POWER, MIN_PITCH, MAX_PITCH, MAX_YAW_OFFSET, MODE_RULES,
  SHOT_RESOLVE_TIMEOUT, FIRE_SAFETY_TIMEOUT, MAX_LOBBIES, MAX_GAMES,
  RECONNECT_GRACE_SECONDS, LOBBY_TTL_MS, LOBBY_CLEANUP_INTERVAL_MS,
  GAME_CLEANUP_DELAY_MS, DISCONNECT_CLEANUP_DELAY_MS, MAX_HP,
} from '../shared/constants.js';
import { isPerfectPower, validateCastle, validateTargetPos } from '../shared/rules.js';

// Per-action rate limits: at most `max` events per `window` ms per session
export const RATE_LIMITS = {
  fire:                  { window: 5000, max: 2 },
  'shot-result':         { window: 5000, max: 2 },
  'build-ready':         { window: 5000, max: 2 },
  'reposition-complete': { window: 5000, max: 2 },
  lobby:                 { window: 2000, max: 5 },  // every lobby:* event
  _default:              { window: 2000, max: 30 },
};

const DEFAULTS = {
  staticDir: fileURLToPath(new URL('../dist', import.meta.url)),
  shotResolveTimeout: SHOT_RESOLVE_TIMEOUT,
  fireSafetyTimeout: FIRE_SAFETY_TIMEOUT,
  reconnectGraceMs: RECONNECT_GRACE_SECONDS * 1000,
  lobbyTtlMs: LOBBY_TTL_MS,
  lobbyCleanupIntervalMs: LOBBY_CLEANUP_INTERVAL_MS,
  gameCleanupDelayMs: GAME_CLEANUP_DELAY_MS,
  disconnectCleanupDelayMs: DISCONNECT_CLEANUP_DELAY_MS,
  maxLobbies: MAX_LOBBIES,
  maxGames: MAX_GAMES,
  rateLimits: RATE_LIMITS,
};

/** Socket.io CORS config: explicit allow-list, else same-origin in production, open in dev. */
export function corsOptions(env = process.env) {
  if (env.ALLOWED_ORIGINS) return { origin: env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) };
  return { origin: env.NODE_ENV === 'production' ? false : '*' };
}

function isObject(v) {
  return v !== null && typeof v === 'object';
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function validateFire({ yaw, pitch, power }) {
  if (!isFiniteNumber(yaw) || !isFiniteNumber(pitch) || !isFiniteNumber(power)) return false;
  if (power < MIN_POWER || power > MAX_POWER) return false;
  if (pitch < MIN_PITCH || pitch > MAX_PITCH) return false;
  return Math.abs(yaw) <= MAX_YAW_OFFSET;
}

/** Returns the trimmed name, or null if it isn't a usable display name. */
export function validateName(name) {
  if (typeof name !== 'string' || name.length > 20) return null;
  return name.trim() || null;
}

function hashPassword(pw) {
  return createHash('sha256').update(pw).digest('hex');
}

/**
 * Create the HTTP + Socket.io game server without listening.
 * Options override the timing and capacity defaults (tests use short timeouts).
 */
export function createGameServer(options = {}) {
  const config = { ...DEFAULTS, ...options };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(config.staticDir));
  app.get('/health', (req, res) => res.send('ok'));

  const http = createServer(app);
  const io = new Server(http, {
    cors: config.cors ?? corsOptions(),
    maxHttpBufferSize: 200_000, // a max-size castle is well under this
  });

  // ── In-memory state ─────────────────────────────────

  const games = new Map();        // gameId → game
  const players = new Map();      // sessionId → { gameId, playerIndex }
  const liveSockets = new Map();  // sessionId → socket
  const graceTimers = new Map();  // sessionId → reconnect grace timer
  const lobbies = new Map();      // lobbyId → { id, hostSessionId, hostName, gameMode, passwordHash, createdAt }
  const lobbyClients = new Set(); // sessionIds currently viewing the lobby
  const rateCounters = new Map(); // sessionId → Map<bucket, { count, resetAt }>

  // Every timer goes through schedule() so close() can cancel them all
  const timers = new Set();
  function schedule(fn, ms) {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  }
  function cancel(id) {
    clearTimeout(id);
    timers.delete(id);
  }

  // ── Helpers ─────────────────────────────────────────

  function isRateLimited(sessionId, event) {
    const limits = config.rateLimits;
    const bucket = limits[event] ? event : event.startsWith('lobby:') ? 'lobby' : '_default';
    const { window, max } = limits[bucket];
    const now = Date.now();
    let buckets = rateCounters.get(sessionId);
    if (!buckets) rateCounters.set(sessionId, buckets = new Map());
    let entry = buckets.get(bucket);
    if (!entry || now > entry.resetAt) buckets.set(bucket, entry = { count: 0, resetAt: now + window });
    return ++entry.count > max;
  }

  /** The session's game and seat, if it is in a game that hasn't ended. */
  function activeGame(sessionId) {
    const info = players.get(sessionId);
    const game = info && games.get(info.gameId);
    if (!game || game.phase === 'over') return null;
    return { game, me: info.playerIndex };
  }

  function emitTo(sessionId, event, payload) {
    liveSockets.get(sessionId)?.emit(event, payload);
  }

  function emitToGame(game, event, payload) {
    for (const sid of game.sessionIds) emitTo(sid, event, payload);
  }

  function getLobbyList(forSessionId) {
    return Array.from(lobbies.values())
      .filter(l => l.hostSessionId !== forSessionId)
      .map(l => ({ id: l.id, hostName: l.hostName, gameMode: l.gameMode, hasPassword: !!l.passwordHash }));
  }

  function broadcastLobbyList() {
    for (const sid of lobbyClients) emitTo(sid, 'lobby:list', getLobbyList(sid));
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

  // ── Game lifecycle ──────────────────────────────────

  function startGame(hostSessionId, guestSessionId, gameMode) {
    const game = {
      id: randomUUID(),
      sessionIds: [hostSessionId, guestSessionId],
      currentTurn: randomInt(2),
      phase: 'build',       // build → battle ⇄ reposition → over
      castles: [null, null],
      hp: [MAX_HP, MAX_HP],
      gameMode,
      shot: null,           // in-flight shot: { attacker, perfect, reports, timer }
      repositioner: null,   // player moving their target after being hit
    };
    games.set(game.id, game);
    game.sessionIds.forEach((sid, playerIndex) => {
      players.set(sid, { gameId: game.id, playerIndex });
      emitTo(sid, 'matched', { playerIndex, firstTurn: game.currentTurn, gameMode });
    });
    logger.info('Game matched', { gameId: game.id, gameMode, firstTurn: game.currentTurn });
  }

  function endGame(game, cleanupDelay) {
    game.phase = 'over';
    if (game.shot) cancel(game.shot.timer);
    game.shot = null;
    schedule(() => {
      games.delete(game.id);
      for (const sid of game.sessionIds) {
        // The player may already be in a newer game
        if (players.get(sid)?.gameId === game.id) players.delete(sid);
      }
    }, cleanupDelay);
  }

  function resolveShot(game) {
    const shot = game.shot;
    if (!shot) return;
    cancel(shot.timer);
    game.shot = null;

    const attacker = shot.attacker;
    const defender = 1 - attacker;
    // Each client simulates the shot. The defender's client is trusted for
    // hits on its own castle; the attacker's report only counts if the
    // defender never reports.
    const hit = shot.reports[defender] ?? shot.reports[attacker] ?? false;

    if (!hit) {
      game.currentTurn = defender;
      logger.debug('Shot resolved', { gameId: game.id, hit: false });
      emitToGame(game, 'shot-resolved', { hit: false, nextTurn: defender });
      return;
    }

    const damage = shot.perfect ? 2 : 1;
    game.hp[defender] = Math.max(0, game.hp[defender] - damage);
    logger.info('Shot resolved', { gameId: game.id, hit: true, perfect: shot.perfect, damage, hp: [...game.hp] });

    if (game.hp[defender] === 0) {
      endGame(game, config.gameCleanupDelayMs);
      emitToGame(game, 'game-over', { winner: attacker });
    } else {
      game.phase = 'reposition';
      game.repositioner = defender;
      emitToGame(game, 'shot-resolved', { hit: true, damagedPlayer: defender, hp: [...game.hp] });
    }
  }

  // ── Connections ─────────────────────────────────────

  io.on('connection', (socket) => {
    const { sessionId } = socket.handshake.auth ?? {};
    if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 64) {
      socket.disconnect(true);
      return;
    }
    liveSockets.set(sessionId, socket);

    // All client events go through here: rate-limited, payload coerced to an
    // object, and a handler that throws is logged instead of killing the process.
    const on = (event, handler) => socket.on(event, (payload) => {
      if (isRateLimited(sessionId, event)) {
        logger.debug('Rate limited', { sessionId, event });
        return;
      }
      try {
        handler(isObject(payload) ? payload : {});
      } catch (err) {
        logger.error('Handler failed', { event, sessionId, error: err.message });
      }
    });

    // Resume an active game after a reload or dropped connection
    const resumed = activeGame(sessionId);
    if (resumed) {
      const { game, me } = resumed;
      cancel(graceTimers.get(sessionId));
      graceTimers.delete(sessionId);
      socket.emit('reconnected', {
        gameId: game.id,
        playerIndex: me,
        game: {
          phase: game.phase,
          currentTurn: game.currentTurn,
          repositioningPlayer: game.repositioner,
          castles: game.castles,
          hp: game.hp,
          gameMode: game.gameMode,
        },
      });
      emitTo(game.sessionIds[1 - me], 'opponent-reconnected');
    }

    // Lobby

    on('lobby:enter', () => {
      lobbyClients.add(sessionId);
      socket.emit('lobby:list', getLobbyList(sessionId));
    });

    on('lobby:leave', () => {
      lobbyClients.delete(sessionId);
      removeLobbyByHost(sessionId);
    });

    on('lobby:create', ({ name, gameMode, password }) => {
      const hostName = validateName(name);
      if (!hostName || !Object.hasOwn(MODE_RULES, gameMode)) return;
      if (password != null && (typeof password !== 'string' || password.length > 30)) return;
      if (activeGame(sessionId)) return;

      removeLobbyByHost(sessionId);
      if (lobbies.size >= config.maxLobbies) {
        socket.emit('lobby:error', { message: 'Too many open games, try again soon' });
        return;
      }

      const lobbyId = randomUUID();
      lobbies.set(lobbyId, {
        id: lobbyId,
        hostSessionId: sessionId,
        hostName,
        gameMode,
        passwordHash: password ? hashPassword(password) : null,
        createdAt: Date.now(),
      });
      socket.emit('lobby:created', { lobbyId });
      broadcastLobbyList();
    });

    on('lobby:join', ({ lobbyId, password }) => {
      if (activeGame(sessionId)) return;
      const lobby = lobbies.get(lobbyId);
      if (!lobby) {
        socket.emit('lobby:error', { message: 'Lobby no longer exists' });
        return;
      }
      if (lobby.hostSessionId === sessionId) return;
      if (lobby.passwordHash && (typeof password !== 'string' || hashPassword(password) !== lobby.passwordHash)) {
        socket.emit('lobby:error', { message: 'Incorrect password' });
        return;
      }
      if (!liveSockets.has(lobby.hostSessionId)) {
        lobbies.delete(lobbyId);
        broadcastLobbyList();
        socket.emit('lobby:error', { message: 'Host disconnected' });
        return;
      }
      if (games.size >= config.maxGames) {
        socket.emit('lobby:error', { message: 'Server is full, try again soon' });
        return;
      }

      lobbies.delete(lobbyId);
      lobbyClients.delete(sessionId);
      lobbyClients.delete(lobby.hostSessionId);
      broadcastLobbyList();
      startGame(lobby.hostSessionId, sessionId, lobby.gameMode);
    });

    on('lobby:cancel', () => removeLobbyByHost(sessionId));

    // Build phase

    on('build-ready', ({ castleData }) => {
      const ctx = activeGame(sessionId);
      if (!ctx || ctx.game.phase !== 'build') return;
      const { game, me } = ctx;

      const castle = validateCastle(castleData, game.gameMode);
      if (!castle) {
        logger.warn('Invalid castle data', { sessionId, gameMode: game.gameMode });
        return;
      }
      game.castles[me] = castle;

      if (game.castles[0] && game.castles[1]) {
        game.phase = 'battle';
        emitToGame(game, 'build-complete', { castles: [...game.castles] });
      }
    });

    // Battle phase

    on('fire', ({ yaw, pitch, power }) => {
      const ctx = activeGame(sessionId);
      if (!ctx) return;
      const { game, me } = ctx;
      if (game.phase !== 'battle' || game.currentTurn !== me || game.shot) return;
      if (!validateFire({ yaw, pitch, power })) {
        logger.warn('Invalid fire payload', { sessionId, yaw, pitch, power });
        return;
      }

      // The server decides whether the charge hit the sweet spot, and both
      // clients simulate the shot with that verdict.
      const perfect = isPerfectPower(power);
      game.shot = {
        attacker: me,
        perfect,
        reports: [null, null],
        timer: schedule(() => resolveShot(game), config.fireSafetyTimeout),
      };
      emitTo(game.sessionIds[1 - me], 'opponent-fired', { yaw, pitch, power, perfect });
    });

    on('shot-result', ({ hit }) => {
      const ctx = activeGame(sessionId);
      if (!ctx || typeof hit !== 'boolean') return;
      const { game, me } = ctx;
      const shot = game.shot;
      if (!shot || shot.reports[me] !== null) return; // no shot in flight, or already reported

      shot.reports[me] = hit;
      if (shot.reports.every(r => r !== null)) {
        resolveShot(game);
      } else if (me !== shot.attacker) {
        // The defender has spoken; give the attacker's simulation a moment to finish
        cancel(shot.timer);
        shot.timer = schedule(() => resolveShot(game), config.shotResolveTimeout);
      }
    });

    on('reposition-complete', ({ targetPos }) => {
      const ctx = activeGame(sessionId);
      if (!ctx) return;
      const { game, me } = ctx;
      if (game.phase !== 'reposition' || game.repositioner !== me) return;

      const target = validateTargetPos(targetPos, game.gameMode);
      if (!target) {
        logger.warn('Invalid reposition payload', { sessionId });
        return;
      }
      game.castles[me].target = target;
      game.phase = 'battle';
      game.repositioner = null;
      game.currentTurn = me; // the player who was hit shoots next
      emitToGame(game, 'reposition-done', { player: me, targetPos: target, nextTurn: me });
    });

    // Disconnect

    socket.on('disconnect', () => {
      // A newer connection for the same session has already taken over
      if (liveSockets.get(sessionId) !== socket) return;

      liveSockets.delete(sessionId);
      lobbyClients.delete(sessionId);
      removeLobbyByHost(sessionId);
      rateCounters.delete(sessionId);

      const ctx = activeGame(sessionId);
      if (!ctx) return;
      const { game, me } = ctx;
      logger.info('Player disconnected', { gameId: game.id, playerIndex: me });

      const opponent = game.sessionIds[1 - me];
      emitTo(opponent, 'opponent-disconnected-temp');
      graceTimers.set(sessionId, schedule(() => {
        graceTimers.delete(sessionId);
        if (game.phase === 'over') return;
        endGame(game, config.disconnectCleanupDelayMs);
        emitTo(opponent, 'opponent-disconnected');
      }, config.reconnectGraceMs));
    });
  });

  // Expire lobbies nobody joined
  const lobbySweep = setInterval(() => {
    const now = Date.now();
    let pruned = false;
    for (const [id, lobby] of lobbies) {
      if (now - lobby.createdAt > config.lobbyTtlMs) {
        lobbies.delete(id);
        pruned = true;
      }
    }
    if (pruned) broadcastLobbyList();
  }, config.lobbyCleanupIntervalMs);

  return {
    app,
    io,
    /** Start listening; resolves with the bound port (pass 0 for a random one). */
    listen(port) {
      return new Promise((resolve) => {
        http.listen(port, () => resolve(http.address().port));
      });
    },
    /** Tell clients, stop timers, and close every socket and the HTTP server. */
    close() {
      io.emit('server-shutdown');
      clearInterval(lobbySweep);
      for (const id of timers) clearTimeout(id);
      timers.clear();
      return new Promise((resolve) => io.close(() => resolve()));
    },
  };
}
