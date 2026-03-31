import { describe, it, expect } from 'vitest';
import { decodeDNA, encodeToDNA, DNA_SIZE } from './BlueprintDecoder.js';
import { BLOCK_TYPES } from '../../src/constants.js';
import { getPreset } from '../../src/Presets.js';

const GRID_WIDTH = 9;
const GRID_DEPTH = 9;
const MAX_LAYERS = 8;
const BUDGET = 600;
const opts = { gridWidth: GRID_WIDTH, gridDepth: GRID_DEPTH, maxLayers: MAX_LAYERS, budget: BUDGET };

function validateCastle(result) {
  const { layout, target } = result;

  // Target in bounds
  expect(target.x).toBeGreaterThanOrEqual(0);
  expect(target.x).toBeLessThan(GRID_WIDTH);
  expect(target.z).toBeGreaterThanOrEqual(0);
  expect(target.z).toBeLessThan(GRID_DEPTH);

  // Budget respected
  let cost = 0;
  for (const b of layout) {
    cost += BLOCK_TYPES[b.type]?.cost || 3;
  }
  expect(cost).toBeLessThanOrEqual(BUDGET);

  // All blocks in bounds
  for (const b of layout) {
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x).toBeLessThan(GRID_WIDTH);
    expect(b.z).toBeGreaterThanOrEqual(0);
    expect(b.z).toBeLessThan(GRID_DEPTH);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeLessThan(MAX_LAYERS);
  }

  // No blocks in target column
  const targetBlocks = layout.filter(b => b.x === target.x && b.z === target.z);
  expect(targetBlocks.length).toBe(0);

  // Support constraint: every block at y>0 has support at y-1
  const occupied = new Set();
  for (const b of layout) occupied.add(`${b.x},${b.y},${b.z}`);
  for (const b of layout) {
    if (b.y > 0) {
      expect(occupied.has(`${b.x},${b.y - 1},${b.z}`)).toBe(true);
    }
  }

  // No duplicate positions
  const positions = layout.map(b => `${b.x},${b.y},${b.z}`);
  expect(new Set(positions).size).toBe(positions.length);

  // Valid block types
  for (const b of layout) {
    expect(BLOCK_TYPES).toHaveProperty(b.type);
  }

  return { cost, blockCount: layout.length };
}

describe('BlueprintDecoder', () => {
  it('should produce valid castle from zero DNA', () => {
    const dna = new Float32Array(DNA_SIZE);
    const result = decodeDNA(dna, opts);
    validateCastle(result);
    expect(result.layout.length).toBeGreaterThan(0);
  });

  it('should produce valid castle from all-ones DNA', () => {
    const dna = new Float32Array(DNA_SIZE).fill(1);
    const result = decodeDNA(dna, opts);
    validateCastle(result);
  });

  it('should produce valid castle from all-negative-ones DNA', () => {
    const dna = new Float32Array(DNA_SIZE).fill(-1);
    const result = decodeDNA(dna, opts);
    validateCastle(result);
  });

  it('should produce valid castles from random DNA', () => {
    for (let trial = 0; trial < 50; trial++) {
      const dna = new Float32Array(DNA_SIZE);
      for (let i = 0; i < DNA_SIZE; i++) dna[i] = Math.random() * 2 - 1;
      const result = decodeDNA(dna, opts);
      validateCastle(result);
    }
  });

  it('should produce different castles from different DNA', () => {
    const dna1 = new Float32Array(DNA_SIZE);
    dna1[0] = -1; dna1[4] = -1;
    const dna2 = new Float32Array(DNA_SIZE);
    dna2[0] = 1; dna2[4] = 1;

    const r1 = decodeDNA(dna1, opts);
    const r2 = decodeDNA(dna2, opts);
    expect(r1.layout.length).not.toBe(r2.layout.length);
  });

  it('should be deterministic (same DNA = same castle)', () => {
    const dna = new Float32Array(DNA_SIZE);
    for (let i = 0; i < DNA_SIZE; i++) dna[i] = Math.sin(i) * 0.8;
    const r1 = decodeDNA(dna, opts);
    const r2 = decodeDNA(dna, opts);
    expect(r1.layout.length).toBe(r2.layout.length);
    expect(r1.target).toEqual(r2.target);
    for (let i = 0; i < r1.layout.length; i++) {
      expect(r1.layout[i]).toEqual(r2.layout[i]);
    }
  });

  it('should respect budget even with max density DNA', () => {
    const dna = new Float32Array(DNA_SIZE).fill(1);
    const result = decodeDNA(dna, opts);
    const { cost } = validateCastle(result);
    expect(cost).toBeLessThanOrEqual(BUDGET);
  });

  it('should encode presets to DNA and decode back to valid castles', () => {
    for (const presetName of ['KEEP', 'BUNKER', 'TOWER']) {
      const preset = getPreset(presetName, 'castle');
      const dna = encodeToDNA(preset, opts);
      expect(dna.length).toBe(DNA_SIZE);

      // All values in [-1, 1]
      for (let i = 0; i < DNA_SIZE; i++) {
        expect(dna[i]).toBeGreaterThanOrEqual(-1);
        expect(dna[i]).toBeLessThanOrEqual(1);
      }

      // Decode back produces valid castle
      const decoded = decodeDNA(dna, opts);
      validateCastle(decoded);
      expect(decoded.layout.length).toBeGreaterThan(10);
    }
  });

  it('should produce structurally varied castles across DNA space', () => {
    const heights = new Set();
    const densities = new Set();

    for (let i = 0; i < 20; i++) {
      const dna = new Float32Array(DNA_SIZE);
      for (let j = 0; j < DNA_SIZE; j++) dna[j] = Math.random() * 2 - 1;
      const result = decodeDNA(dna, opts);
      const maxY = Math.max(...result.layout.map(b => b.y), 0);
      heights.add(maxY);
      densities.add(Math.round(result.layout.length / 10) * 10);
    }

    // Should produce at least 3 distinct heights and densities
    expect(heights.size).toBeGreaterThanOrEqual(3);
    expect(densities.size).toBeGreaterThanOrEqual(3);
  });
});
