import { BLOCK_TYPES } from './constants.js';

/**
 * Manages all DOM elements for the castle builder overlay.
 * Extracted from CastleBuilder to separate UI concerns from 3D scene logic.
 */
export class BuilderUI {
  /**
   * @param {object} config
   * @param {number} config.maxBudget
   * @param {number} config.maxLayers
   * @param {boolean} config.isTouch
   * @param {object|null} config.modeConfig
   * @param {object} callbacks
   * @param {function} callbacks.onBlockSelected - (type: string) => void
   * @param {function} callbacks.onTargetMode - () => void
   * @param {function} callbacks.onLayerUp - () => void
   * @param {function} callbacks.onLayerDown - () => void
   * @param {function} callbacks.onPresetLoad - (name: string) => void
   * @param {function} callbacks.onExport - () => void
   * @param {function} callbacks.onClear - () => void
   * @param {function} callbacks.onReady - () => void
   * @param {function} callbacks.onRotate - () => void
   * @param {function} callbacks.onRemoveToggle - () => void
   * @param {function} callbacks.onUndo - () => void
   */
  constructor(config, callbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.container = null;
  }

  create(currentBudget, currentLayer) {
    this.destroy();

    const { maxBudget, maxLayers, isTouch, modeConfig } = this.config;
    const spent = maxBudget - currentBudget;

    const container = document.createElement('div');
    container.id = 'castle-builder-ui';
    container.className = 'builder-overlay';
    container.innerHTML = this._buildHTML(spent, maxBudget, currentLayer, maxLayers, isTouch, modeConfig);
    document.body.appendChild(container);
    this.container = container;

    this._wireEvents();
  }

  destroy() {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }

  updateBudget(spent) {
    const el = document.getElementById('builder-budget');
    if (el) el.textContent = spent;
  }

  updateLayer(layer) {
    const el = document.getElementById('builder-layer');
    if (el) el.textContent = layer + 1;
  }

  updateUndoState(canUndo) {
    const btn = document.getElementById('builder-undo-btn');
    if (btn) btn.disabled = !canUndo;
  }

  setRemoveMode(enabled) {
    const btn = document.getElementById('builder-remove-btn');
    if (btn) {
      btn.classList.toggle('active', enabled);
    }
  }

  selectBlockType(type) {
    if (!this.container) return;
    const allBtns = this.container.querySelectorAll('.block-btn[data-type]');
    const targetBtn = document.getElementById('builder-target-btn');

    allBtns.forEach(b => b.classList.remove('selected'));
    if (targetBtn) targetBtn.classList.remove('selected');

    if (type === '_target') {
      if (targetBtn) targetBtn.classList.add('selected');
    } else {
      const match = this.container.querySelector(`.block-btn[data-type="${type}"]`);
      if (match) match.classList.add('selected');
    }
  }

  setShareFeedback(text, resetText, resetDelay) {
    const btn = document.getElementById('builder-export-btn');
    if (!btn) return;
    btn.textContent = text;
    if (resetText) {
      setTimeout(() => { btn.textContent = resetText; }, resetDelay || 1500);
    }
  }

  // ── Private ────────────────────────────────────────────

  _buildHTML(spent, maxBudget, currentLayer, maxLayers, isTouch, modeConfig) {
    const blockButtons = this._buildBlockPalette(modeConfig);
    const presetOptions = (modeConfig?.presets || ['KEEP', 'BUNKER', 'TOWER'])
      .map(p => `<option value="${p}">${p.charAt(0) + p.slice(1).toLowerCase()}</option>`)
      .join('');

    return `
      <div class="builder-left">
        <h3 class="builder-section-title">Blocks</h3>
        <div class="block-palette">
          ${blockButtons}
        </div>
        <button class="block-btn target-btn" id="builder-target-btn">
          <span class="block-icon target-icon">&#9679;</span>
          <span>Target</span>
        </button>
        ${isTouch ? '' : `
          <div class="builder-info">
            <p>R/T/F: Rotate Y/X/Z</p>
            <p>Click: Place</p>
            <p>Right-click: Remove</p>
            <p>Shift+click: Grab block</p>
            <p>Ctrl+Z: Undo</p>
            <p>Mouse drag: Orbit</p>
            <p>Scroll: Zoom</p>
          </div>
        `}
      </div>
      <div class="builder-top">
        <div class="budget-display">
          <span id="builder-budget">${spent}</span>
          <span> / ${maxBudget}</span>
        </div>
        <div class="layer-display">
          Layer: <span id="builder-layer">${currentLayer + 1}</span> / ${maxLayers}
          <button id="builder-layer-up" class="layer-btn">&#9650;</button>
          <button id="builder-layer-down" class="layer-btn">&#9660;</button>
        </div>
      </div>
      <div class="builder-bottom">
        <div class="builder-row">
          <select id="builder-preset-select" class="builder-select">
            <option value="">Load preset...</option>
            ${presetOptions}
          </select>
          <button id="builder-export-btn" class="builder-btn builder-btn-share">Share</button>
          <button id="builder-clear-btn" class="builder-btn builder-btn-danger">Clear</button>
        </div>
        ${isTouch ? `
          <div class="builder-row">
            <button id="builder-rotate-btn" class="builder-action-btn">&#x21BB; Rotate</button>
            <button id="builder-remove-btn" class="builder-action-btn">&#x2716; Remove</button>
            <button id="builder-undo-btn" class="builder-action-btn" disabled>&#x21A9; Undo</button>
          </div>
        ` : `
          <div class="builder-row">
            <button id="builder-undo-btn" class="builder-action-btn" disabled>&#x21A9; Undo</button>
          </div>
        `}
        <button id="builder-ready-btn" class="builder-btn builder-btn-ready">Ready</button>
      </div>
    `;
  }

