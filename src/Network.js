import { io } from 'socket.io-client';

const EVENTS = [
  'matched',
  'build-complete',
  'opponent-fired',
  'game-over',
  'opponent-disconnected',
  'opponent-disconnected-temp',
  'opponent-reconnected',
  'reconnected',
  'shot-resolved',
  'reposition-done',
  'server-shutdown',
  'lobby:list',
  'lobby:created',
  'lobby:error',
];

function getSessionId() {
  let id = sessionStorage.getItem('cannonfall-session');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('cannonfall-session', id);
  }
  return id;
}

export class Network {
  constructor() {
    this.socket = null;
    this.handlers = {};
    this.sessionId = getSessionId();
  }

  connect(timeoutMs = 5000) {
    // Reuse the socket from the reconnect check on page load instead of opening a second one
    if (this.socket?.connected) return Promise.resolve(this.socket.id);
    this.disconnect();
    return new Promise((resolve, reject) => {
      this.socket = io({
        auth: { sessionId: this.sessionId },
      });

      const timer = setTimeout(() => {
        this.socket.disconnect();
        this.socket = null;
        reject(new Error('Connection timed out'));
      }, timeoutMs);

      this.socket.on('connect', () => {
        clearTimeout(timer);
        resolve(this.socket.id);
      });

      this.socket.on('connect_error', (err) => {
        clearTimeout(timer);
        this.socket.disconnect();
        this.socket = null;
        reject(err);
      });

      // Connection loss / reconnect (fires after initial connect too)
      this.socket.on('disconnect', () => {
        if (this.handlers['connection-lost']) this.handlers['connection-lost']();
      });
      this.socket.io.on('reconnect', () => {
        if (this.handlers['connection-restored']) this.handlers['connection-restored']();
      });

      for (const event of EVENTS) {
        this.socket.on(event, (data) => {
          if (this.handlers[event]) {
            this.handlers[event](data);
          }
        });
      }
    });
  }

  sendBuildReady(castleData) {
    this.socket.emit('build-ready', { castleData });
  }

  sendFire(yaw, pitch, power) {
    this.socket.emit('fire', { yaw, pitch, power });
  }

  sendShotResult(hit) {
    this.socket.emit('shot-result', { hit });
  }

  sendRepositionComplete(targetPos) {
    this.socket.emit('reposition-complete', { targetPos });
  }

  enterLobby() {
    this.socket.emit('lobby:enter');
  }

  leaveLobby() {
    if (this.socket) this.socket.emit('lobby:leave');
  }

  createLobby(name, gameMode, password) {
    this.socket.emit('lobby:create', { name, gameMode, password: password || null });
  }

  joinLobby(lobbyId, name, password) {
    this.socket.emit('lobby:join', { lobbyId, name, password: password || null });
  }

  cancelLobby() {
    this.socket.emit('lobby:cancel');
  }

  on(event, callback) {
    if (this.handlers[event]) {
      console.warn(`[Network] Overwriting handler for "${event}"`);
    }
    this.handlers[event] = callback;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
