import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });

app.use(express.static('dist'));

// --- Redis ---
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  retryStrategy: (times) => Math.min(times * 200, 5000),
  maxRetriesPerRequest: 3,
});
redis.on('error', (err) => console.error('Redis error:', err.message));

const RECONNECT_GRACE = 30; // seconds to hold a game for a disconnected player
const GAME_TTL = 3600; // 1 hour max game lifetime in Redis

// --- Helpers ---

async function getGame(gameId) {
  const data = await redis.get(`game:${gameId}`);
  return data ? JSON.parse(data) : null;
}

async function saveGame(game) {
  await redis.set(`game:${game.id}`, JSON.stringify(game), 'EX', GAME_TTL);
}

async function deleteGame(gameId) {
  await redis.del(`game:${gameId}`);
}

async function setPlayerGame(sessionId, gameId, playerIndex) {
  await redis.set(`player:${sessionId}`, JSON.stringify({ gameId, playerIndex }), 'EX', GAME_TTL);
}

async function getPlayerGame(sessionId) {
  const data = await redis.get(`player:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

async function clearPlayerGame(sessionId) {
  await redis.del(`player:${sessionId}`);
}

// --- In-memory state (sockets can't be serialized) ---
const queue = [];
const liveSockets = new Map(); // sessionId -> socket
const turnTimeouts = new Map(); // gameId -> timeout handle

// --- Socket.io ---

io.on('connection', async (socket) => {
  const sessionId = socket.handshake.auth.sessionId;
  if (!sessionId) {
    socket.disconnect();
    return;
  }

  liveSockets.set(sessionId, socket);
  socket.sessionId = sessionId;

  // Check for active game to reconnect to
  const playerInfo = await getPlayerGame(sessionId);
  if (playerInfo) {
    const game = await getGame(playerInfo.gameId);
    if (game && game.phase !== 'over') {
      socket.gameId = game.id;
      socket.playerIndex = playerInfo.playerIndex;

      // Clear disconnect grace timer
      const graceKey = `grace:${game.id}:${playerInfo.playerIndex}`;
      await redis.del(graceKey);

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
    // Remove if already in queue
    const idx = queue.findIndex(q => q.sessionId === sessionId);
    if (idx >= 0) queue.splice(idx, 1);

    queue.push(socket);

    if (queue.length >= 2) {
      matchPlayers(queue.shift(), queue.shift());
    }
  });

  async function matchPlayers(s1, s2) {
    const gameId = randomUUID();
    const currentTurn = Math.random() < 0.5 ? 0 : 1;

    const game = {
      id: gameId,
      sessionIds: [s1.sessionId, s2.sessionId],
      currentTurn,
      turnTimeout: null,
      phase: 'build',
      castles: [null, null],
      hp: [3, 3],
    };

    await saveGame(game);
    await setPlayerGame(s1.sessionId, gameId, 0);
    await setPlayerGame(s2.sessionId, gameId, 1);

    s1.gameId = gameId;
    s1.playerIndex = 0;
    s2.gameId = gameId;
    s2.playerIndex = 1;

    s1.emit('matched', { playerIndex: 0, firstTurn: currentTurn });
    s2.emit('matched', { playerIndex: 1, firstTurn: currentTurn });
  }

  // --- Build phase ---

  socket.on('build-ready', async ({ castleData }) => {
    if (!socket.gameId) return;
    const game = await getGame(socket.gameId);
    if (!game || game.phase !== 'build') return;

    game.castles[socket.playerIndex] = castleData;

    if (game.castles[0] !== null && game.castles[1] !== null) {
      game.phase = 'battle';
    }
    await saveGame(game);

    if (game.phase === 'battle') {
      const s0 = liveSockets.get(game.sessionIds[0]);
      const s1 = liveSockets.get(game.sessionIds[1]);
      const payload = { castles: [game.castles[0], game.castles[1]] };
      if (s0) s0.emit('build-complete', payload);
      if (s1) s1.emit('build-complete', payload);
    }
  });

  // --- Battle phase ---

  socket.on('fire', async ({ yaw, pitch, power }) => {
    if (!socket.gameId) return;
    const game = await getGame(socket.gameId);
    if (!game || game.phase !== 'battle') return;
    if (socket.playerIndex !== game.currentTurn) return;

    // Relay to opponent
    const oppSessionId = game.sessionIds[1 - socket.playerIndex];
    const oppSocket = liveSockets.get(oppSessionId);
    if (oppSocket) oppSocket.emit('opponent-fired', { yaw, pitch, power });

    // Turn timeout
    if (turnTimeouts.has(game.id)) clearTimeout(turnTimeouts.get(game.id));

    turnTimeouts.set(game.id, setTimeout(async () => {
      const g = await getGame(game.id);
      if (!g) return;
      g.currentTurn = 1 - g.currentTurn;
      await saveGame(g);
      for (const sid of g.sessionIds) {
        const s = liveSockets.get(sid);
        if (s) s.emit('turn', { playerIndex: g.currentTurn });
      }
      turnTimeouts.delete(game.id);
    }, 6000));
  });

  socket.on('hit-report', async ({ targetHit }) => {
    if (!socket.gameId || !targetHit) return;
    const game = await getGame(socket.gameId);
    if (!game || game.phase !== 'battle') return;

    if (turnTimeouts.has(game.id)) {
      clearTimeout(turnTimeouts.get(game.id));
      turnTimeouts.delete(game.id);
    }

    // Update HP
    const damagedPlayer = 1 - game.currentTurn;
    game.hp[damagedPlayer]--;

    if (game.hp[damagedPlayer] <= 0) {
      // Game over
      game.phase = 'over';
      await saveGame(game);
      for (const sid of game.sessionIds) {
        const s = liveSockets.get(sid);
        if (s) s.emit('game-over', { winner: game.currentTurn });
      }
      // Clean up after a delay
      setTimeout(async () => {
        await deleteGame(game.id);
        for (const sid of game.sessionIds) await clearPlayerGame(sid);
      }, 10000);
    } else {
      // Reposition phase
      game.phase = 'reposition';
      await saveGame(game);
      for (const sid of game.sessionIds) {
        const s = liveSockets.get(sid);
        if (s) s.emit('hit-confirmed', { damagedPlayer, hp: game.hp });
      }
    }
  });

  socket.on('reposition-complete', async ({ targetPos }) => {
    if (!socket.gameId) return;
    const game = await getGame(socket.gameId);
    if (!game || game.phase !== 'reposition') return;

    game.phase = 'battle';
    game.currentTurn = 1 - game.currentTurn; // damaged player's turn next
    await saveGame(game);

    for (const sid of game.sessionIds) {
      const s = liveSockets.get(sid);
      if (s) s.emit('reposition-done', { targetPos, nextTurn: game.currentTurn });
    }
  });

  // --- Disconnect with grace period ---

  socket.on('disconnect', async () => {
    liveSockets.delete(sessionId);

    // Remove from queue
    const qIdx = queue.findIndex(q => q.sessionId === sessionId);
    if (qIdx >= 0) queue.splice(qIdx, 1);

    if (!socket.gameId) return;

    const game = await getGame(socket.gameId);
    if (!game || game.phase === 'over') return;

    // Set grace period — opponent notified, game preserved
    const oppSessionId = game.sessionIds[1 - socket.playerIndex];
    const oppSocket = liveSockets.get(oppSessionId);
    if (oppSocket) oppSocket.emit('opponent-disconnected-temp');

    // After grace period, if still disconnected, forfeit
    const graceKey = `grace:${game.id}:${socket.playerIndex}`;
    await redis.set(graceKey, '1', 'EX', RECONNECT_GRACE);

    setTimeout(async () => {
      const stillGrace = await redis.get(graceKey);
      if (!stillGrace) return; // player reconnected, grace was cleared

      // Forfeit
      const g = await getGame(socket.gameId);
      if (!g || g.phase === 'over') return;

      g.phase = 'over';
      await saveGame(g);

      const opp = liveSockets.get(oppSessionId);
      if (opp) opp.emit('opponent-disconnected');

      setTimeout(async () => {
        await deleteGame(game.id);
        for (const sid of game.sessionIds) await clearPlayerGame(sid);
      }, 5000);
    }, RECONNECT_GRACE * 1000);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Cannonfall server listening on port ${PORT}`);
});
