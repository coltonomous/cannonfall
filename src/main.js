import './styles.css';
import { Game } from './Game.js';

const canvas = document.getElementById('game-canvas');
const game = new Game(canvas);
window.game = game; // expose for debugging

function animate() {
  requestAnimationFrame(animate);
  game.update();
}

animate();
