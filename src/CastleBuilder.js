import * as THREE from 'three';
import { BLOCK_SIZE, BUILD_BUDGET, BLOCK_TYPES } from './constants.js';
import { getPreset } from './Presets.js';
import { createAllBlockGeometries } from './BlockGeometry.js';

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
    this.selectedRotation = 0;
    this.currentLayer = 0; // layer above floor (0-4)
    this.budget = BUILD_BUDGET;
    this.placingTarget = false; // true when in target placement mode

    // 3D objects
    this.gridGroup = new THREE.Group();
    this.blockMeshes = []; // { mesh, block } for placed blocks
    this.ghostMesh = null;
    this.targetMesh = null;
    this.floorMeshes = [];

    // Orbit camera state
    this.orbitAngle = Math.PI / 4; // horizontal angle
    this.orbitPitch = Math.PI / 5; // vertical angle (from horizontal)
    this.orbitDistance = 18;
    this.orbitCenter = new THREE.Vector3(0, 2, 0);
    this.isDragging = false;
    this.lastMouse = { x: 0, y: 0 };

    // Raycasting
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.gridPlane = null; // invisible plane for raycasting at current layer

    // Bound event handlers (for cleanup)
    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onClick = this._handleClick.bind(this);
    this._onContextMenu = this._handleContextMenu.bind(this);
    this._onWheel = this._handleWheel.bind(this);
    this._onKeyDown = this._handleKeyDown.bind(this);
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
    this.currentLayer = 0;
    this.budget = this.maxBudget;
    this.placingTarget = false;
    this.customFloor = null;

    this.setupScene();
    this.setupEventListeners();
    this.updateCamera();
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

    // Floor base — only for ground-based modes (castle). Space mode has no floor.
    const halfW = Math.floor(this.gridW / 2);
    const halfD = Math.floor(this.gridD / 2);
    const showFloor = this.modeConfig?.hasGround !== false;

    if (showFloor) {
      const floorGeo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
      const floorMat = new THREE.MeshStandardMaterial({ color: this.modeConfig?.floorColor ?? 0x8b7355 });

      for (let x = 0; x < this.gridW; x++) {
        for (let z = 0; z < this.gridD; z++) {
          const mesh = new THREE.Mesh(floorGeo, floorMat.clone());
          mesh.material.color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
          mesh.position.set(
            (x - halfW) * BLOCK_SIZE,
            -BLOCK_SIZE / 2,
            (z - halfD) * BLOCK_SIZE
          );
          mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.gridGroup.add(mesh);
        this.floorMeshes.push(mesh);
      }
    }
    } // end if (showFloor)

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

    // Ghost preview block
    const ghostMat = new THREE.MeshStandardMaterial({
      color: 0x44aaff,
      transparent: true,
      opacity: 0.4,
    });
    this.ghostMesh = new THREE.Mesh(
      new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE),
      ghostMat
    );
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
    this.gridGroup.parent?.remove(this.gridGroup);
    // Dispose geometries/materials of block meshes
    for (const { mesh } of this.blockMeshes) {
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    }
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
        <div class="block-palette" style="display: flex; flex-direction: column; gap: 4px;">
          ${[
            { type: 'CUBE', icon: '■', label: 'Cube' },
            { type: 'HALF_SLAB', icon: '▬', label: 'Slab' },
            { type: 'WALL', icon: '▮', label: 'Wall' },
            { type: 'RAMP', icon: '◢', label: 'Ramp' },
            { type: 'COLUMN', icon: '‖', label: 'Column' },
            { type: 'QUARTER_DOME', icon: '◠', label: 'Dome' },
            { type: 'HALF_ARCH', icon: '⌒', label: 'Arch' },
            { type: 'BULLNOSE', icon: '⬬', label: 'Bullnose' },
            { type: 'HALF_BULLNOSE', icon: '⬭', label: '½ Bull' },
            { type: 'THRUSTER', icon: '⊳', label: 'Thruster' },
            { type: 'SHIELD', icon: '◇', label: 'Shield' },
          ].filter(b => !(this.modeConfig?.excludeBlocks || []).includes(b.type))
          .map((b, i) => `
            <button class="block-btn${i === 0 ? ' selected' : ''}" data-type="${b.type}" style="
              display: flex; align-items: center; gap: 6px;
              padding: 6px 10px; border: 2px solid rgba(255,255,255,0.15);
              border-radius: 6px; background: rgba(255,255,255,${i === 0 ? '0.1' : '0.06'});
              color: #fff; cursor: pointer; font-size: 0.8rem;
              transition: background 0.15s, border-color 0.15s;
              pointer-events: auto; min-width: 0;
            ">
              <span style="font-size: 1rem;">${b.icon}</span>
              <span>${b.label} <small>(${BLOCK_TYPES[b.type].cost})</small></span>
            </button>
          `).join('')}
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
        <div class="builder-info" style="
          margin-top: 8px; font-size: 0.75rem; opacity: 0.5; line-height: 1.6;
        ">
          <p>R: Rotate</p>
          <p>Click: Place</p>
          <p>Right-click: Remove</p>
          <p>Mouse drag: Orbit</p>
          <p>Scroll: Zoom</p>
        </div>
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
          <span>Budget: </span>
          <span id="builder-budget">${this.budget}</span>
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

    document.getElementById('builder-clear-btn').addEventListener('click', () => {
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
  }

  removeBuildUI() {
    const el = document.getElementById('castle-builder-ui');
    if (el) el.remove();
  }

  updateBudgetDisplay() {
    const el = document.getElementById('builder-budget');
    if (el) el.textContent = this.budget;
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

    this.layout.push({
      x, y, z,
      type: this.selectedType,
      rotation: this.selectedRotation,
    });
    this.budget -= cost;
    this.updateBudgetDisplay();
    this.rebuildMeshes();
  }

  removeBlock(x, y, z) {
    const idx = this.layout.findIndex(b => b.x === x && b.y === y && b.z === z);
    if (idx === -1) return;

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
    this.targetPos = { x, y: 0, z };
    this.updateTargetMesh();
  }

  // === PRESET LOADING ===

  loadPreset(name) {
    const preset = getPreset(name, this.modeConfig?.id || 'castle');

    // Load ALL preset blocks — presets are pre-designed and load fully
    this.layout = preset.layout.map(b => ({ ...b }));
    this.targetPos = { ...preset.target };
    this.customFloor = preset.floor || null;

    // Compute remaining budget (can be 0 if preset uses everything)
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
    // Remove old meshes
    for (const { mesh } of this.blockMeshes) {
      this.gridGroup.remove(mesh);
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    }
    this.blockMeshes = [];

    const halfW = Math.floor(this.gridW / 2);
    const halfD = Math.floor(this.gridD / 2);
    const geometries = createAllBlockGeometries();

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
      const yOffset = block.type === 'HALF_SLAB' ? typeInfo.size[1] / 2 : BLOCK_SIZE / 2;
      mesh.position.set(
        (block.x - halfW) * BLOCK_SIZE,
        block.y * BLOCK_SIZE + yOffset,
        (block.z - halfD) * BLOCK_SIZE
      );
      mesh.rotation.y = (block.rotation || 0) * Math.PI / 2;
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

  updateGhostGeometry() {
    if (!this.ghostMesh) return;
    this.ghostMesh.geometry.dispose();
    const geos = createAllBlockGeometries();
    this.ghostMesh.geometry = geos[this.selectedType] || geos.CUBE;
    this.ghostMesh.rotation.y = this.selectedRotation * Math.PI / 2;
  }

  // === CAMERA ===

  updateCamera() {
    const x = this.orbitCenter.x + this.orbitDistance * Math.cos(this.orbitPitch) * Math.sin(this.orbitAngle);
    const y = this.orbitCenter.y + this.orbitDistance * Math.sin(this.orbitPitch);
    const z = this.orbitCenter.z + this.orbitDistance * Math.cos(this.orbitPitch) * Math.cos(this.orbitAngle);
    this.sceneManager.snapCamera(
      new THREE.Vector3(x, y, z),
      this.orbitCenter
    );
  }

  // === EVENT HANDLERS ===

  setupEventListeners() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('click', this._onClick);
    canvas.addEventListener('contextmenu', this._onContextMenu);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKeyDown);
  }

  removeEventListeners() {
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('mousedown', this._onMouseDown);
    canvas.removeEventListener('mouseup', this._onMouseUp);
    canvas.removeEventListener('mousemove', this._onMouseMove);
    canvas.removeEventListener('click', this._onClick);
    canvas.removeEventListener('contextmenu', this._onContextMenu);
    canvas.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKeyDown);
  }

  _updateMouse(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _getHoveredGridPos(e) {
    this._updateMouse(e);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.gridPlane);
    if (hits.length === 0) return null;
    return this.getGridPos(hits[0].point);
  }

  _handleMouseDown(e) {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle click or Alt+click: start orbit immediately
      this.isDragging = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    } else if (e.button === 0) {
      // Left click: track start position; orbit begins once drag threshold exceeded
      this.isDragging = false;
      this._clickStart = { x: e.clientX, y: e.clientY };
      this._leftDown = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    }
  }

  _handleMouseUp(e) {
    this.isDragging = false;
    this._leftDown = false;
  }

  _handleMouseMove(e) {
    // Left-click drag: promote to orbit once threshold exceeded
    if (this._leftDown && !this.isDragging && this._clickStart) {
      const dx = e.clientX - this._clickStart.x;
      const dy = e.clientY - this._clickStart.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        this.isDragging = true;
      }
    }

    if (this.isDragging) {
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.orbitAngle -= dx * 0.008;
      this.orbitPitch = Math.max(0.1, Math.min(Math.PI / 2.5, this.orbitPitch + dy * 0.008));
      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.updateCamera();
      return;
    }

    // Update ghost position
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
    const yOffset = this.selectedType === 'HALF_SLAB' ? typeInfo.size[1] / 2 : BLOCK_SIZE / 2;

    this.ghostMesh.position.set(
      (gridPos.x - halfW) * BLOCK_SIZE,
      this.currentLayer * BLOCK_SIZE + yOffset,
      (gridPos.z - halfD) * BLOCK_SIZE
    );
    this.ghostMesh.rotation.y = this.selectedRotation * Math.PI / 2;

    const canPlace = this.canPlace(gridPos.x, this.currentLayer, gridPos.z);
    this.ghostMesh.material.color.set(canPlace ? 0x44aaff : 0xff4444);
    this.ghostMesh.material.opacity = canPlace ? 0.4 : 0.25;
    this.ghostMesh.visible = true;
  }

  _handleClick(e) {
    if (e.button !== 0) return;

    // Check if this was a drag (not a click)
    if (this._clickStart) {
      const dx = e.clientX - this._clickStart.x;
      const dy = e.clientY - this._clickStart.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        // Was a drag for orbit, not a click
        return;
      }
    }

    const gridPos = this._getHoveredGridPos(e);
    if (!gridPos) return;

    if (this.placingTarget) {
      this.placeTarget(gridPos.x, gridPos.z);
      return;
    }

    this.placeBlock(gridPos.x, this.currentLayer, gridPos.z);
  }

  _handleContextMenu(e) {
    e.preventDefault();
    const gridPos = this._getHoveredGridPos(e);
    if (!gridPos) return;
    this.removeBlock(gridPos.x, this.currentLayer, gridPos.z);
  }

  _handleWheel(e) {
    e.preventDefault();
    this.orbitDistance = Math.max(8, Math.min(30, this.orbitDistance + e.deltaY * 0.02));
    this.updateCamera();
  }

  _handleKeyDown(e) {
    if (e.code === 'KeyR') {
      this.selectedRotation = (this.selectedRotation + 1) % 4;
      if (this.ghostMesh) {
        this.ghostMesh.rotation.y = this.selectedRotation * Math.PI / 2;
      }
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
