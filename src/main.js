import './styles.css';
import { Game } from './Game.js';

// The service worker caches assets, which only gets in the way of the dev server
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const canvas = document.getElementById('game-canvas');
const game = new Game(canvas);
window.game = game; // expose for debugging

const versionTag = document.getElementById('version-tag');
if (versionTag) versionTag.textContent = `v${__BUILD_NUMBER__}`;

function animate() {
  requestAnimationFrame(animate);
  game.update();
}

animate();
