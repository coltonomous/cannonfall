import * as THREE from 'three';

/**
 * Shared orbit-camera controller extracted from CastleBuilder and TargetRepositioner.
 * Handles orbit rotation via mouse drag, zoom via scroll wheel, and provides
 * raycasting utilities (raycaster + normalized mouse vector).
 */
export class OrbitController {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.camera = sceneManager.camera;
    this.renderer = sceneManager.renderer;

    // Orbit state
    this.orbitAngle = Math.PI / 4;
    this.orbitPitch = Math.PI / 5;
    this.orbitDistance = 18;
    this.orbitCenter = new THREE.Vector3(0, 2, 0);
    this.isDragging = false;
    this._leftDown = false;
    this._clickStart = null;
    this.lastMouse = { x: 0, y: 0 };

    // Raycasting
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Zoom limits (can be overridden)
    this.minDistance = 8;
    this.maxDistance = 30;

    // Touch state (managed externally by CastleBuilder/TargetRepositioner)
    this._touchOrbitLast = null;
    this._touchDragStart = null;
    this._pinchStartDist = null;

    // Bound handlers
    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onWheel = this._handleWheel.bind(this);
  }

  setupListeners(canvas) {
    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
  }

  removeListeners(canvas) {
    canvas.removeEventListener('mousedown', this._onMouseDown);
    canvas.removeEventListener('mouseup', this._onMouseUp);
    canvas.removeEventListener('mousemove', this._onMouseMove);
    canvas.removeEventListener('wheel', this._onWheel);
  }

  updateCamera() {
    const x = this.orbitCenter.x + this.orbitDistance * Math.cos(this.orbitPitch) * Math.sin(this.orbitAngle);
    const y = this.orbitCenter.y + this.orbitDistance * Math.sin(this.orbitPitch);
    const z = this.orbitCenter.z + this.orbitDistance * Math.cos(this.orbitPitch) * Math.cos(this.orbitAngle);
    this.sceneManager.snapCamera(new THREE.Vector3(x, y, z), this.orbitCenter);
  }

  updateMouse(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /**
   * Returns true if the most recent mousedown->mouseup sequence was a drag
   * (mouse moved more than 5px from the click start).
   */
  wasDrag(e) {
    if (!this._clickStart) return false;
    const dx = e.clientX - this._clickStart.x;
    const dy = e.clientY - this._clickStart.y;
    return Math.abs(dx) > 5 || Math.abs(dy) > 5;
  }

  // --- Internal handlers ---

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

  _handleMouseUp(_e) {
    this.isDragging = false;
    this._leftDown = false;
  }

  /**
   * Handles mouse move for orbit dragging.
   * Returns true if the event was consumed by orbit rotation (i.e. is dragging).
   */
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
    }

    // Notify callback for hover/ghost updates (only when not dragging)
    if (!this.isDragging && this.onMouseMove) {
      this.onMouseMove(e);
    }
  }

  _handleWheel(e) {
    e.preventDefault();
    this.orbitDistance = Math.max(this.minDistance, Math.min(this.maxDistance, this.orbitDistance + e.deltaY * 0.02));
    this.updateCamera();
  }

  // Touch orbit/zoom (called by CastleBuilder / TargetRepositioner)

  startTouchOrbit(x, y) {
    this._touchOrbitLast = { x, y };
    this._touchDragStart = { x, y };
    this.isDragging = false;
  }

  updateTouchOrbit(x, y) {
    if (!this._touchOrbitLast) return;
    // Promote to drag after threshold
    if (!this.isDragging && this._touchDragStart) {
      const dx = x - this._touchDragStart.x;
      const dy = y - this._touchDragStart.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        this.isDragging = true;
      }
    }
    if (this.isDragging) {
      const dx = x - this._touchOrbitLast.x;
      const dy = y - this._touchOrbitLast.y;
      this.orbitAngle -= dx * 0.008;
      this.orbitPitch = Math.max(0.1, Math.min(Math.PI / 2.5, this.orbitPitch + dy * 0.008));
      this.updateCamera();
    }
    this._touchOrbitLast = { x, y };
  }

  endTouchOrbit() {
    this._touchOrbitLast = null;
    this._touchDragStart = null;
    this.isDragging = false;
  }

  startPinch(dist) {
    this._pinchStartDist = dist;
  }

  updatePinch(dist) {
    if (!this._pinchStartDist) return;
    const ratio = this._pinchStartDist / dist;
    this.orbitDistance = Math.max(this.minDistance, Math.min(this.maxDistance, this.orbitDistance * ratio));
    this._pinchStartDist = dist;
    this.updateCamera();
  }

  endPinch() {
    this._pinchStartDist = null;
  }

  updateTouchMouse(touch) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;
  }
}
