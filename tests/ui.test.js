/**
 * @vitest-environment jsdom
 *
 * The real UI and BuilderUI classes on the real index.html markup.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { UI } from '../src/UI.js';
import { BuilderUI } from '../src/BuilderUI.js';
import { BLOCK_TYPES, MAX_HP } from '../src/constants.js';
import { GAME_MODES } from '../src/GameModes.js';
import { loadIndexHtml } from './helpers/dom.js';

const isHidden = (id) => document.getElementById(id).classList.contains('hidden');

let ui;
beforeEach(() => {
  loadIndexHtml();
  ui = new UI();
});

describe('index.html', () => {
  it('has a mode button for every game mode, with castle selected', () => {
    const buttons = [...document.querySelectorAll('.mode-btn')];
    expect(buttons.map(b => b.dataset.mode).sort()).toEqual(Object.keys(GAME_MODES).sort());
    expect(document.querySelector('.mode-btn.selected').dataset.mode).toBe('CASTLE');
  });

  it('shows one heart per hit point for each player', () => {
    expect(document.querySelectorAll('#hp-left .hp-icon')).toHaveLength(MAX_HP);
    expect(document.querySelectorAll('#hp-right .hp-icon')).toHaveLength(MAX_HP);
  });

  it('starts on the menu overlay with the game UI hidden', () => {
    expect(isHidden('overlay')).toBe(false);
    expect(isHidden('game-ui')).toBe(true);
  });
});

describe('UI', () => {
  it('switches between the menu and the game view', () => {
    ui.showGame();
    expect(isHidden('overlay')).toBe(true);
    expect(isHidden('game-ui')).toBe(false);

    ui.showMenu();
    expect(isHidden('menu-screen')).toBe(false);
    expect(isHidden('game-ui')).toBe(true);
  });

  it('shows the result, with an optional message', () => {
    ui.showResult(true);
    expect(isHidden('result-screen')).toBe(false);
    expect(ui.resultText.textContent).toBe('YOU WIN!');
    ui.showResult(false);
    expect(ui.resultText.textContent).toBe('YOU LOSE!');
    ui.showResult(true, 'Opponent left the game');
    expect(ui.resultText.textContent).toBe('Opponent left the game');
  });

  it('fills hearts to match hit points', () => {
    ui.updateHP(2, 0);
    expect(document.querySelectorAll('#hp-left .hp-icon.full')).toHaveLength(2);
    expect(document.querySelectorAll('#hp-right .hp-icon.full')).toHaveLength(0);
  });

  it('escapes host names in the lobby list', () => {
    ui.updateLobbyList([{ id: 'l1', hostName: '<img src=x onerror=alert(1)>', gameMode: 'castle', hasPassword: true }]);
    const row = document.querySelector('.lobby-row');
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('.lobby-host-name').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(row.querySelector('.lobby-lock')).not.toBeNull();
  });

  it('shows an empty-lobby message', () => {
    ui.updateLobbyList([]);
    expect(document.querySelector('.lobby-empty')).not.toBeNull();
  });

  it('shows a waiting screen with only that screen visible', () => {
    ui.showWaitingScreen('Waiting for opponent...');
    expect(isHidden('build-screen')).toBe(false);
    expect(isHidden('menu-screen')).toBe(true);
    expect(document.querySelector('#build-screen h2').textContent).toBe('Waiting for opponent...');
    expect(document.querySelector('#build-screen .spinner')).not.toBeNull();
  });
});

describe('BuilderUI palette', () => {
  function paletteTypes(modeConfig) {
    const builderUI = new BuilderUI(
      { maxBudget: modeConfig.budget, maxLayers: modeConfig.maxLayers, isTouch: false, modeConfig },
      new Proxy({}, { get: () => () => {} }),
    );
    builderUI.create(modeConfig.budget, 0);
    const types = [...document.querySelectorAll('#castle-builder-ui .block-btn[data-type]')].map(b => b.dataset.type);
    builderUI.destroy();
    return types;
  }

  it('offers every block type except the ones the mode excludes', () => {
    for (const mode of Object.values(GAME_MODES)) {
      const expected = Object.keys(BLOCK_TYPES).filter(t => !mode.excludeBlocks.includes(t));
      expect(paletteTypes(mode).sort(), mode.id).toEqual(expected.sort());
    }
  });
});
