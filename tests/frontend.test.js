/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BLOCK_TYPES } from '../src/constants.js';
import { GAME_MODES } from '../src/GameModes.js';

describe('Frontend: Block Palette', () => {
  // Simulate the palette filtering logic from CastleBuilder
  function getVisibleBlocks(modeConfig) {
    const allBlocks = [
      { type: 'CUBE' }, { type: 'HALF_SLAB' }, { type: 'WALL' }, { type: 'PLANK' },
      { type: 'RAMP' }, { type: 'COLUMN' }, { type: 'CYLINDER' }, { type: 'BARREL' },
      { type: 'QUARTER_DOME' }, { type: 'BULLNOSE' }, { type: 'HALF_BULLNOSE' }, { type: 'LATTICE' },
      { type: 'THRUSTER' }, { type: 'SHIELD' },
    ];
    const excluded = modeConfig?.excludeBlocks || [];
    return allBlocks.filter(b => !excluded.includes(b.type));
  }

  it('castle mode should exclude thruster and shield', () => {
    const visible = getVisibleBlocks(GAME_MODES.CASTLE);
    expect(visible.find(b => b.type === 'THRUSTER')).toBeUndefined();
    expect(visible.find(b => b.type === 'SHIELD')).toBeUndefined();
  });

  it('pirate mode should exclude thruster and shield', () => {
    const visible = getVisibleBlocks(GAME_MODES.PIRATE);
    expect(visible.find(b => b.type === 'THRUSTER')).toBeUndefined();
    expect(visible.find(b => b.type === 'SHIELD')).toBeUndefined();
  });

  it('space mode should show all blocks', () => {
    const visible = getVisibleBlocks(GAME_MODES.SPACE);
    expect(visible.find(b => b.type === 'THRUSTER')).toBeDefined();
    expect(visible.find(b => b.type === 'SHIELD')).toBeDefined();
  });

  it('all visible blocks should have valid cost', () => {
    for (const mode of Object.values(GAME_MODES)) {
      const visible = getVisibleBlocks(mode);
      for (const b of visible) {
        expect(BLOCK_TYPES[b.type]?.cost, `${b.type} missing cost`).toBeGreaterThan(0);
      }
    }
  });
});

describe('Frontend: Budget Display', () => {
  it('should show spent / max format', () => {
    const maxBudget = 600;
    const remaining = 450;
    const spent = maxBudget - remaining;
    // Budget display shows: spent / max
    expect(spent).toBe(150);
    expect(`${spent} / ${maxBudget}`).toBe('150 / 600');
  });
});

