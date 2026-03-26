import * as THREE from 'three';
import { BLOCK_SIZE, BUILD_BUDGET, BLOCK_TYPES } from './constants.js';
import { getPreset } from './Presets.js';
import { createAllBlockGeometries } from './BlockGeometry.js';
import { OrbitController } from './OrbitController.js';
import { encode as encodeDesign } from './DesignCodec.js';

export class CastleBuilder {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.scene = sceneManager.scene;
    this.camera = sceneManager.camera;
    this.renderer = sceneManager.renderer;

    // State
    this.layout = []; // [{ x, y, z, type, rotation }]
    this.targetPos = { x: 4, y: 0, z: 4 }; // grid coords
    this.selectedType = 'CUBE';
    this.selectedRotation = 0;  // Y-axis (0-3, 90° steps)
    this.selectedRotX = 0;      // X-axis
    this.selectedRotZ = 0;      // Z-axis
    this.currentLayer = 0; // layer above floor (0-4)
    this.budget = BUILD_BUDGET;
    this.placingTarget = false; // true when in target placement mode

    // 3D objects
    this.gridGroup = new THREE.Group();
    this.blockMeshes = []; // { mesh, block } for placed blocks
    this.ghostMesh = null;
    this.targetMesh = null;
    this.floorMeshes = [];
    this._geometries = null; // cached block geometries

    // Orbit camera + raycasting (shared controller)
    this.orbit = new OrbitController(sceneManager);
    this.orbit.onMouseMove = (e) => this._handleHover(e);
    this.gridPlane = null; // invisible plane for raycasting at current layer

    // Bound event handlers (for cleanup)
    this._onClick = this._handleClick.bind(this);
    this._onContextMenu = this._handleContextMenu.bind(this);
    this._onKeyDown = this._handleKeyDown.bind(this);

    // Touch state
    this._onTouchStart = this._handleTouchStart.bind(this);
    this._onTouchMove = this._handleTouchMove.bind(this);
    this._onTouchEnd = this._handleTouchEnd.bind(this);
    this._touchMode = null; // 'build' | 'orbit' | null
    this._touchGridPos = null;
    this._removeMode = false;
    this._undoStack = []; // layout snapshots for undo
    this._maxUndoSteps = 20;
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  // === LIFECYCLE ===

  start(onReady, modeConfig) {
    this.onReady = onReady;
    this.modeConfig = modeConfig || null;
    this.maxBudget = modeConfig?.budget || BUILD_BUDGET;
    this.maxLayers = modeConfig?.maxLayers || 5;
    this.gridW = modeConfig?.gridWidth || 9;
    this.gridD = modeConfig?.gridDepth || 9;
    this.layout = [];
    this.targetPos = { x: Math.floor(this.gridW / 2), y: 0, z: Math.floor(this.gridD / 2) };
    this.selectedType = 'CUBE';
    this.selectedRotation = 0;
    this.selectedRotX = 0;
    this.selectedRotZ = 0;
    this.currentLayer = 0;
    this.budget = this.maxBudget;
    this.placingTarget = false;
    this.customFloor = null;

    this._geometries = createAllBlockGeometries();
    this.setupScene();
    this.setupEventListeners();
    this.orbit.updateCamera();
    this.createBuildUI();
    this.rebuildMeshes();
  }

  stop() {
    this.removeEventListeners();
    this.clearScene();
    this.removeBuildUI();
  }

  // === SCENE SETUP ===

