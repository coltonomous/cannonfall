import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { randomUUID } from 'crypto';

const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });

app.use(express.static('dist'));

// --- In-memory store with TTL (replaces Redis) ---

const store = new Map(); // key -> { value, timer }

function storeSet(key, value, ttlSeconds) {
  const existing = store.get(key);
  if (existing?.timer) clearTimeout(existing.timer);
  const timer = ttlSeconds
    ? setTimeout(() => store.delete(key), ttlSeconds * 1000)
    : null;
  store.set(key, { value, timer });
}

function storeGet(key) {
  const entry = store.get(key);
  return entry ? entry.value : null;
}

function storeDel(key) {
  const entry = store.get(key);
  if (entry?.timer) clearTimeout(entry.timer);
  store.delete(key);
}

const RECONNECT_GRACE = 30; // seconds to hold a game for a disconnected player
const GAME_TTL = 3600;      // 1 hour max game lifetime

// --- Game helpers ---

function getGame(gameId) {
  return storeGet(`game:${gameId}`);
}

function saveGame(game) {
  storeSet(`game:${game.id}`, game, GAME_TTL);
}

function deleteGame(gameId) {
  storeDel(`game:${gameId}`);
}

function setPlayerGame(sessionId, gameId, playerIndex) {
  storeSet(`player:${sessionId}`, { gameId, playerIndex }, GAME_TTL);
}

function getPlayerGame(sessionId) {
  return storeGet(`player:${sessionId}`);
}

function clearPlayerGame(sessionId) {
  storeDel(`player:${sessionId}`);
}

// --- In-memory state (sockets can't be serialized) ---
const queue = [];
const liveSockets = new Map();  // sessionId -> socket
const turnTimeouts = new Map(); // gameId -> timeout handle
const pendingShots = new Map(); // gameId -> { reports: Map<playerIndex, {hit,perfect}>, timer }

// --- Shot resolution (server-authoritative) ---

function resolveShot(gameId) {
  const pending = pendingShots.get(gameId);
  if (!pending) return;

  if (pending.timer) clearTimeout(pending.timer);
  pendingShots.delete(gameId);

  const game = getGame(gameId);
  if (!game || game.phase !== 'battle') return;

  // Clear the fire turn timeout — shot resolution handles turn transitions now
  if (turnTimeouts.has(gameId)) {
    clearTimeout(turnTimeouts.get(gameId));
    turnTimeouts.delete(gameId);
  }

  const attacker = game.currentTurn;
  const defender = 1 - attacker;

  const attackerReport = pending.reports.get(attacker);
  const defenderReport = pending.reports.get(defender);

  // Decision: trust defender if they reported; fall back to attacker on timeout
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
      saveGame(game);
      for (const sid of game.sessionIds) {
        const s = liveSockets.get(sid);
        if (s) s.emit('game-over', { winner: attacker });
      }
      setTimeout(() => {
        deleteGame(gameId);
        for (const sid of game.sessionIds) clearPlayerGame(sid);
      }, 10000);
    } else {
      game.phase = 'reposition';
      saveGame(game);
      for (const sid of game.sessionIds) {
        const s = liveSockets.get(sid);
        if (s) s.emit('shot-resolved', { hit: true, damagedPlayer, hp: [...game.hp] });
      }
    }
  } else {
    // Miss — advance turn
    game.currentTurn = 1 - game.currentTurn;
    saveGame(game);
    for (const sid of game.sessionIds) {
      const s = liveSockets.get(sid);
      if (s) s.emit('shot-resolved', { hit: false, nextTurn: game.currentTurn });
    }
  }
}

// --- Socket.io ---

