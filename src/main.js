import './styles.css';
import { Game } from './Game.js';

const canvas = document.getElementById('game-canvas');
const game = new Game(canvas);

function animate() {
  requestAnimationFrame(animate);
  game.update();
}

animate();
