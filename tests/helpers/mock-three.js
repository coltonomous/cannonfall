// Minimal THREE.js mock for headless integration tests.
// Provides just enough to let Game.js, Castle.js, BattleController.js,
// and Projectile.js construct without a WebGL context.

const noop = () => {};
const noopChain = () => ({ copy: noopChain, clone: noopChain, add: noopChain, sub: noopChain,
  multiplyScalar: noopChain, normalize: noopChain, lerp: noopChain, set: noopChain,
  setScalar: noopChain, lookAt: noop, applyEuler: noopChain, length: () => 0,
  x: 0, y: 0, z: 0 });

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  normalize() {
    const l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z) || 1;
    this.x /= l; this.y /= l; this.z /= l;
    return this;
  }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  distanceTo(v) {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  lerp(v, t) {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }
  applyEuler() { return this; }
  setScalar(s) { this.x = s; this.y = s; this.z = s; return this; }
  lookAt() { return this; }
}

class Euler {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
}

class Color {
  constructor() { this.r = 1; this.g = 1; this.b = 1; }
  offsetHSL() { return this; }
}

class MockObject3D {
  constructor() {
    this.position = new Vector3();
    this.rotation = { x: 0, y: 0, z: 0, set: noop };
    this.quaternion = { copy: noop };
    this.scale = { setScalar: noop };
    this.visible = true;
    this.layers = { set: noop, enable: noop };
    this.userData = {};
    this.castShadow = false;
    this.receiveShadow = false;
    this.children = [];
    this.parent = null;
    this.material = { wireframe: false, opacity: 1, transparent: false, color: new Color(), dispose: noop };
  }
  add(child) { this.children.push(child); }
  remove() {}
  traverse(fn) { fn(this); this.children.forEach(c => { if (c.traverse) c.traverse(fn); else fn(c); }); }
  getWorldPosition(target) { target.copy(this.position); return target; }
  lookAt() {}
}

class MockGeometry {
  constructor() { this.attributes = { position: { array: new Float32Array(0), needsUpdate: false, count: 0 } }; }
  dispose() {}
  setFromPoints() { return this; }
  setAttribute() {}
  setDrawRange() {}
  setIndex() {}
  computeVertexNormals() {}
  computeLineDistances() {}
  translate() {}
  rotateX() {}
  rotateY() {}
  rotateZ() {}
}

class MockMaterial {
  constructor(opts = {}) { Object.assign(this, { color: new Color(), opacity: 1, transparent: false, wireframe: false }, opts); }
  clone() { return new MockMaterial(this); }
  dispose() {}
}

// Export as a THREE-compatible module
export class Scene extends MockObject3D {}
export class Group extends MockObject3D {}
export class Mesh extends MockObject3D {
  constructor(geo, mat) {
    super();
    this.geometry = geo || new MockGeometry();
    this.material = mat || new MockMaterial();
  }
}
export class Line extends MockObject3D {
  constructor(geo, mat) {
    super();
    this.geometry = geo || new MockGeometry();
    this.material = mat || new MockMaterial();
  }
  computeLineDistances() {}
}
export class LineSegments extends Line {}
export class Points extends MockObject3D {}
export class Object3D extends MockObject3D {}
export { Vector3, Euler, Color };
export class PerspectiveCamera extends MockObject3D {
  constructor() { super(); this.aspect = 1; this.layers = { enable: noop, set: noop }; }
  lookAt() {}
  updateProjectionMatrix() {}
}
export class OrthographicCamera extends MockObject3D {
  constructor() { super(); this.up = new Vector3(); this.layers = { enable: noop, set: noop }; }
  lookAt() {}
  updateProjectionMatrix() {}
}
export class WebGLRenderer {
  constructor() {
    this.domElement = { addEventListener: noop, removeEventListener: noop };
    this.shadowMap = {};
  }
  setSize() {}
  setPixelRatio() {}
  setScissor() {}
  setScissorTest() {}
  setViewport() {}
  render() {}
}
export class Clock {
  constructor() { this._last = Date.now(); }
  getDelta() { return 1 / 60; }
}
export class BoxGeometry extends MockGeometry {}
export class SphereGeometry extends MockGeometry {}
export class PlaneGeometry extends MockGeometry {
  constructor() { super(); this.attributes.position = { array: new Float32Array(300), needsUpdate: false, count: 100 }; }
}
export class CylinderGeometry extends MockGeometry {}
export class RingGeometry extends MockGeometry {}
export class TorusGeometry extends MockGeometry {}
export class EdgesGeometry extends MockGeometry {}
export class BufferGeometry extends MockGeometry {}
export class ExtrudeGeometry extends MockGeometry {}
export class Shape { moveTo() {} lineTo() {} holes = []; }
export class Path { moveTo() {} lineTo() {} }
export class BufferAttribute { constructor(arr, size) { this.array = arr; this.count = arr.length / size; this.needsUpdate = false; } }
export class Float32BufferAttribute extends BufferAttribute {}
export class MeshStandardMaterial extends MockMaterial {}
export class MeshBasicMaterial extends MockMaterial {}
export class LineBasicMaterial extends MockMaterial {}
export class LineDashedMaterial extends MockMaterial {}
export class PointsMaterial extends MockMaterial {}
export class PointLight extends MockObject3D { constructor() { super(); } }
export class Fog { constructor() {} }
export class Raycaster {
  constructor() { this.ray = {}; }
  setFromCamera() {}
  intersectObjects() { return []; }
  intersectObject() { return []; }
}
export class AmbientLight extends MockObject3D {}
export class DirectionalLight extends MockObject3D {
  constructor() {
    super();
    this.shadow = {
      mapSize: { width: 0, height: 0 },
      camera: { left: 0, right: 0, top: 0, bottom: 0, near: 0, far: 0 },
    };
  }
}
export class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
}
export const DoubleSide = 2;
export const FrontSide = 0;
export const PCFSoftShadowMap = 2;
export const SRGBColorSpace = 'srgb';
export const NearestFilter = 1;
export const LinearFilter = 2;
