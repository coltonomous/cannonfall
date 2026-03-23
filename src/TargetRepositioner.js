import * as THREE from 'three';
import { CASTLE_WIDTH, CASTLE_DEPTH, BLOCK_SIZE } from './constants.js';

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

    // Orbit camera
    this.orbitAngle = Math.PI / 4;
    this.orbitPitch = Math.PI / 4;
    this.orbitDistance = 16;
    this.orbitCenter = new THREE.Vector3(0, 2, 0);
    this.isDragging = false;
    this.lastMouse = { x: 0, y: 0 };

    // Raycasting
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // 3D objects (created in start)
    this.group = null;
    this.gridPlane = null;
    this.ghostTarget = null;

    // Bound handlers
    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onClick = this._handleClick.bind(this);
    this._onContextMenu = (e) => e.preventDefault();
    this._onWheel = this._handleWheel.bind(this);
    this._onKeyDown = this._handleKeyDown.bind(this);
  }

  start(castle, damagedPlayerIndex, onConfirm) {
    this.onConfirm = onConfirm;
    this.castle = castle;
    this.centerX = castle.centerX;
    this.targetPos = { x: 4, y: 0, z: 4 };

    this.orbitCenter.set(this.centerX, 2, 0);
    this.orbitAngle = damagedPlayerIndex === 0 ? Math.PI / 4 : -Math.PI * 3 / 4;
    this.currentLayer = 0;
    this._savedMaterials = [];

    this.group = new THREE.Group();
    this.sceneManager.scene.add(this.group);

    // Raycast plane at floor level — semi-transparent so the player can see the grid
    this.gridPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(CASTLE_WIDTH * 3, CASTLE_DEPTH * 3),
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
      new THREE.BoxGeometry(CASTLE_WIDTH, 0.05, CASTLE_DEPTH)
    );
    const gridLine = new THREE.LineSegments(
      gridGeo,
      new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.5 })
    );
    gridLine.position.set(this.centerX, BLOCK_SIZE + 0.5, 0);
    this.group.add(gridLine);

    this.setupEventListeners();
    this.updateCamera();
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

  // === CAMERA ===

  updateCamera() {
    const x = this.orbitCenter.x + this.orbitDistance * Math.cos(this.orbitPitch) * Math.sin(this.orbitAngle);
    const y = this.orbitCenter.y + this.orbitDistance * Math.sin(this.orbitPitch);
    const z = this.orbitCenter.z + this.orbitDistance * Math.cos(this.orbitPitch) * Math.cos(this.orbitAngle);
    this.sceneManager.snapCamera(new THREE.Vector3(x, y, z), this.orbitCenter);
  }

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
    const halfW = Math.floor(CASTLE_WIDTH / 2);
    const gx = Math.round((point.x - this.centerX) / BLOCK_SIZE + halfW);
    const gz = Math.round(point.z / BLOCK_SIZE + halfW);
    if (gx < 0 || gx >= CASTLE_WIDTH || gz < 0 || gz >= CASTLE_DEPTH) return null;
    return { x: gx, z: gz };
  }

  getHitY(point) {
    // Returns the Y position to place the target — on top of whatever was hit
    return Math.max(BLOCK_SIZE + 0.5, point.y + 0.5);
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
    window.removeEventListener('keydown', this._onKeyDown);
    canvas.removeEventListener('mousedown', this._onMouseDown);
    canvas.removeEventListener('mouseup', this._onMouseUp);
    canvas.removeEventListener('mousemove', this._onMouseMove);
    canvas.removeEventListener('click', this._onClick);
    canvas.removeEventListener('contextmenu', this._onContextMenu);
    canvas.removeEventListener('wheel', this._onWheel);
  }

  _updateMouse(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _raycastGrid(e) {
    this._updateMouse(e);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Raycast against castle blocks first — allows placing on top of rubble
    if (this.castle) {
      const blockMeshes = this.castle.blocks.map(b => b.mesh);
      const blockHits = this.raycaster.intersectObjects(blockMeshes);
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
    const hits = this.raycaster.intersectObject(this.gridPlane);
    if (hits.length === 0) return null;
    const gridPos = this.getGridPos(hits[0].point);
    if (gridPos) gridPos.hitY = BLOCK_SIZE + 0.5; // floor level
    return gridPos;
  }

  _handleMouseDown(e) {
    this._clickStart = { x: e.clientX, y: e.clientY };
    if (e.button === 0) {
      this._leftDown = true;
    }
  }

  _handleMouseUp(e) {
    this.isDragging = false;
    this._leftDown = false;
  }

  _handleMouseMove(e) {
    // Promote to drag if threshold exceeded
    if (this._leftDown && !this.isDragging && this._clickStart) {
      const dx = e.clientX - this._clickStart.x;
      const dy = e.clientY - this._clickStart.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        this.isDragging = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
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
    const gridPos = this._raycastGrid(e);
    if (!gridPos || !this.ghostTarget) {
      if (this.ghostTarget) this.ghostTarget.visible = false;
      return;
    }

    const halfW = Math.floor(CASTLE_WIDTH / 2);
    const hitY = gridPos.hitY || (BLOCK_SIZE + 0.5);
    this.ghostTarget.position.set(
      this.centerX + (gridPos.x - halfW) * BLOCK_SIZE,
      hitY,
      (gridPos.z - halfW) * BLOCK_SIZE
    );
    this.ghostTarget.visible = true;
  }

  _handleClick(e) {
    if (e.button !== 0) return;
    if (this._clickStart) {
      const dx = e.clientX - this._clickStart.x;
      const dy = e.clientY - this._clickStart.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) return; // was a drag
    }

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
      const halfW = Math.floor(CASTLE_WIDTH / 2);
      this.ghostTarget.position.set(
        this.centerX + (gridPos.x - halfW) * BLOCK_SIZE,
        hitY,
        (gridPos.z - halfW) * BLOCK_SIZE
      );
      this.ghostTarget.visible = true;
    }
  }

  _handleWheel(e) {
    e.preventDefault();
    this.orbitDistance = Math.max(8, Math.min(25, this.orbitDistance + e.deltaY * 0.02));
    this.updateCamera();
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