io.on('connection', (socket) => {
  const sessionId = socket.handshake.auth.sessionId;
  if (!sessionId) {
    socket.disconnect();
    return;
  }

  liveSockets.set(sessionId, socket);
  socket.sessionId = sessionId;

  // Check for active game to reconnect to
  const playerInfo = getPlayerGame(sessionId);
  if (playerInfo) {
    const game = getGame(playerInfo.gameId);
    if (game && game.phase !== 'over') {
      socket.gameId = game.id;
      socket.playerIndex = playerInfo.playerIndex;

      // Clear disconnect grace timer
      storeDel(`grace:${game.id}:${playerInfo.playerIndex}`);

      // Send reconnection state
      socket.emit('reconnected', {
        gameId: game.id,
        playerIndex: playerInfo.playerIndex,
        game: {
          phase: game.phase,
          currentTurn: game.currentTurn,
          castles: game.castles,
          hp: game.hp,
          firstTurn: game.currentTurn,
        },
      });

      // Notify opponent
      const oppSessionId = game.sessionIds[1 - playerInfo.playerIndex];
      const oppSocket = liveSockets.get(oppSessionId);
      if (oppSocket) {
        oppSocket.emit('opponent-reconnected');
      }
      return;
    }
  }

  // --- Matchmaking ---

  socket.on('join-queue', () => {
    const idx = queue.findIndex(q => q.sessionId === sessionId);
    if (idx >= 0) queue.splice(idx, 1);

    queue.push(socket);

    if (queue.length >= 2) {
      matchPlayers(queue.shift(), queue.shift());
    }
  });

  function matchPlayers(s1, s2) {
    const gameId = randomUUID();
    const currentTurn = Math.random() < 0.5 ? 0 : 1;

    const game = {
      id: gameId,
      sessionIds: [s1.sessionId, s2.sessionId],
      currentTurn,
      phase: 'build',
      castles: [null, null],
      hp: [3, 3],
    };

    saveGame(game);
    setPlayerGame(s1.sessionId, gameId, 0);
    setPlayerGame(s2.sessionId, gameId, 1);

    s1.gameId = gameId;
    s1.playerIndex = 0;
    s2.gameId = gameId;
    s2.playerIndex = 1;

    s1.emit('matched', { playerIndex: 0, firstTurn: currentTurn });
    s2.emit('matched', { playerIndex: 1, firstTurn: currentTurn });
  }

  // --- Build phase ---

  socket.on('build-ready', ({ castleData }) => {
    if (!socket.gameId) return;
    const game = getGame(socket.gameId);
    if (!game || game.phase !== 'build') return;

    game.castles[socket.playerIndex] = castleData;

    if (game.castles[0] !== null && game.castles[1] !== null) {
      game.phase = 'battle';
    }
    saveGame(game);

    if (game.phase === 'battle') {
      const s0 = liveSockets.get(game.sessionIds[0]);
      const s1 = liveSockets.get(game.sessionIds[1]);
      const payload = { castles: [game.castles[0], game.castles[1]] };
      if (s0) s0.emit('build-complete', payload);
      if (s1) s1.emit('build-complete', payload);
    }
  });

  // --- Battle phase ---

  socket.on('fire', ({ yaw, pitch, power }) => {
    if (!socket.gameId) return;
    const game = getGame(socket.gameId);
    if (!game || game.phase !== 'battle') return;
    if (socket.playerIndex !== game.currentTurn) return;

    // Relay to opponent
    const oppSessionId = game.sessionIds[1 - socket.playerIndex];
    const oppSocket = liveSockets.get(oppSessionId);
    if (oppSocket) oppSocket.emit('opponent-fired', { yaw, pitch, power });

    // Safety timeout: if neither client reports within 10s, force miss
    if (turnTimeouts.has(game.id)) clearTimeout(turnTimeouts.get(game.id));
    turnTimeouts.set(game.id, setTimeout(() => {
      turnTimeouts.delete(game.id);
      // If no shot-result received, treat as miss
      if (!pendingShots.has(game.id)) {
        const g = getGame(game.id);
        if (!g || g.phase !== 'battle') return;
        g.currentTurn = 1 - g.currentTurn;
        saveGame(g);
        for (const sid of g.sessionIds) {
          const s = liveSockets.get(sid);
          if (s) s.emit('shot-resolved', { hit: false, nextTurn: g.currentTurn });
        }
      }
    }, 10000));
  });

  // --- Shot result (both clients report independently) ---

  socket.on('shot-result', ({ hit, perfect }) => {
    if (!socket.gameId) return;
    const game = getGame(socket.gameId);
    if (!game || game.phase !== 'battle') return;

    let pending = pendingShots.get(game.id);
    if (!pending) {
      pending = { reports: new Map(), timer: null };
      pendingShots.set(game.id, pending);

      // Wait up to 3s for both clients to report
      pending.timer = setTimeout(() => resolveShot(game.id), 3000);
    }

    pending.reports.set(socket.playerIndex, { hit: !!hit, perfect: !!perfect });

    // If both reported, resolve immediately
    if (pending.reports.size >= 2) {
      resolveShot(game.id);
    }
  });

  // --- Reposition ---

  socket.on('reposition-complete', ({ targetPos }) => {
    if (!socket.gameId) return;
    const game = getGame(socket.gameId);
    if (!game || game.phase !== 'reposition') return;

    game.phase = 'battle';
    game.currentTurn = 1 - game.currentTurn; // damaged player's turn next
    saveGame(game);

    for (const sid of game.sessionIds) {
      const s = liveSockets.get(sid);
      if (s) s.emit('reposition-done', { targetPos, nextTurn: game.currentTurn });
    }
  });

  // --- Disconnect with grace period ---

  socket.on('disconnect', () => {
    liveSockets.delete(sessionId);

    const qIdx = queue.findIndex(q => q.sessionId === sessionId);
    if (qIdx >= 0) queue.splice(qIdx, 1);

    if (!socket.gameId) return;

    const game = getGame(socket.gameId);
    if (!game || game.phase === 'over') return;

    // Notify opponent of temporary disconnect
    const oppSessionId = game.sessionIds[1 - socket.playerIndex];
    const oppSocket = liveSockets.get(oppSessionId);
    if (oppSocket) oppSocket.emit('opponent-disconnected-temp');

    // Grace period — if player doesn't reconnect, forfeit
    const graceKey = `grace:${game.id}:${socket.playerIndex}`;
    storeSet(graceKey, true, RECONNECT_GRACE);

    setTimeout(() => {
      if (!storeGet(graceKey)) return; // player reconnected

      const g = getGame(socket.gameId);
      if (!g || g.phase === 'over') return;

      g.phase = 'over';
      saveGame(g);

      const opp = liveSockets.get(oppSessionId);
      if (opp) opp.emit('opponent-disconnected');

      setTimeout(() => {
        deleteGame(game.id);
        for (const sid of game.sessionIds) clearPlayerGame(sid);
      }, 5000);
    }, RECONNECT_GRACE * 1000);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Cannonfall server listening on port ${PORT}`);
});
