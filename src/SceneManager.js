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
    this._lerpSpeed = 3;

    // Screen shake
    this._shakeIntensity = 0;
    this._shakeDuration = 0;
    this._shakeTimer = 0;

    // Minimap camera (orthographic, top-down) — sees layers 0 + 2
    this.minimapCamera = new THREE.OrthographicCamera(-7, 7, 7, -7, 0.1, 50);
    this.minimapCamera.position.set(0, 30, 0);
    this.minimapCamera.up.set(0, 0, -1);
    this.minimapCamera.lookAt(0, 0, 0);
    this.minimapCamera.layers.enable(2);
    this.minimapEnabled = false;

    this.setupLighting();
    this.setupGround();

    window.addEventListener('resize', () => this.onResize());
  }

  setupLighting() {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(this.ambientLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.dirLight.position.set(10, 20, 10);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 100;
    this.dirLight.shadow.camera.left = -40;
    this.dirLight.shadow.camera.right = 40;
    this.dirLight.shadow.camera.top = 40;
    this.dirLight.shadow.camera.bottom = -40;
    this.scene.add(this.dirLight);
  }

  setupGround() {
    const geo = new THREE.PlaneGeometry(120, 120);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a7c3f });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  }

  applyMode(config) {
    // Background
    this.scene.background = new THREE.Color(config.backgroundColor);

    // Fog
    if (config.fogNear) {
      this.scene.fog = new THREE.Fog(config.backgroundColor, config.fogNear, config.fogFar);
    } else {
      this.scene.fog = null;
    }

    // Remove existing ground
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
      this.ground.material.dispose();
      this.ground = null;
      this._waterGeo = null;
      this._waterBaseY = null;
      this._waterTime = 0;
    }

    // Remove existing starfield
    if (this.starfield) {
      this.scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      this.starfield.material.dispose();
      this.starfield = null;
    }

    if (config.hasGround) {
      if (config.waterSurface) {
        // Animated water surface — semi-transparent blue with subtle vertex displacement
        const geo = new THREE.PlaneGeometry(120, 120, 60, 60);
        const mat = new THREE.MeshStandardMaterial({
          color: config.groundColor,
          transparent: true,
          opacity: 0.55,
          metalness: 0.3,
          roughness: 0.3,
        });
        this.ground = new THREE.Mesh(geo, mat);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.y = -0.8; // water sits below deck, hull visible above
        this.ground.receiveShadow = true;
        this.scene.add(this.ground);
        this._waterGeo = geo;
        this._waterBaseY = geo.attributes.position.array.slice(); // store original positions
      } else {
        const geo = new THREE.PlaneGeometry(120, 120);
        const mat = new THREE.MeshStandardMaterial({ color: config.groundColor });
        this.ground = new THREE.Mesh(geo, mat);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.receiveShadow = true;
        this.scene.add(this.ground);
      }
    } else {
      // Create starfield
      const starCount = 2000;
      const positions = new Float32Array(starCount * 3);
      const colors = new Float32Array(starCount * 3);
      const sizes = new Float32Array(starCount);
      for (let i = 0; i < starCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 150;
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);
        // Varying brightness: most stars dim, a few bright
        const brightness = Math.pow(Math.random(), 2.5); // skew toward dim
        colors[i * 3] = 0.6 + brightness * 0.4;
        colors[i * 3 + 1] = 0.6 + brightness * 0.4;
        colors[i * 3 + 2] = 0.7 + brightness * 0.3; // slight blue tint
        sizes[i] = 0.15 + brightness * 0.6;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
      const mat = new THREE.PointsMaterial({ vertexColors: true, size: 0.4, sizeAttenuation: true });
      this.starfield = new THREE.Points(geo, mat);
      this.scene.add(this.starfield);
    }

    // Update lighting
    this.ambientLight.intensity = config.ambientIntensity;
    this.dirLight.intensity = config.dirIntensity;
    this.dirLight.position.set(...config.dirPosition);
  }

  setCameraPosition(position, lookAt) {
    this._targetPos.copy(position);
    this._targetLookAt.copy(lookAt);
  }

  snapCamera(position, lookAt) {
    this._targetPos.copy(position);
    this._targetLookAt.copy(lookAt);
    this.camera.position.copy(position);
    this._currentLookAt.copy(lookAt);
    this.camera.lookAt(lookAt);
  }

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

  updateCamera(dt) {
    const t = 1 - Math.exp(-this._lerpSpeed * dt);
    this.camera.position.lerp(this._targetPos, t);
    this._currentLookAt.lerp(this._targetLookAt, t);
    this.camera.lookAt(this._currentLookAt);

    if (this._shakeTimer > 0) {
      this._shakeTimer -= dt;
      const decay = this._shakeTimer / this._shakeDuration;
      const intensity = this._shakeIntensity * decay;
      this.camera.position.x += (Math.random() - 0.5) * intensity;
      this.camera.position.y += (Math.random() - 0.5) * intensity;
      this.camera.position.z += (Math.random() - 0.5) * intensity;
    }

    // Water surface animation
    if (this._waterGeo && this._waterBaseY) {
      this._waterTime = (this._waterTime || 0) + dt;
      const pos = this._waterGeo.attributes.position;
      const base = this._waterBaseY;
      // PlaneGeometry with rotation -π/2 means Y attribute is world Z, Z attribute is world -Y
      // We animate the Z attribute (which is vertical after rotation)
      const swell = 1.0 + 0.4 * Math.sin(this._waterTime * 0.2);
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const y = base[i * 3 + 1];
        pos.array[i * 3 + 2] = base[i * 3 + 2] +
          Math.sin(x * 0.15 + this._waterTime * 0.8) * 0.4 * swell +
          Math.cos(y * 0.12 + this._waterTime * 0.6) * 0.25 * swell +
          Math.sin(x * 0.08 + y * 0.06 + this._waterTime * 0.4) * 0.15;
      }
      pos.needsUpdate = true;
    }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render() {
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
