import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { randomUUID } from 'crypto';

const app = express();
const http = createServer(app);
const io = new Server(http, {
  cors: { origin: '*' },
});

// Serve static files from ./dist in production
app.use(express.static('dist'));

const queue = [];
const games = new Map();

function getPlayerIndex(game, socketId) {
  return game.players.indexOf(socketId);
}

io.on('connection', (socket) => {
  // --- Matchmaking ---

  socket.on('join-queue', () => {
    queue.push(socket);

    if (queue.length >= 2) {
      const socket1 = queue.shift();
      const socket2 = queue.shift();

      const gameId = randomUUID();
      const currentTurn = Math.random() < 0.5 ? 0 : 1;

      const game = {
        id: gameId,
        players: [socket1.id, socket2.id],
        sockets: [socket1, socket2],
        currentTurn,
        turnTimeout: null,
        phase: 'build',
        castles: [null, null],
      };

      games.set(gameId, game);
      socket1.gameId = gameId;
      socket2.gameId = gameId;

      socket1.emit('matched', { playerIndex: 0, firstTurn: currentTurn });
      socket2.emit('matched', { playerIndex: 1, firstTurn: currentTurn });
    }
  });

  // --- Build phase ---

  socket.on('build-ready', ({ castleData }) => {
    const game = games.get(socket.gameId);
    if (!game || game.phase !== 'build') return;

    const playerIndex = getPlayerIndex(game, socket.id);
    if (playerIndex === -1) return;

    game.castles[playerIndex] = castleData;

    if (game.castles[0] !== null && game.castles[1] !== null) {
      game.phase = 'battle';
      for (const s of game.sockets) {
        s.emit('build-complete', { castles: [game.castles[0], game.castles[1]] });
      }
    }
  });

  // --- Battle phase ---

  socket.on('fire', ({ yaw, pitch, power }) => {
    const game = games.get(socket.gameId);
    if (!game || game.phase !== 'battle') return;

    const playerIndex = getPlayerIndex(game, socket.id);
    if (playerIndex === -1 || playerIndex !== game.currentTurn) return;

    // Relay shot to opponent
    const opponentIndex = 1 - playerIndex;
    game.sockets[opponentIndex].emit('opponent-fired', { yaw, pitch, power });

    // Turn timeout — auto-advance turn after 6 seconds
    if (game.turnTimeout) clearTimeout(game.turnTimeout);

    game.turnTimeout = setTimeout(() => {
      game.currentTurn = 1 - game.currentTurn;
      for (const s of game.sockets) {
        s.emit('turn', { playerIndex: game.currentTurn });
      }
    }, 6000);
  });

  socket.on('hit-report', ({ targetHit }) => {
    const game = games.get(socket.gameId);
    if (!game || game.phase !== 'battle') return;

    if (!targetHit) return;

    if (game.turnTimeout) clearTimeout(game.turnTimeout);

    // The current-turn player is the one who fired, so they win
    const winner = game.currentTurn;

    for (const s of game.sockets) {
      s.emit('game-over', { winner });
    }

    games.delete(game.id);
  });

  // --- Disconnect ---

  socket.on('disconnect', () => {
    // Remove from queue if present
    const queueIndex = queue.indexOf(socket);
    if (queueIndex !== -1) {
      queue.splice(queueIndex, 1);
    }

    // Handle active game
    const gameId = socket.gameId;
    if (gameId && games.has(gameId)) {
      const game = games.get(gameId);

      if (game.turnTimeout) clearTimeout(game.turnTimeout);

      const playerIndex = getPlayerIndex(game, socket.id);
      const opponentIndex = 1 - playerIndex;
      const opponent = game.sockets[opponentIndex];

      if (opponent) {
        opponent.emit('opponent-disconnected');
      }

      games.delete(gameId);
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Cannonade server listening on port ${PORT}`);
});