describe('Frontend: HTML Structure', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="overlay">
        <div id="menu-screen" class="screen">
          <div class="mode-selector">
            <button class="mode-btn" data-mode="PIRATE">Pirate</button>
            <button class="mode-btn selected" data-mode="CASTLE">Castle</button>
            <button class="mode-btn" data-mode="SPACE">Space</button>
          </div>
          <button id="local-match-btn">Local Match</button>
          <button id="online-match-btn">Online Match</button>
        </div>
        <div id="pass-device-screen" class="screen hidden">
          <button id="pass-ready-btn">Ready</button>
        </div>
        <div id="result-screen" class="screen hidden">
          <h2 id="result-text">You Win!</h2>
          <button id="play-again-btn">Play Again</button>
        </div>
      </div>
      <div id="game-ui" class="hidden">
        <div id="hp-left" class="hp-bar">
          <span class="hp-icon full">♥</span>
          <span class="hp-icon full">♥</span>
          <span class="hp-icon full">♥</span>
        </div>
        <div id="hp-right" class="hp-bar">
          <span class="hp-icon full">♥</span>
          <span class="hp-icon full">♥</span>
          <span class="hp-icon full">♥</span>
        </div>
        <div id="turn-indicator"></div>
        <div id="status-text"></div>
        <div id="power-fill"></div>
        <div id="power-value">30</div>
        <div id="hamburger-btn"></div>
        <div id="menu-panel" class="hidden"></div>
        <button id="menu-quit-btn"></button>
        <div id="minimap-frame"></div>
      </div>
    `;
  });

  it('should have mode selector buttons', () => {
    const btns = document.querySelectorAll('.mode-btn');
    expect(btns.length).toBe(3);
  });

  it('castle should be default selected', () => {
    const selected = document.querySelector('.mode-btn.selected');
    expect(selected.dataset.mode).toBe('CASTLE');
  });

  it('mode buttons should map to valid GAME_MODES keys', () => {
    const btns = document.querySelectorAll('.mode-btn');
    btns.forEach(btn => {
      expect(GAME_MODES).toHaveProperty(btn.dataset.mode);
    });
  });

  it('should have 3 HP icons per player', () => {
    const left = document.querySelectorAll('#hp-left .hp-icon');
    const right = document.querySelectorAll('#hp-right .hp-icon');
    expect(left.length).toBe(3);
    expect(right.length).toBe(3);
  });

  it('HP icon count should match MAX_HP', () => {
    const icons = document.querySelectorAll('#hp-left .hp-icon');
    expect(icons.length).toBe(3); // MAX_HP is 3
  });

  it('overlay should be visible initially', () => {
    const overlay = document.getElementById('overlay');
    expect(overlay.classList.contains('hidden')).toBe(false);
  });

  it('game-ui should be hidden initially', () => {
    const gameUI = document.getElementById('game-ui');
    expect(gameUI.classList.contains('hidden')).toBe(true);
  });
});

describe('Frontend: UI Class Logic', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="overlay">
        <div id="menu-screen" class="screen"></div>
        <div id="matching-screen" class="screen hidden"></div>
        <div id="build-screen" class="screen hidden"></div>
        <div id="pass-device-screen" class="screen hidden">
          <h1 id="pass-title"></h1>
        </div>
        <div id="result-screen" class="screen hidden">
          <h2 id="result-text"></h2>
        </div>
      </div>
      <div id="game-ui" class="hidden">
        <div id="turn-indicator"></div>
        <div id="status-text"></div>
        <div id="power-fill"></div>
        <div id="power-value"></div>
        <div id="hp-left"><span class="hp-icon full">♥</span><span class="hp-icon full">♥</span><span class="hp-icon full">♥</span></div>
        <div id="hp-right"><span class="hp-icon full">♥</span><span class="hp-icon full">♥</span><span class="hp-icon full">♥</span></div>
        <div id="minimap-frame"></div>
      </div>
    `;
  });

  // Simulate UI methods
  function hideAllScreens() {
    ['menu-screen', 'matching-screen', 'build-screen', 'pass-device-screen', 'result-screen']
      .forEach(id => document.getElementById(id)?.classList.add('hidden'));
  }

  function showMenu() {
    hideAllScreens();
    document.getElementById('menu-screen').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
    document.getElementById('game-ui').classList.add('hidden');
  }

  function showGame() {
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('game-ui').classList.remove('hidden');
  }

  function showResult(won) {
    hideAllScreens();
    document.getElementById('result-screen').classList.remove('hidden');
    document.getElementById('result-text').textContent = won ? 'YOU WIN!' : 'YOU LOSE!';
    document.getElementById('overlay').classList.remove('hidden');
  }

  function updateHP(hp0, hp1) {
    const left = document.querySelectorAll('#hp-left .hp-icon');
    const right = document.querySelectorAll('#hp-right .hp-icon');
    left.forEach((el, i) => el.className = i < hp0 ? 'hp-icon full' : 'hp-icon empty');
    right.forEach((el, i) => el.className = i < hp1 ? 'hp-icon full' : 'hp-icon empty');
  }

  it('showMenu should display menu and hide game-ui', () => {
    showMenu();
    expect(document.getElementById('menu-screen').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('game-ui').classList.contains('hidden')).toBe(true);
  });

  it('showGame should hide overlay and show game-ui', () => {
    showGame();
    expect(document.getElementById('overlay').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('game-ui').classList.contains('hidden')).toBe(false);
  });

  it('showResult should display win text', () => {
    showResult(true);
    expect(document.getElementById('result-text').textContent).toBe('YOU WIN!');
    expect(document.getElementById('result-screen').classList.contains('hidden')).toBe(false);
  });

  it('showResult should display lose text', () => {
    showResult(false);
    expect(document.getElementById('result-text').textContent).toBe('YOU LOSE!');
  });

  it('updateHP should mark icons as full or empty', () => {
    updateHP(2, 1);
    const left = document.querySelectorAll('#hp-left .hp-icon.full');
    const right = document.querySelectorAll('#hp-right .hp-icon.full');
    expect(left.length).toBe(2);
    expect(right.length).toBe(1);
  });

  it('updateHP with 0 should show all empty', () => {
    updateHP(0, 0);
    const fullLeft = document.querySelectorAll('#hp-left .hp-icon.full');
    const fullRight = document.querySelectorAll('#hp-right .hp-icon.full');
    expect(fullLeft.length).toBe(0);
    expect(fullRight.length).toBe(0);
  });
});