  _buildBlockPalette(modeConfig) {
    const blocks = [
      { type: '_label', label: 'Basic' },
      { type: 'CUBE', icon: '■', label: 'Cube' },
      { type: 'HALF_SLAB', icon: '▬', label: 'Slab' },
      { type: 'WALL', icon: '▮', label: 'Wall' },
      { type: 'PLANK', icon: '═', label: 'Plank' },
      { type: '_label', label: 'Shapes' },
      { type: 'RAMP', icon: '◢', label: 'Ramp' },
      { type: 'COLUMN', icon: '╽', label: 'Column' },
      { type: 'CYLINDER', icon: '◯', label: 'Cylinder' },
      { type: 'BARREL', icon: '•', label: 'Barrel' },
      { type: '_label', label: 'Decorative' },
      { type: 'QUARTER_DOME', icon: '◠', label: 'Qtr Dome' },
      { type: 'BULLNOSE', icon: '⬬', label: 'Bullnose' },
      { type: 'HALF_BULLNOSE', icon: '⬭', label: '½ Bull' },
      { type: 'LATTICE', icon: '▦', label: 'Lattice' },
      { type: '_label', label: 'Special' },
      { type: 'THRUSTER', icon: '⊳', label: 'Thruster' },
      { type: 'SHIELD', icon: '◇', label: 'Shield' },
    ];

    const excluded = modeConfig?.excludeBlocks || [];

    return blocks.filter((b, i, arr) => {
      if (b.type === '_label') {
        for (let j = i + 1; j < arr.length && arr[j].type !== '_label'; j++) {
          if (!excluded.includes(arr[j].type)) return true;
        }
        return false;
      }
      return !excluded.includes(b.type);
    }).map((b, i) => {
      if (b.type === '_label') {
        return `<div class="block-label">${b.label}</div>`;
      }
      const isFirst = i === 1;
      return `<button class="block-btn${isFirst ? ' selected' : ''}" data-type="${b.type}">
        <span class="block-icon">${b.icon}</span>
        <span>${b.label} <small>(${BLOCK_TYPES[b.type]?.cost ?? ''})</small></span>
      </button>`;
    }).join('');
  }

  _wireEvents() {
    const container = this.container;
    if (!container) return;
    const cb = this.callbacks;

    // Block palette
    const allBlockBtns = container.querySelectorAll('.block-btn[data-type]');
    allBlockBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectBlockType(btn.dataset.type);
        cb.onBlockSelected(btn.dataset.type);
      });
    });

    // Default selection
    if (allBlockBtns[0]) this.selectBlockType(allBlockBtns[0].dataset.type);

    // Target button
    const targetBtn = document.getElementById('builder-target-btn');
    if (targetBtn) {
      targetBtn.addEventListener('click', () => {
        this.selectBlockType('_target');
        cb.onTargetMode();
      });
    }

    // Layer controls
    document.getElementById('builder-layer-up')?.addEventListener('click', () => cb.onLayerUp());
    document.getElementById('builder-layer-down')?.addEventListener('click', () => cb.onLayerDown());

    // Preset
    document.getElementById('builder-preset-select')?.addEventListener('change', (e) => {
      if (e.target.value) {
        cb.onPresetLoad(e.target.value);
        e.target.value = '';
      }
    });

    // Share
    document.getElementById('builder-export-btn')?.addEventListener('click', () => cb.onExport());

    // Clear
    document.getElementById('builder-clear-btn')?.addEventListener('click', () => cb.onClear());

    // Ready
    document.getElementById('builder-ready-btn')?.addEventListener('click', () => cb.onReady());

    // Touch-only buttons
    document.getElementById('builder-rotate-btn')?.addEventListener('click', () => cb.onRotate());
    document.getElementById('builder-remove-btn')?.addEventListener('click', () => cb.onRemoveToggle());
    document.getElementById('builder-undo-btn')?.addEventListener('click', () => cb.onUndo());
  }
}
