import * as THREE from 'three';

export class SceneManager {
  constructor(canvas) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87CEEB);
    this.scene.fog = new THREE.Fog(0x87CEEB, 100, 200);

    // Layer 0: default (blocks, ground, etc) — both cameras see
    // Layer 1: main-camera-only (cannons)
    // Layer 2: minimap-only (target markers)
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 25, 35);
    this.camera.lookAt(0, 3, 0);
    this.camera.layers.enable(1); // main camera sees cannons

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Camera lerp targets
    this._targetPos = this.camera.position.clone();
    this._targetLookAt = new THREE.Vector3(0, 3, 0);
    this._currentLookAt = new THREE.Vector3(0, 3, 0);
    this._lerpSpeed = 3; // units per second (higher = faster tracking)
    this._snapNext = false; // skip lerp on next update (e.g. scene transitions)

    // Screen shake
    this._shakeIntensity = 0;
    this._shakeDuration = 0;
    this._shakeTimer = 0;

    // Minimap camera (orthographic, top-down) — sees layers 0 + 2
    this.minimapCamera = new THREE.OrthographicCamera(-7, 7, 7, -7, 0.1, 50);
    this.minimapCamera.position.set(0, 30, 0);
    this.minimapCamera.up.set(0, 0, -1);
    this.minimapCamera.lookAt(0, 0, 0);
    this.minimapCamera.layers.enable(2); // minimap sees target markers
    this.minimapEnabled = false;

    this.setupLighting();
    this.setupGround();

    window.addEventListener('resize', () => this.onResize());
  }

  setupLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(10, 20, 10);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 2048;
    dir.shadow.mapSize.height = 2048;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 100;
    dir.shadow.camera.left = -40;
    dir.shadow.camera.right = 40;
    dir.shadow.camera.top = 40;
    dir.shadow.camera.bottom = -40;
    this.scene.add(dir);
  }

  setupGround() {
    const geo = new THREE.PlaneGeometry(120, 120);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a7c3f });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  // Set the camera's target position and lookAt. Camera will lerp toward these.
  setCameraPosition(position, lookAt) {
    this._targetPos.copy(position);
    this._targetLookAt.copy(lookAt);
  }

  // Snap camera immediately to the target (no lerp). Use for scene transitions.
  snapCamera(position, lookAt) {
    this._targetPos.copy(position);
    this._targetLookAt.copy(lookAt);
    this.camera.position.copy(position);
    this._currentLookAt.copy(lookAt);
    this.camera.lookAt(lookAt);
  }

  // Trigger screen shake
  shake(intensity = 0.4, duration = 0.3) {
    this._shakeIntensity = intensity;
    this._shakeDuration = duration;
    this._shakeTimer = duration;
  }

  setupMinimap(centerX) {
    this.minimapCamera.position.set(centerX, 30, 0);
    this.minimapCamera.up.set(0, 0, -1);
    this.minimapCamera.lookAt(centerX, 0, 0);
    this.minimapCamera.updateProjectionMatrix();
    this.minimapEnabled = true;
  }

  disableMinimap() {
    this.minimapEnabled = false;
  }

  // Call once per frame before render()
  updateCamera(dt) {
    // Lerp position and lookAt toward targets
    const t = 1 - Math.exp(-this._lerpSpeed * dt); // frame-rate-independent lerp
    this.camera.position.lerp(this._targetPos, t);
    this._currentLookAt.lerp(this._targetLookAt, t);
    this.camera.lookAt(this._currentLookAt);

    // Apply screen shake offset
    if (this._shakeTimer > 0) {
      this._shakeTimer -= dt;
      const decay = this._shakeTimer / this._shakeDuration;
      const intensity = this._shakeIntensity * decay;
      this.camera.position.x += (Math.random() - 0.5) * intensity;
      this.camera.position.y += (Math.random() - 0.5) * intensity;
      this.camera.position.z += (Math.random() - 0.5) * intensity;
    }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render() {
    // Use CSS pixel values — Three.js setViewport/setScissor auto-scale by pixelRatio
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Main render (full viewport)
    this.renderer.setViewport(0, 0, width, height);
    this.renderer.setScissorTest(false);
    this.renderer.render(this.scene, this.camera);

    // Minimap render (small viewport, bottom-right)
    if (this.minimapEnabled) {
      const mmSize = 160;
      const mmPad = 16;
      const mmBottom = 60;
      const mmX = width - mmSize - mmPad;
      const mmY = mmBottom;

      this.renderer.autoClear = false;
      this.renderer.setScissorTest(true);
      this.renderer.setViewport(mmX, mmY, mmSize, mmSize);
      this.renderer.setScissor(mmX, mmY, mmSize, mmSize);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.scene, this.minimapCamera);
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, width, height);
      this.renderer.autoClear = true;
    }
  }
}
