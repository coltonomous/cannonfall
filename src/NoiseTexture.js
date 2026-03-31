/**
 * Procedural noise texture generator using 2D simplex noise + fBm.
 *
 * Generates roughnessMap and bumpMap CanvasTextures from a mode-specific
 * noise config. Self-contained — no external noise library needed.
 */

import * as THREE from 'three';

// ── Simplex 2D noise (Gustavson / Ashima, public domain) ──────────────

const GRAD3 = [
  [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
  [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
  [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
];

function buildPermTable(seed) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fisher-Yates shuffle seeded with simple LCG
  let s = seed | 0;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807 + 0) & 0x7fffffff;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  // Double the table to avoid index wrapping
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }
  return { perm, permMod12 };
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

function createNoise2D(seed) {
  const { perm, permMod12 } = buildPermTable(seed);

  return function noise2D(x, y) {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let n0 = 0, n1 = 0, n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      const gi0 = permMod12[ii + perm[jj]];
      n0 = t0 * t0 * (GRAD3[gi0][0] * x0 + GRAD3[gi0][1] * y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      const gi1 = permMod12[ii + i1 + perm[jj + j1]];
      n1 = t1 * t1 * (GRAD3[gi1][0] * x1 + GRAD3[gi1][1] * y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      const gi2 = permMod12[ii + 1 + perm[jj + 1]];
      n2 = t2 * t2 * (GRAD3[gi2][0] * x2 + GRAD3[gi2][1] * y2);
    }

    return 70 * (n0 + n1 + n2); // [-1, 1]
  };
}

// ── Fractional Brownian Motion ────────────────────────────

function fbm(noise, x, y, octaves, lacunarity = 2.0, gain = 0.5) {
  let value = 0, amp = 1, freq = 1, maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    value += amp * noise(x * freq, y * freq);
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return value / maxAmp;
}

// ── Canvas texture generation ─────────────────────────────

const TEX_SIZE = 128;

function generateNoiseCanvas(width, height, config, seed) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null; // headless / test environment
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  const noise = createNoise2D(seed);
  const { scaleX, scaleY, octaves, amplitude, lacunarity = 2.0, gain = 0.5 } = config;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const nx = (px / width) * scaleX;
      const ny = (py / height) * scaleY;
      const n = fbm(noise, nx, ny, octaves, lacunarity, gain);
      // Map [-1,1] noise to [0,255], modulated by amplitude
      const v = Math.round(128 + 127 * n * amplitude);
      const clamped = Math.max(0, Math.min(255, v));
      const idx = (py * width + px) * 4;
      data[idx] = clamped;
      data[idx + 1] = clamped;
      data[idx + 2] = clamped;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Generate roughnessMap + bumpMap textures for a game mode.
 * @param {Object} noiseConfig - from GameModes.js noiseConfig
 * @returns {{ roughnessMap: THREE.CanvasTexture, bumpMap: THREE.CanvasTexture }}
 */
export function generateModeTextures(noiseConfig) {
  const roughCanvas = generateNoiseCanvas(TEX_SIZE, TEX_SIZE, noiseConfig, 1);
  const bumpCanvas = generateNoiseCanvas(TEX_SIZE, TEX_SIZE, noiseConfig, 2);

  // Gracefully degrade in headless / test environments without canvas support
  if (!roughCanvas || !bumpCanvas) return null;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;

  return { roughnessMap, bumpMap };
}
