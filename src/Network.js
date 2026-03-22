import { io } from 'socket.io-client';

const EVENTS = [
  'matched',
  'build-complete',
  'opponent-fired',
  'turn',
  'hit',
  'game-over',
  'opponent-disconnected',
];

export class Network {
  constructor() {
    this.socket = null;
    this.handlers = {};
  }

  connect() {
    return new Promise((resolve) => {
      this.socket = io();

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

  on(event, callback) {
    this.handlers[event] = callback;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}
