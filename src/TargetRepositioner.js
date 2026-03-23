import * as THREE from 'three';
import { BLOCK_SIZE } from './constants.js';
import { OrbitController } from './OrbitController.js';

/**
 * Minimal orbit-camera + click-to-place-target UI for the reposition phase.
 * Modeled after CastleBuilder but with only target placement — no block editing.
 */
export class TargetRepositioner {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.camera = sceneManager.camera;
    this.renderer = sceneManager.renderer;

    this.onConfirm = null;
    this.centerX = 0;
    this.targetPos = { x: 4, z: 4 };

    // Orbit camera + raycasting (shared controller)
    this.orbit = new OrbitController(sceneManager);
    this.orbit.orbitPitch = Math.PI / 4;
    this.orbit.orbitDistance = 16;
    this.orbit.maxDistance = 25;
    this.orbit.onMouseMove = (e) => this._handleHover(e);

    // 3D objects (created in start)
    this.group = null;
    this.gridPlane = null;
    this.ghostTarget = null;

    // Bound handlers
    this._onClick = this._handleClick.bind(this);
    this._onContextMenu = (e) => e.preventDefault();
    this._onKeyDown = this._handleKeyDown.bind(this);
  }

  start(castle, damagedPlayerIndex, onConfirm) {
    this.onConfirm = onConfirm;
    this.castle = castle;
    this.centerX = castle.centerX;
    this.castleGridW = castle.gridWidth || 9;
    this.castleGridD = castle.gridDepth || 9;
    this.targetPos = { x: Math.floor(this.castleGridW / 2), y: 0, z: Math.floor(this.castleGridD / 2) };

    this.orbit.orbitCenter.set(this.centerX, 2, 0);
    this.orbit.orbitAngle = damagedPlayerIndex === 0 ? Math.PI / 4 : -Math.PI * 3 / 4;
    this.currentLayer = 0;
    this._savedMaterials = [];

    this.group = new THREE.Group();
    this.sceneManager.scene.add(this.group);

    // Raycast plane at floor level — semi-transparent so the player can see the grid
    this.gridPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(this.castleGridW * 3, this.castleGridD * 3),
      new THREE.MeshBasicMaterial({
        color: 0x44ff44,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
      })
    );
    this.gridPlane.rotation.x = -Math.PI / 2;
    this.gridPlane.position.set(this.centerX, BLOCK_SIZE + 0.5, 0);
    this.group.add(this.gridPlane);

    // Ghost target preview
    const geo = new THREE.SphereGeometry(0.5, 16, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff4444,
      emissive: 0xff0000,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.5,
    });
    this.ghostTarget = new THREE.Mesh(geo, mat);
    this.ghostTarget.visible = false;
    this.group.add(this.ghostTarget);

    // Grid outline for valid placement area
    const gridGeo = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(this.castleGridW, 0.05, this.castleGridD)
    );
    const gridLine = new THREE.LineSegments(
      gridGeo,
      new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.5 })
    );
    gridLine.position.set(this.centerX, BLOCK_SIZE + 0.5, 0);
    this.group.add(gridLine);

    this.setupEventListeners();
    this.orbit.updateCamera();
    this.createUI();
  }

  stop() {
    this.restoreBlockMaterials();
    this.removeEventListeners();
    this.removeUI();
    if (this.group) {
      this.sceneManager.scene.remove(this.group);
      this.group = null;
    }
    this.gridPlane = null;
    this.ghostTarget = null;
  }

  // === CAMERA (delegated to OrbitController) ===

  // === UI ===

  createUI() {
    this.removeUI();
    const container = document.createElement('div');
    container.id = 'reposition-ui';
    container.innerHTML = `
      <div style="
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: rgba(231, 76, 60, 0.9); color: white; padding: 10px 28px;
        border-radius: 20px; font-weight: 700; font-size: 1.1rem;
        text-transform: uppercase; letter-spacing: 1px; z-index: 15;
      ">Reposition Your Target</div>
      <div style="
        position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
        display: flex; gap: 12px; align-items: center; z-index: 15;
      ">
        <div style="
          background: rgba(0,0,0,0.6); color: white; padding: 8px 16px;
          border-radius: 8px; font-size: 0.85rem;
        ">Click: Place &bull; Drag: Orbit &bull; 1-5: Layer</div>
        <div style="
          background: rgba(0,0,0,0.6); padding: 4px 8px; border-radius: 8px;
          display: flex; gap: 4px; align-items: center;
        ">
          <button id="repo-layer-down" style="
            width:28px; height:28px; border:none; border-radius:4px; cursor:pointer;
            background:rgba(255,255,255,0.15); color:white; font-size:1rem;
            pointer-events:auto;
          ">▼</button>
          <span id="repo-layer-label" style="color:white; font-size:0.85rem; min-width:50px; text-align:center;">
            Layer 1
          </span>
          <button id="repo-layer-up" style="
            width:28px; height:28px; border:none; border-radius:4px; cursor:pointer;
            background:rgba(255,255,255,0.15); color:white; font-size:1rem;
            pointer-events:auto;
          ">▲</button>
        </div>
        <button id="reposition-confirm-btn" style="
          padding: 10px 28px; font-size: 1rem; font-weight: 700; border: none;
          border-radius: 8px; cursor: pointer; background: #27ae60; color: white;
          pointer-events: auto;
        ">Confirm</button>
      </div>
    `;
    document.body.appendChild(container);

    document.getElementById('reposition-confirm-btn').addEventListener('click', () => {
      this.restoreBlockMaterials();
      if (this.onConfirm) {
        this.onConfirm(this.targetPos);
      }
    });

    document.getElementById('repo-layer-up').addEventListener('click', () => {
      this.setLayer(Math.min(4, this.currentLayer + 1));
    });
    document.getElementById('repo-layer-down').addEventListener('click', () => {
      this.setLayer(Math.max(0, this.currentLayer - 1));
    });
  }

  removeUI() {
    const el = document.getElementById('reposition-ui');
    if (el) el.remove();
  }

  // === LAYER VISIBILITY ===

  setLayer(layer) {
    this.currentLayer = layer;
    const label = document.getElementById('repo-layer-label');
    if (label) label.textContent = `Layer ${layer + 1}`;

    // Update raycast plane height
    this.gridPlane.position.y = BLOCK_SIZE + layer * BLOCK_SIZE + 0.5;

    this.applyLayerTransparency();
  }

  applyLayerTransparency() {
    if (!this.castle) return;
    // Blocks above the current layer go transparent so you can see inside
    const layerWorldY = BLOCK_SIZE + this.currentLayer * BLOCK_SIZE;
    for (const { mesh } of this.castle.blocks) {
      const blockBottom = mesh.position.y - 0.5;
      if (blockBottom > layerWorldY + 0.5) {
        // Above current layer — make transparent
        if (!mesh.userData._origOpacity) {
          mesh.userData._origOpacity = mesh.material.opacity;
          mesh.userData._origTransparent = mesh.material.transparent;
        }
        mesh.material.transparent = true;
        mesh.material.opacity = 0.15;
      } else {
        // At or below — restore
        if (mesh.userData._origOpacity !== undefined) {
          mesh.material.opacity = mesh.userData._origOpacity;
          mesh.material.transparent = mesh.userData._origTransparent;
          delete mesh.userData._origOpacity;
          delete mesh.userData._origTransparent;
        }
      }
    }
  }

  restoreBlockMaterials() {
    if (!this.castle) return;
    for (const { mesh } of this.castle.blocks) {
      if (mesh.userData._origOpacity !== undefined) {
        mesh.material.opacity = mesh.userData._origOpacity;
        mesh.material.transparent = mesh.userData._origTransparent;
        delete mesh.userData._origOpacity;
        delete mesh.userData._origTransparent;
      }
    }
  }

  // === GRID ===

  getGridPos(point) {
    const halfW = Math.floor(this.castleGridW / 2);
    const halfD = Math.floor(this.castleGridD / 2);
    const gx = Math.round((point.x - this.centerX) / BLOCK_SIZE + halfW);
    const gz = Math.round(point.z / BLOCK_SIZE + halfD);
    if (gx < 0 || gx >= this.castleGridW || gz < 0 || gz >= this.castleGridD) return null;
    return { x: gx, z: gz };
  }

  getHitY(point) {
    // Returns the Y position to place the target — on top of whatever was hit
    return Math.max(BLOCK_SIZE + 0.5, point.y + 0.5);
  }

  // === EVENT HANDLERS ===

  setupEventListeners() {
    const canvas = this.renderer.domElement;
    this.orbit.setupListeners(canvas);
    canvas.addEventListener('click', this._onClick);
    canvas.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('keydown', this._onKeyDown);
  }

  removeEventListeners() {
    const canvas = this.renderer.domElement;
    this.orbit.removeListeners(canvas);
    window.removeEventListener('keydown', this._onKeyDown);
    canvas.removeEventListener('click', this._onClick);
    canvas.removeEventListener('contextmenu', this._onContextMenu);
  }

  _raycastGrid(e) {
    this.orbit.updateMouse(e);
    this.orbit.raycaster.setFromCamera(this.orbit.mouse, this.orbit.camera);

    // Raycast against castle blocks first — allows placing on top of rubble
    if (this.castle) {
      const blockMeshes = this.castle.blocks.map(b => b.mesh);
      const blockHits = this.orbit.raycaster.intersectObjects(blockMeshes);
      if (blockHits.length > 0) {
        const hit = blockHits[0];
        const gridPos = this.getGridPos(hit.point);
        if (gridPos) {
          gridPos.hitY = hit.point.y + 0.5; // on top of the hit block face
          return gridPos;
        }
      }
    }

    // Fallback: raycast against the floor plane
    const hits = this.orbit.raycaster.intersectObject(this.gridPlane);
    if (hits.length === 0) return null;
    const gridPos = this.getGridPos(hits[0].point);
    if (gridPos) gridPos.hitY = BLOCK_SIZE + 0.5; // floor level
    return gridPos;
  }

  _handleHover(e) {
    // Update ghost position (called by OrbitController when not dragging)
    const gridPos = this._raycastGrid(e);
    if (!gridPos || !this.ghostTarget) {
      if (this.ghostTarget) this.ghostTarget.visible = false;
      return;
    }

    const halfW = Math.floor(this.castleGridW / 2);
    const halfD = Math.floor(this.castleGridD / 2);
    const hitY = gridPos.hitY || (BLOCK_SIZE + 0.5);
    this.ghostTarget.position.set(
      this.centerX + (gridPos.x - halfW) * BLOCK_SIZE,
      hitY,
      (gridPos.z - halfD) * BLOCK_SIZE
    );
    this.ghostTarget.visible = true;
  }

  _handleClick(e) {
    if (e.button !== 0) return;
    if (this.orbit.wasDrag(e)) return;

    const gridPos = this._raycastGrid(e);
    if (!gridPos) return;

    // Compute target Y: use hit surface position, convert to grid layer
    const hitY = gridPos.hitY || (BLOCK_SIZE + 0.5);
    const gridY = Math.max(0, Math.round((hitY - BLOCK_SIZE - 0.5) / BLOCK_SIZE));
    this.targetPos = { x: gridPos.x, y: gridY, z: gridPos.z };

    // Immediate visual feedback — move the castle's actual target
    if (this.castle) {
      this.castle.repositionTarget(this.targetPos);
    }

    // Also show the ghost at the new position
    if (this.ghostTarget) {
      const halfW = Math.floor(this.castleGridW / 2);
      const halfD = Math.floor(this.castleGridD / 2);
      this.ghostTarget.position.set(
        this.centerX + (gridPos.x - halfW) * BLOCK_SIZE,
        hitY,
        (gridPos.z - halfD) * BLOCK_SIZE
      );
      this.ghostTarget.visible = true;
    }
  }

  _handleKeyDown(e) {
    if (e.code === 'Digit1') this.setLayer(0);
    if (e.code === 'Digit2') this.setLayer(1);
    if (e.code === 'Digit3') this.setLayer(2);
    if (e.code === 'Digit4') this.setLayer(3);
    if (e.code === 'Digit5') this.setLayer(4);
    if (e.code === 'BracketRight') this.setLayer(Math.min(4, this.currentLayer + 1));
    if (e.code === 'BracketLeft') this.setLayer(Math.max(0, this.currentLayer - 1));
  }
}
