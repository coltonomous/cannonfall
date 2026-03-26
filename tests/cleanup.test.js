import { describe, it, expect, beforeEach } from 'vitest';

// ── Replicated cleanupFallenBlocks logic from BattleController.js ──

function cleanupFallenBlocks(castles, gameMode) {
  const debrisField = gameMode.debrisField;
  const boundsX = debrisField ? 100 : 60;
  const boundsZ = debrisField ? 100 : 60;
  const disposed = [];

  for (const castle of castles) {
    if (!castle) continue;
    for (let i = castle.blocks.length - 1; i >= 0; i--) {
      const { mesh, body } = castle.blocks[i];

      if (debrisField && body.mass > 0) {
        body.allowSleep = false;
      }

      // Shield fade
      if (body.isShield && mesh && body.mass > 0) {
        const speed = body.velocity.length();
        if (speed > 0.5) body._shieldHit = true;
        if (body._shieldHit) {
          mesh.material.opacity = Math.max(0, mesh.material.opacity - 0.03);
          mesh.material.transparent = true;
          if (mesh.material.opacity <= 0) {
            disposed.push({ type: 'shield', mesh, body });
            castle.blocks.splice(i, 1);
            continue;
          }
        }
      }

      // Out of bounds
      if (body.position.y < gameMode.outOfBoundsY || Math.abs(body.position.x) > boundsX || Math.abs(body.position.z) > boundsZ) {
        if (mesh) {
          disposed.push({ type: 'fallen', mesh, body });
        }
        castle.blocks.splice(i, 1);
      }
    }
  }

  return disposed;
}

// ── Mock helpers ─────────────────────────────────────

function makeBlock(opts = {}) {
  return {
    mesh: {
      material: {
        opacity: opts.opacity ?? 1,
        transparent: false,
        _disposed: false,
        dispose() { this._disposed = true; },
      },
    },
    body: {
      position: { x: opts.x ?? 0, y: opts.y ?? 5, z: opts.z ?? 0 },
      velocity: { length: () => opts.speed ?? 0 },
      mass: opts.mass ?? 2,
      isShield: opts.isShield ?? false,
      _shieldHit: opts._shieldHit ?? false,
      allowSleep: true,
    },
  };
}

function makeCastle(blocks) {
  return { blocks: [...blocks] };
}

const normalMode = { outOfBoundsY: -20, debrisField: false };
const spaceMode = { outOfBoundsY: -100, debrisField: true };

// ── Tests ────────────────────────────────────────────

describe('cleanupFallenBlocks', () => {
  describe('out-of-bounds removal', () => {
    it('removes blocks below outOfBoundsY', () => {
      const block = makeBlock({ y: -25 });
      const castle = makeCastle([block]);
      const disposed = cleanupFallenBlocks([castle], normalMode);

      expect(castle.blocks.length).toBe(0);
      expect(disposed.length).toBe(1);
      expect(disposed[0].type).toBe('fallen');
    });

    it('keeps blocks above outOfBoundsY', () => {
      const block = makeBlock({ y: 5 });
      const castle = makeCastle([block]);
      cleanupFallenBlocks([castle], normalMode);

      expect(castle.blocks.length).toBe(1);
    });

    it('removes blocks beyond X bounds', () => {
      const block = makeBlock({ x: 65 });
      const castle = makeCastle([block]);
      cleanupFallenBlocks([castle], normalMode);

      expect(castle.blocks.length).toBe(0);
    });

    it('removes blocks beyond negative X bounds', () => {
      const block = makeBlock({ x: -65 });
      const castle = makeCastle([block]);
      cleanupFallenBlocks([castle], normalMode);

      expect(castle.blocks.length).toBe(0);
    });

    it('removes blocks beyond Z bounds', () => {
      const block = makeBlock({ z: 65 });
      const castle = makeCastle([block]);
      cleanupFallenBlocks([castle], normalMode);

      expect(castle.blocks.length).toBe(0);
    });

    it('returns disposed entries for material cleanup', () => {
      const block = makeBlock({ y: -25 });
      const castle = makeCastle([block]);
      const disposed = cleanupFallenBlocks([castle], normalMode);

      expect(disposed.length).toBe(1);
      expect(disposed[0].mesh).toBe(block.mesh);
    });

    it('uses wider bounds in debris field mode', () => {
      const block = makeBlock({ x: 80 });
      const castle = makeCastle([block]);
      cleanupFallenBlocks([castle], spaceMode);

      // 80 < 100 (debris field bounds), so should keep
      expect(castle.blocks.length).toBe(1);
    });
  });

  describe('shield fade mechanics', () => {
    it('marks shield as hit when velocity exceeds threshold', () => {
      const block = makeBlock({ isShield: true, speed: 1.0, mass: 0.3 });
      const castle = makeCastle([block]);
      cleanupFallenBlocks([castle], normalMode);

      expect(block.body._shieldHit).toBe(true);
    });

    it('does not mark shield as hit when velocity is low', () => {
      const block = makeBlock({ isShield: true, speed: 0.3, mass: 0.3 });
      const castle = makeCastle([block]);
      cleanupFallenBlocks([castle], normalMode);

      expect(block.body._shieldHit).toBe(false);
    });

    it('reduces shield opacity when hit', () => {
      const block = makeBlock({ isShield: true, mass: 0.3, _shieldHit: true, opacity: 0.35 });
      block.body._shieldHit = true;
      const castle = makeCastle([block]);
      cleanupFallenBlocks([castle], normalMode);

      expect(block.mesh.material.opacity).toBeCloseTo(0.32, 2);
      expect(block.mesh.material.transparent).toBe(true);
    });

    it('removes shield when opacity reaches zero', () => {
      const block = makeBlock({ isShield: true, mass: 0.3, _shieldHit: true, opacity: 0.02 });
      block.body._shieldHit = true;
      const castle = makeCastle([block]);
      const disposed = cleanupFallenBlocks([castle], normalMode);

      expect(castle.blocks.length).toBe(0);
      expect(disposed.length).toBe(1);
      expect(disposed[0].type).toBe('shield');
    });
  });

  describe('debris field mode', () => {
    it('disables sleep for dynamic blocks', () => {
      const block = makeBlock({ mass: 2 });
      const castle = makeCastle([block]);
      cleanupFallenBlocks([castle], spaceMode);

      expect(block.body.allowSleep).toBe(false);
    });

    it('does not disable sleep for static blocks', () => {
      const block = makeBlock({ mass: 0 });
      const castle = makeCastle([block]);
      cleanupFallenBlocks([castle], spaceMode);

      expect(block.body.allowSleep).toBe(true);
    });
  });

  describe('multi-castle handling', () => {
    it('processes both castles independently', () => {
      const b1 = makeBlock({ y: -25 });
      const b2 = makeBlock({ y: 5 });
      const b3 = makeBlock({ y: -30 });
      const castle0 = makeCastle([b1, b2]);
      const castle1 = makeCastle([b3]);

      cleanupFallenBlocks([castle0, castle1], normalMode);

      expect(castle0.blocks.length).toBe(1);
      expect(castle1.blocks.length).toBe(0);
    });

    it('skips null castles', () => {
      expect(() => cleanupFallenBlocks([null, null], normalMode)).not.toThrow();
    });
  });
});