  setupScene() {
    this.scene.add(this.gridGroup);

    const halfW = Math.floor(this.gridW / 2);
    const halfD = Math.floor(this.gridD / 2);

    // Grid lines — rectangular support via EdgesGeometry on a flat box
    const gridOutline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(this.gridW, 0.01, this.gridD)),
      new THREE.LineBasicMaterial({ color: 0x555555 })
    );
    gridOutline.position.y = 0;
    this.gridGroup.add(gridOutline);

    // Internal grid lines
    const gridLines = new THREE.BufferGeometry();
    const pts = [];
    for (let x = -halfW; x <= halfW; x++) {
      pts.push(x, 0.01, -halfD, x, 0.01, halfD);
    }
    for (let z = -halfD; z <= halfD; z++) {
      pts.push(-halfW, 0.01, z, halfW, 0.01, z);
    }
    gridLines.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const gridMesh = new THREE.LineSegments(gridLines, new THREE.LineBasicMaterial({ color: 0x444444 }));
    this.gridGroup.add(gridMesh);

    // Layer indicator
    this.layerGrid = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(this.gridW, 0.01, this.gridD)),
      new THREE.LineBasicMaterial({ color: 0x664400, transparent: true, opacity: 0.3 })
    );
    this.layerGrid.position.y = 0;
    this.gridGroup.add(this.layerGrid);

    // Invisible plane for raycasting at current layer
    this.gridPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(this.gridW * 2, this.gridD * 2),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.gridPlane.rotation.x = -Math.PI / 2;
    this.gridPlane.position.y = this.currentLayer * BLOCK_SIZE;
    this.gridGroup.add(this.gridPlane);

    // Ghost preview block (uses shared geometry from _geometries)
    const ghostMat = new THREE.MeshStandardMaterial({
      color: 0x44aaff,
      transparent: true,
      opacity: 0.4,
    });
    this.ghostMesh = new THREE.Mesh(this._geometries.CUBE, ghostMat);
    this.ghostMesh.visible = false;
    this.gridGroup.add(this.ghostMesh);

    // Target sphere
    const targetGeo = new THREE.SphereGeometry(0.4, 16, 16);
    const targetMat = new THREE.MeshStandardMaterial({
      color: 0xff4444,
      emissive: 0xff0000,
      emissiveIntensity: 0.5,
    });
    this.targetMesh = new THREE.Mesh(targetGeo, targetMat);
    this.updateTargetMesh();
    this.gridGroup.add(this.targetMesh);
  }

  clearScene() {
    // Dispose block mesh materials (geometries are shared via _geometries)
    for (const { mesh } of this.blockMeshes) {
      mesh.material?.dispose();
    }
    // Dispose shared block geometries
    if (this._geometries) {
      for (const geo of Object.values(this._geometries)) {
        geo.dispose();
      }
      this._geometries = null;
    }
    // Dispose gridGroup children (grid lines, layer indicator, gridPlane, ghost, target)
    this.gridGroup.traverse(obj => {
      obj.geometry?.dispose();
      obj.material?.dispose();
    });
    this.gridGroup.parent?.remove(this.gridGroup);
    this.blockMeshes = [];
    this.floorMeshes = [];
    this.ghostMesh = null;
    this.targetMesh = null;
    this.gridGroup = new THREE.Group();
  }

  // === BUILD UI (HTML overlay) ===

  createBuildUI() {
    // Remove existing
    this.removeBuildUI();

    const container = document.createElement('div');
    container.id = 'castle-builder-ui';
    container.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 20;
      pointer-events: none;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      color: #fff;
    `;
    container.innerHTML = `
      <div class="builder-left" style="
        position: absolute;
        left: 16px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: auto;
      ">
        <h3 style="margin: 0 0 4px 0; font-size: 0.9rem; opacity: 0.7; text-transform: uppercase; letter-spacing: 1px;">Blocks</h3>
        <div class="block-palette" style="display: flex; flex-direction: column; gap: 2px;">
          ${[
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
          ].filter((b, i, arr) => {
            if (b.type === '_label') {
              // Hide label if all following blocks (until next label) are excluded
              const excluded = this.modeConfig?.excludeBlocks || [];
              for (let j = i + 1; j < arr.length && arr[j].type !== '_label'; j++) {
                if (!excluded.includes(arr[j].type)) return true;
              }
              return false;
            }
            return !(this.modeConfig?.excludeBlocks || []).includes(b.type);
          })
          .map((b, i) => {
            if (b.type === '_label') {
              return `<div style="font-size:0.65rem; opacity:0.4; text-transform:uppercase; letter-spacing:1px; margin:4px 0 1px 2px;">${b.label}</div>`;
            }
            const isFirst = i === 1; // first actual block (after first label)
            return `<button class="block-btn${isFirst ? ' selected' : ''}" data-type="${b.type}" style="
              display: flex; align-items: center; gap: 6px;
              padding: 6px 10px; border: 2px solid rgba(255,255,255,0.15);
              border-radius: 6px; background: rgba(255,255,255,${isFirst ? '0.1' : '0.06'});
              color: #fff; cursor: pointer; font-size: 0.8rem;
              transition: background 0.15s, border-color 0.15s;
              pointer-events: auto; min-width: 0;
            ">
              <span style="font-size: 1rem;">${b.icon}</span>
              <span>${b.label} <small>(${BLOCK_TYPES[b.type]?.cost ?? ''})</small></span>
            </button>`;
          }).join('')}
        </div>
        <button class="block-btn target-btn" id="builder-target-btn" style="
          display: flex; align-items: center; gap: 8px;
          padding: 8px 14px; border: 2px solid rgba(255,255,255,0.15);
          border-radius: 6px; background: rgba(255,255,255,0.06);
          color: #fff; cursor: pointer; font-size: 0.9rem;
          margin-top: 4px;
          transition: background 0.15s, border-color 0.15s;
          pointer-events: auto;
        ">
          <span style="font-size: 1.2rem; color: #ff4444;">&#9679;</span>
          <span>Target</span>
        </button>
        ${this.isTouch ? `
          <div class="builder-actions" style="
            position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
            display: flex; flex-direction: column; gap: 6px;
            pointer-events: auto;
          ">
            <button id="builder-rotate-btn" class="builder-action-btn" style="
              display: flex; align-items: center; gap: 6px;
              padding: 8px 12px; border: 2px solid rgba(255,255,255,0.15);
              border-radius: 8px; background: rgba(0,0,0,0.5);
              color: #fff; cursor: pointer; font-size: 0.8rem;
              pointer-events: auto;
            "><span style="font-size: 1.1rem;">&#x21BB;</span> Rotate</button>
            <button id="builder-remove-btn" class="builder-action-btn" style="
              display: flex; align-items: center; gap: 6px;
              padding: 8px 12px; border: 2px solid rgba(255,255,255,0.15);
              border-radius: 8px; background: rgba(0,0,0,0.5);
              color: #fff; cursor: pointer; font-size: 0.8rem;
              pointer-events: auto;
            "><span style="font-size: 1.1rem;">&#x2716;</span> Remove</button>
            <button id="builder-undo-btn" class="builder-action-btn" disabled style="
              display: flex; align-items: center; gap: 6px;
              padding: 8px 12px; border: 2px solid rgba(255,255,255,0.15);
              border-radius: 8px; background: rgba(0,0,0,0.5);
              color: #fff; cursor: pointer; font-size: 0.8rem;
              pointer-events: auto;
            "><span style="font-size: 1.1rem;">&#x21A9;</span> Undo</button>
          </div>
        ` : `
          <button id="builder-undo-btn" disabled style="
            display: flex; align-items: center; gap: 6px;
            padding: 6px 10px; border: 2px solid rgba(255,255,255,0.15);
            border-radius: 6px; background: rgba(255,255,255,0.06);
            color: #fff; cursor: pointer; font-size: 0.8rem;
            margin-top: 4px; pointer-events: auto;
          "><span style="font-size: 1rem;">&#x21A9;</span> Undo</button>
          <div class="builder-info" style="
            margin-top: 8px; font-size: 0.75rem; opacity: 0.5; line-height: 1.6;
          ">
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
      <div class="builder-top" style="
        position: absolute;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 24px;
        align-items: center;
        padding: 10px 24px;
        border-radius: 20px;
        background: rgba(0,0,0,0.6);
        pointer-events: auto;
      ">
        <div class="budget-display" style="font-size: 1rem; font-weight: 700;">
          <span id="builder-budget">${this.maxBudget - this.budget}</span>
          <span> / ${this.maxBudget}</span>
        </div>
        <div class="layer-display" style="display: flex; align-items: center; gap: 8px; font-size: 1rem; font-weight: 700;">
          Layer: <span id="builder-layer">${this.currentLayer + 1}</span> / ${this.maxLayers}
          <button id="builder-layer-up" style="
            padding: 4px 10px; border: none; border-radius: 4px;
            background: rgba(255,255,255,0.15); color: #fff;
            cursor: pointer; font-size: 0.85rem;
            pointer-events: auto;
          ">&#9650;</button>
          <button id="builder-layer-down" style="
            padding: 4px 10px; border: none; border-radius: 4px;
            background: rgba(255,255,255,0.15); color: #fff;
            cursor: pointer; font-size: 0.85rem;
            pointer-events: auto;
          ">&#9660;</button>
        </div>
      </div>
      <div class="builder-bottom" style="
        position: absolute;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 16px;
        align-items: center;
        pointer-events: auto;
      ">
        <div class="preset-load">
          <select id="builder-preset-select" style="
            padding: 10px 16px; border: 2px solid rgba(255,255,255,0.15);
            border-radius: 8px; background: rgba(0,0,0,0.6);
            color: #fff; cursor: pointer; font-size: 0.95rem;
            pointer-events: auto;
          ">
            <option value="">Load preset...</option>
            ${(this.modeConfig?.presets || ['KEEP', 'BUNKER', 'TOWER']).map(
              p => `<option value="${p}">${p.charAt(0) + p.slice(1).toLowerCase()}</option>`
            ).join('')}
          </select>
        </div>
        <button id="builder-export-btn" style="
          padding: 10px 20px; font-size: 0.9rem; font-weight: 600;
          border: none; border-radius: 8px; cursor: pointer;
          background: rgba(52, 152, 219, 0.8); color: #fff;
          transition: background 0.2s;
          pointer-events: auto;
        ">Share</button>
        <button id="builder-clear-btn" style="
          padding: 10px 20px; font-size: 0.9rem; font-weight: 600;
          border: none; border-radius: 8px; cursor: pointer;
          background: rgba(192, 57, 43, 0.8); color: #fff;
          transition: background 0.2s;
          pointer-events: auto;
        ">Clear All</button>
        <button id="builder-ready-btn" style="
          padding: 14px 40px; font-size: 1.15rem; font-weight: 700;
          border: none; border-radius: 8px; cursor: pointer;
          background: #27ae60; color: #fff;
          transition: background 0.2s, transform 0.1s;
          pointer-events: auto;
        ">Ready</button>
      </div>
    `;
    document.body.appendChild(container);

    // Wire up block palette buttons
    const allBlockBtns = container.querySelectorAll('.block-btn[data-type]');
    const targetBtn = document.getElementById('builder-target-btn');

    const clearSelection = () => {
      allBlockBtns.forEach(b => {
        b.style.background = 'rgba(255,255,255,0.06)';
        b.style.borderColor = 'rgba(255,255,255,0.15)';
      });
      targetBtn.style.background = 'rgba(255,255,255,0.06)';
      targetBtn.style.borderColor = 'rgba(255,255,255,0.15)';
    };

    const selectBtn = (btn) => {
      clearSelection();
      btn.style.background = 'rgba(255,255,255,0.2)';
      btn.style.borderColor = '#e67e22';
    };

    allBlockBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        selectBtn(btn);
        this.selectedType = btn.dataset.type;
        this.placingTarget = false;
        this.updateGhostGeometry();
      });
    });

    // Select CUBE by default
    selectBtn(allBlockBtns[0]);

    targetBtn.addEventListener('click', () => {
      selectBtn(targetBtn);
      this.placingTarget = true;
    });

    document.getElementById('builder-layer-up').addEventListener('click', () => {
      this.setLayer(Math.min(this.maxLayers - 1, this.currentLayer + 1));
    });
    document.getElementById('builder-layer-down').addEventListener('click', () => {
      this.setLayer(Math.max(0, this.currentLayer - 1));
    });

    document.getElementById('builder-preset-select').addEventListener('change', (e) => {
      if (e.target.value) {
        this.loadPreset(e.target.value);
        e.target.value = '';
      }
    });

    document.getElementById('builder-export-btn').addEventListener('click', () => {
      const data = {
        layout: this.layout,
        target: this.targetPos,
        cannonPos: { x: this.gridW - 1, z: Math.floor(this.gridD / 2) },
        floor: this.customFloor || [],
      };
      const modeId = this.modeConfig?.id || 'castle';
      const hash = encodeDesign(data, modeId);
      const url = `${window.location.origin}${window.location.pathname}#${hash}`;
      navigator.clipboard.writeText(url).then(
        () => {
          const btn = document.getElementById('builder-export-btn');
          btn.textContent = 'Link Copied!';
          setTimeout(() => { btn.textContent = 'Share'; }, 1500);
        },
        () => { /* fallback: log to console */ console.log(url); }
      );
    });

    document.getElementById('builder-clear-btn').addEventListener('click', () => {
      this._pushUndo();
      this.layout = [];
      this.budget = this.maxBudget;
      this.customFloor = null;
      this.targetPos = { x: Math.floor(this.gridW / 2), y: 0, z: Math.floor(this.gridD / 2) };
      this.updateBudgetDisplay();
      this.updateTargetMesh();
      this.rebuildMeshes();
    });

    document.getElementById('builder-ready-btn').addEventListener('click', () => {
      if (this.onReady) {
        this.onReady({
          layout: [...this.layout],
          target: { ...this.targetPos },
          cannonPos: { x: this.gridW - 1, z: Math.floor(this.gridD / 2) },
          floor: this.customFloor || null,
        });
      }
    });

    // Touch-only buttons
    const rotateBtn = document.getElementById('builder-rotate-btn');
    if (rotateBtn) {
      rotateBtn.addEventListener('click', () => {
        this.selectedRotation = (this.selectedRotation + 1) % 4;
        if (this.ghostMesh) this._applySelectedRotation(this.ghostMesh);
      });
    }
    const removeBtn = document.getElementById('builder-remove-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        this._setRemoveMode(!this._removeMode);
      });
    }
    // Undo button (both touch and desktop)
    const undoBtn = document.getElementById('builder-undo-btn');
    if (undoBtn) {
      undoBtn.addEventListener('click', () => this.undo());
    }
  }

  removeBuildUI() {
    const el = document.getElementById('castle-builder-ui');
    if (el) el.remove();
  }

  updateBudgetDisplay() {
    const el = document.getElementById('builder-budget');
    if (el) el.textContent = this.maxBudget - this.budget;
  }

  // === LAYER MANAGEMENT ===

  setLayer(layer) {
    this.currentLayer = layer;
    this.layerGrid.position.y = layer * BLOCK_SIZE;
    this.gridPlane.position.y = layer * BLOCK_SIZE;
    const el = document.getElementById('builder-layer');
    if (el) el.textContent = layer + 1;
    // Rebuild meshes to update transparency for current layer
    this.rebuildMeshes();
  }

  // === REMOVE MODE ===

  _setRemoveMode(enabled) {
    this._removeMode = enabled;
    const removeBtn = document.getElementById('builder-remove-btn');
    if (removeBtn) {
      removeBtn.style.background = enabled ? 'rgba(192,57,43,0.6)' : 'rgba(255,255,255,0.06)';
      removeBtn.style.borderColor = enabled ? '#e74c3c' : 'rgba(255,255,255,0.15)';
    }
    // Update ghost color to signal mode
    if (this.ghostMesh) {
      this.ghostMesh.material.color.set(enabled ? 0xff4444 : 0x44aaff);
      this.ghostMesh.material.opacity = enabled ? 0.3 : 0.4;
    }
  }

  // === UNDO ===

  _pushUndo() {
    this._undoStack.push({
      layout: this.layout.map(b => ({ ...b })),
      targetPos: { ...this.targetPos },
      budget: this.budget,
    });
    if (this._undoStack.length > this._maxUndoSteps) this._undoStack.shift();
    this._updateUndoBtn();
  }

  undo() {
    const snapshot = this._undoStack.pop();
    if (!snapshot) return;
    this.layout = snapshot.layout;
    this.targetPos = snapshot.targetPos;
    this.budget = snapshot.budget;
    this.updateBudgetDisplay();
    this.updateTargetMesh();
    this.rebuildMeshes();
    this._updateUndoBtn();
  }

  _updateUndoBtn() {
    const btn = document.getElementById('builder-undo-btn');
    if (btn) btn.disabled = this._undoStack.length === 0;
  }

  // === BLOCK PLACEMENT ===

  getGridPos(intersectPoint) {
    const halfW = Math.floor(this.gridW / 2);
    const halfD = Math.floor(this.gridD / 2);
    const gx = Math.round(intersectPoint.x / BLOCK_SIZE + halfW);
    const gz = Math.round(intersectPoint.z / BLOCK_SIZE + halfD);
    if (gx < 0 || gx >= this.gridW || gz < 0 || gz >= this.gridD) return null;
    return { x: gx, z: gz };
  }

  hasBlockAt(x, y, z) {
    return this.layout.some(b => b.x === x && b.y === y && b.z === z);
  }

  canPlace(x, y, z) {
    if (x < 0 || x >= this.gridW || z < 0 || z >= this.gridD) return false;
    if (y < 0 || y >= this.maxLayers) return false;
    if (this.hasBlockAt(x, y, z)) return false;
    // Can't place a block on the target — it must remain exposed
    if (x === this.targetPos.x && y === (this.targetPos.y || 0) && z === this.targetPos.z) return false;
    // Must be on floor (y=0) or on top of another block
    if (y === 0) return true;
    return this.hasBlockAt(x, y - 1, z);
  }

  placeBlock(x, y, z) {
    if (!this.canPlace(x, y, z)) return;
    const cost = BLOCK_TYPES[this.selectedType].cost;
    if (this.budget < cost) return;

    this._pushUndo();
    this.layout.push({
      x, y, z,
      type: this.selectedType,
      rotation: this.selectedRotation,
      rotX: this.selectedRotX || 0,
      rotZ: this.selectedRotZ || 0,
    });
    this.budget -= cost;
    this.updateBudgetDisplay();
    this.rebuildMeshes();
  }

  removeBlock(x, y, z) {
    const idx = this.layout.findIndex(b => b.x === x && b.y === y && b.z === z);
    if (idx === -1) return;

    this._pushUndo();
    // Also remove any blocks above this one (cascade)
    const toRemove = [idx];
    const checkAbove = (bx, by, bz) => {
      for (let i = 0; i < this.layout.length; i++) {
        if (toRemove.includes(i)) continue;
        if (this.layout[i].x === bx && this.layout[i].y === by + 1 && this.layout[i].z === bz) {
          toRemove.push(i);
          checkAbove(bx, by + 1, bz);
        }
      }
    };
    checkAbove(x, y, z);

    // Remove in reverse order (highest index first)
    toRemove.sort((a, b) => b - a);
    let refund = 0;
    for (const i of toRemove) {
      refund += BLOCK_TYPES[this.layout[i].type].cost;
      this.layout.splice(i, 1);
    }
    this.budget += refund;
    this.updateBudgetDisplay();
    this.rebuildMeshes();
  }

  placeTarget(x, z) {
    // Don't allow placing target inside a block
    if (this.hasBlockAt(x, 0, z)) return;
    this._pushUndo();
    this.targetPos = { x, y: 0, z };
    this.updateTargetMesh();
  }

  // === PRESET LOADING ===

  loadPreset(name) {
    this.loadFromDesignData(getPreset(name, this.modeConfig?.id || 'castle'));
  }

  loadFromDesignData(data) {
    this._pushUndo();
    this.layout = data.layout.map(b => ({ ...b }));
    this.targetPos = { ...data.target };
    this.customFloor = data.floor || null;
    let cost = 0;
    for (const block of this.layout) {
      cost += BLOCK_TYPES[block.type]?.cost || 0;
    }
    this.budget = Math.max(0, this.maxBudget - cost);
    this.updateBudgetDisplay();
    this.updateTargetMesh();
    this.rebuildMeshes();
  }

  // === MESH MANAGEMENT ===

  rebuildMeshes() {
    // Remove old meshes (materials are per-mesh; geometries are shared via _geometries)
    for (const { mesh } of this.blockMeshes) {
      this.gridGroup.remove(mesh);
      mesh.material?.dispose();
    }
    this.blockMeshes = [];

    const halfW = Math.floor(this.gridW / 2);
    const halfD = Math.floor(this.gridD / 2);
    const geometries = this._geometries;

    for (const block of this.layout) {
      const geo = geometries[block.type] || geometries.CUBE;
      const isOnCurrentLayer = block.y === this.currentLayer;
      const isAbove = block.y > this.currentLayer;

      // Blocks at/below current layer are solid; blocks above are transparent
      const baseColor = this.modeConfig?.floorColor || 0x8b7355;
      const typeInfo = BLOCK_TYPES[block.type];
      let mat;
      if (typeInfo?.material) {
        mat = new THREE.MeshStandardMaterial({
          ...typeInfo.material,
          opacity: isAbove ? 0.1 : (typeInfo.material.opacity ?? 1),
        });
      } else {
        const highlightColor = new THREE.Color(baseColor).offsetHSL(0, 0, 0.12).getHex();
        mat = new THREE.MeshStandardMaterial({
          color: isOnCurrentLayer ? highlightColor : baseColor,
          transparent: isAbove, opacity: isAbove ? 0.25 : 1.0,
        });
        mat.color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.05);
      }

      const mesh = new THREE.Mesh(geo, mat);
      const yOffset = typeInfo.size[1] < BLOCK_SIZE ? typeInfo.size[1] / 2 : BLOCK_SIZE / 2;
      mesh.position.set(
        (block.x - halfW) * BLOCK_SIZE,
        block.y * BLOCK_SIZE + yOffset,
        (block.z - halfD) * BLOCK_SIZE
      );
      mesh.rotation.set(
        (block.rotX || 0) * Math.PI / 2,
        (block.rotation || 0) * Math.PI / 2,
        (block.rotZ || 0) * Math.PI / 2
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Store grid coords for raycasting identification
      mesh.userData = { gx: block.x, gy: block.y, gz: block.z };

      this.gridGroup.add(mesh);
      this.blockMeshes.push({ mesh, block });
    }
  }

  updateTargetMesh() {
    if (!this.targetMesh) return;
    const halfW = Math.floor(this.gridW / 2);
    const halfD = Math.floor(this.gridD / 2);
    this.targetMesh.position.set(
      (this.targetPos.x - halfW) * BLOCK_SIZE,
      this.targetPos.y * BLOCK_SIZE + 0.4,
      (this.targetPos.z - halfD) * BLOCK_SIZE
    );
  }

  _applySelectedRotation(obj) {
    obj.rotation.set(
      this.selectedRotX * Math.PI / 2,
      this.selectedRotation * Math.PI / 2,
      this.selectedRotZ * Math.PI / 2
    );
  }

  updateGhostGeometry() {
    if (!this.ghostMesh) return;
    this.ghostMesh.geometry = this._geometries[this.selectedType] || this._geometries.CUBE;
    this._applySelectedRotation(this.ghostMesh);
  }

  // === CAMERA (delegated to OrbitController) ===

  // === EVENT HANDLERS ===

  setupEventListeners() {
    const canvas = this.renderer.domElement;
    this.orbit.setupListeners(canvas);
    canvas.addEventListener('click', this._onClick);
    canvas.addEventListener('auxclick', this._onClick); // middle-click
    canvas.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('keydown', this._onKeyDown);
    canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this._onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', this._onTouchEnd, { passive: false });
  }

  removeEventListeners() {
    const canvas = this.renderer.domElement;
    this.orbit.removeListeners(canvas);
    canvas.removeEventListener('click', this._onClick);
    canvas.removeEventListener('auxclick', this._onClick);
    canvas.removeEventListener('contextmenu', this._onContextMenu);
    window.removeEventListener('keydown', this._onKeyDown);
    canvas.removeEventListener('touchstart', this._onTouchStart);
    canvas.removeEventListener('touchmove', this._onTouchMove);
    canvas.removeEventListener('touchend', this._onTouchEnd);
    canvas.removeEventListener('touchcancel', this._onTouchEnd);
  }

  _getHoveredGridPos(e) {
    this.orbit.updateMouse(e);
    this.orbit.raycaster.setFromCamera(this.orbit.mouse, this.orbit.camera);
    const hits = this.orbit.raycaster.intersectObject(this.gridPlane);
    if (hits.length === 0) return null;
    return this.getGridPos(hits[0].point);
  }

  _handleHover(e) {
    // Update ghost position (called by OrbitController when not dragging)
    const gridPos = this._getHoveredGridPos(e);
    if (!gridPos) {
      if (this.ghostMesh) this.ghostMesh.visible = false;
      return;
    }

    if (this.placingTarget) {
      // Hide ghost in target mode
      if (this.ghostMesh) this.ghostMesh.visible = false;
      return;
    }

    const halfW = Math.floor(this.gridW / 2);
    const halfD = Math.floor(this.gridD / 2);
    const typeInfo = BLOCK_TYPES[this.selectedType];
    const yOffset = typeInfo.size[1] < BLOCK_SIZE ? typeInfo.size[1] / 2 : BLOCK_SIZE / 2;

    this.ghostMesh.position.set(
      (gridPos.x - halfW) * BLOCK_SIZE,
      this.currentLayer * BLOCK_SIZE + yOffset,
      (gridPos.z - halfD) * BLOCK_SIZE
    );
    this._applySelectedRotation(this.ghostMesh);

    if (this._removeMode) {
      const hasBlock = this.hasBlockAt(gridPos.x, this.currentLayer, gridPos.z);
      this.ghostMesh.material.color.set(0xff4444);
      this.ghostMesh.material.opacity = hasBlock ? 0.5 : 0.15;
    } else {
      const canPlace = this.canPlace(gridPos.x, this.currentLayer, gridPos.z);
      this.ghostMesh.material.color.set(canPlace ? 0x44aaff : 0xff4444);
      this.ghostMesh.material.opacity = canPlace ? 0.4 : 0.25;
    }
    this.ghostMesh.visible = true;
  }

  _handleClick(e) {
    if (e.button !== 0 && e.button !== 1) return;
    if (this.orbit.wasDrag(e)) return;

    const gridPos = this._getHoveredGridPos(e);
    if (!gridPos) return;

    // Shift+click or middle-click: grab an existing block
    if (e.button === 1 || e.shiftKey) {
      e.preventDefault();
      this._grabBlock(gridPos.x, this.currentLayer, gridPos.z);
      return;
    }

    if (this.placingTarget) {
      this.placeTarget(gridPos.x, gridPos.z);
      return;
    }

    this.placeBlock(gridPos.x, this.currentLayer, gridPos.z);
  }

  _grabBlock(x, y, z) {
    // Find block at this position — current layer first, then topmost
    let block = this.layout.find(b => b.x === x && b.y === y && b.z === z);
    if (!block) {
      const candidates = this.layout.filter(b => b.x === x && b.z === z);
      if (candidates.length > 0) {
        block = candidates.reduce((a, b) => a.y > b.y ? a : b);
      }
    }
    if (!block) return;

    this._pushUndo();
    // Remove it from layout (refund cost) — only remove this block, not cascade
    const idx = this.layout.indexOf(block);
    if (idx >= 0) {
      this.layout.splice(idx, 1);
      this.budget += BLOCK_TYPES[block.type]?.cost || 0;
      this.updateBudgetDisplay();
    }

    // Set as current selection
    this.selectedType = block.type;
    this.selectedRotation = block.rotation || 0;
    this.selectedRotX = block.rotX || 0;
    this.selectedRotZ = block.rotZ || 0;
    this.placingTarget = false;

    // Update palette highlight
    const allBtns = document.querySelectorAll('#castle-builder-ui .block-btn[data-type]');
    const targetBtn = document.getElementById('builder-target-btn');
    allBtns.forEach(b => {
      b.style.background = 'rgba(255,255,255,0.06)';
      b.style.borderColor = 'rgba(255,255,255,0.15)';
    });
    if (targetBtn) {
      targetBtn.style.background = 'rgba(255,255,255,0.06)';
      targetBtn.style.borderColor = 'rgba(255,255,255,0.15)';
    }
    const match = document.querySelector(`#castle-builder-ui .block-btn[data-type="${block.type}"]`);
    if (match) {
      match.style.background = 'rgba(255,255,255,0.2)';
      match.style.borderColor = '#e67e22';
    }

    this.updateGhostGeometry();
    this.rebuildMeshes();
  }

  _handleContextMenu(e) {
    e.preventDefault();
    const gridPos = this._getHoveredGridPos(e);
    if (!gridPos) return;
    this.removeBlock(gridPos.x, this.currentLayer, gridPos.z);
  }

  // ── Touch handlers ────────────────────────────────────

  _getTouchPinchDist(e) {
    const t0 = e.touches[0], t1 = e.touches[1];
    return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
  }

  _handleTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 2) {
      this._touchMode = 'pinch';
      this.orbit.startPinch(this._getTouchPinchDist(e));
      return;
    }
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    // Raycast to determine context
    this.orbit.updateTouchMouse(touch);
    this.orbit.raycaster.setFromCamera(this.orbit.mouse, this.orbit.camera);
    const hits = this.orbit.raycaster.intersectObject(this.gridPlane);
    if (hits.length > 0) {
      const gridPos = this.getGridPos(hits[0].point);
      if (gridPos) {
        this._touchMode = 'build';
        this._touchGridPos = gridPos;
        this._touchStartPos = { x: touch.clientX, y: touch.clientY };
        return;
      }
    }
    // Off grid — orbit
    this._touchMode = 'orbit';
    this.orbit.startTouchOrbit(touch.clientX, touch.clientY);
  }

  _handleTouchMove(e) {
    e.preventDefault();
    if (this._touchMode === 'pinch' && e.touches.length === 2) {
      this.orbit.updatePinch(this._getTouchPinchDist(e));
      return;
    }
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];

    if (this._touchMode === 'orbit') {
      this.orbit.updateTouchOrbit(touch.clientX, touch.clientY);
    } else if (this._touchMode === 'build') {
      // Promote to orbit if dragged far enough
      const dx = touch.clientX - this._touchStartPos.x;
      const dy = touch.clientY - this._touchStartPos.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        this._touchMode = 'orbit';
        this.orbit.startTouchOrbit(touch.clientX, touch.clientY);
      }
    }
  }

  _handleTouchEnd(e) {
    e.preventDefault();
    if (this._touchMode === 'pinch') {
      this.orbit.endPinch();
      this._touchMode = null;
      return;
    }
    if (this._touchMode === 'build' && this._touchGridPos) {
      const gridPos = this._touchGridPos;
      if (this._removeMode) {
        this.removeBlock(gridPos.x, this.currentLayer, gridPos.z);
        this._setRemoveMode(false); // one-shot: return to place mode
      } else if (this.placingTarget) {
        this.placeTarget(gridPos.x, gridPos.z);
      } else {
        this.placeBlock(gridPos.x, this.currentLayer, gridPos.z);
      }
    }
    if (this._touchMode === 'orbit') {
      this.orbit.endTouchOrbit();
    }
    this._touchMode = null;
    this._touchGridPos = null;
  }

  _handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      this.undo();
      return;
    }
    if (e.code === 'KeyR') {
      this.selectedRotation = (this.selectedRotation + 1) % 4;
      if (this.ghostMesh) this._applySelectedRotation(this.ghostMesh);
    }
    if (e.code === 'KeyT') {
      this.selectedRotX = (this.selectedRotX + 1) % 4;
      if (this.ghostMesh) this._applySelectedRotation(this.ghostMesh);
    }
    if (e.code === 'KeyF') {
      this.selectedRotZ = (this.selectedRotZ + 1) % 4;
      if (this.ghostMesh) this._applySelectedRotation(this.ghostMesh);
    }
    // Layer shortcuts
    if (e.code === 'Digit1') this.setLayer(0);
    if (e.code === 'Digit2') this.setLayer(1);
    if (e.code === 'Digit3') this.setLayer(2);
    if (e.code === 'Digit4') this.setLayer(3);
    if (e.code === 'Digit5') this.setLayer(4);
    // Bracket keys for layer up/down
    if (e.code === 'BracketRight') this.setLayer(Math.min(this.maxLayers - 1, this.currentLayer + 1));
    if (e.code === 'BracketLeft') this.setLayer(Math.max(0, this.currentLayer - 1));
  }
}
