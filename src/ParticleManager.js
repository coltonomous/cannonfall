import * as THREE from 'three';

export class ParticleManager {
  constructor(scene, maxParticles = 2000) {
    this.maxParticles = maxParticles;
    this.count = 0;

    this.positions = new Float32Array(maxParticles * 3);
    this.velocities = new Float32Array(maxParticles * 3);
    this.colors = new Float32Array(maxParticles * 3);
    this.lives = new Float32Array(maxParticles);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.25,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
      depthWrite: false,
    });

    this.mesh = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.geo = geo;
  }

  // pos: THREE.Vector3, vel: {x,y,z}, spread: number, color: {r,g,b} (0-1), count: int, life: seconds
  emit(pos, vel, spread, color, count, life) {
    for (let i = 0; i < count; i++) {
      if (this.count >= this.maxParticles) return;
      const idx = this.count++;
      const i3 = idx * 3;

      this.positions[i3]     = pos.x + (Math.random() - 0.5) * 0.3;
      this.positions[i3 + 1] = pos.y + (Math.random() - 0.5) * 0.3;
      this.positions[i3 + 2] = pos.z + (Math.random() - 0.5) * 0.3;

      this.velocities[i3]     = (vel.x || 0) + (Math.random() - 0.5) * spread;
      this.velocities[i3 + 1] = (vel.y || 0) + (Math.random() - 0.5) * spread;
      this.velocities[i3 + 2] = (vel.z || 0) + (Math.random() - 0.5) * spread;

      this.colors[i3]     = Math.min(1, Math.max(0, color.r + (Math.random() - 0.5) * 0.15));
      this.colors[i3 + 1] = Math.min(1, Math.max(0, color.g + (Math.random() - 0.5) * 0.15));
      this.colors[i3 + 2] = Math.min(1, Math.max(0, color.b + (Math.random() - 0.5) * 0.15));

      this.lives[idx] = life * (0.5 + Math.random());
    }
  }

  update(dt) {
    // Update positions, apply gravity, compact dead particles
    let write = 0;
    for (let i = 0; i < this.count; i++) {
      this.lives[i] -= dt;
      if (this.lives[i] <= 0) continue;

      const i3 = i * 3;

      // Move
      this.positions[i3]     += this.velocities[i3] * dt;
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;

      // Gravity
      this.velocities[i3 + 1] -= 6 * dt;

      // Drag
      this.velocities[i3]     *= 0.995;
      this.velocities[i3 + 2] *= 0.995;

      // Compact: copy to write position if needed
      if (write !== i) {
        const w3 = write * 3;
        this.positions[w3]     = this.positions[i3];
        this.positions[w3 + 1] = this.positions[i3 + 1];
        this.positions[w3 + 2] = this.positions[i3 + 2];
        this.velocities[w3]     = this.velocities[i3];
        this.velocities[w3 + 1] = this.velocities[i3 + 1];
        this.velocities[w3 + 2] = this.velocities[i3 + 2];
        this.colors[w3]     = this.colors[i3];
        this.colors[w3 + 1] = this.colors[i3 + 1];
        this.colors[w3 + 2] = this.colors[i3 + 2];
        this.lives[write] = this.lives[i];
      }
      write++;
    }
    this.count = write;

    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.setDrawRange(0, this.count);
  }

  clear() {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }
}
