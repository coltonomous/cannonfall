import { io } from 'socket.io-client';

const EVENTS = [
  'matched',
  'build-complete',
  'opponent-fired',
  'turn',
  'game-over',
  'opponent-disconnected',
  'opponent-disconnected-temp',
  'opponent-reconnected',
  'reconnected',
  'hit-confirmed',
  'reposition-done',
];

function getSessionId() {
  let id = sessionStorage.getItem('cannonade-session');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('cannonade-session', id);
  }
  return id;
}

export class Network {
  constructor() {
    this.socket = null;
    this.handlers = {};
    this.sessionId = getSessionId();
  }

  connect() {
    return new Promise((resolve) => {
      this.socket = io({
        auth: { sessionId: this.sessionId },
      });

      this.socket.on('connect', () => {
        resolve(this.socket.id);
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

  joinQueue() {
    this.socket.emit('join-queue');
  }

  sendBuildReady(castleData) {
    this.socket.emit('build-ready', { castleData });
  }

  sendFire(yaw, pitch, power) {
    this.socket.emit('fire', { yaw, pitch, power });
  }

  sendHitReport() {
    this.socket.emit('hit-report', { targetHit: true });
  }

  sendRepositionComplete(targetPos) {
    this.socket.emit('reposition-complete', { targetPos });
  }

  on(event, callback) {
    this.handlers[event] = callback;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
