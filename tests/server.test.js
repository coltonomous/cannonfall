import { describe, it, expect } from 'vitest';

describe('Shot Resolution Logic', () => {
  // Test the dual-client hit confirmation logic
  function resolveShot(reports, currentTurn) {
    const attacker = currentTurn;
    const defender = 1 - attacker;

    const attackerReport = reports.get(attacker);
    const defenderReport = reports.get(defender);

    let isHit;
    if (defenderReport) {
      isHit = defenderReport.hit;
    } else if (attackerReport) {
      isHit = attackerReport.hit;
    } else {
      isHit = false;
    }

    return { isHit, perfect: attackerReport?.perfect || false };
  }

  it('should trust defender when both report hit', () => {
    const reports = new Map();
    reports.set(0, { hit: true, perfect: false });
    reports.set(1, { hit: true, perfect: false });
    expect(resolveShot(reports, 0).isHit).toBe(true);
  });

  it('should trust defender when defender says miss', () => {
    const reports = new Map();
    reports.set(0, { hit: true, perfect: false }); // attacker says hit
    reports.set(1, { hit: false, perfect: false }); // defender says miss
    expect(resolveShot(reports, 0).isHit).toBe(false);
  });

  it('should trust attacker on timeout (defender missing)', () => {
    const reports = new Map();
    reports.set(0, { hit: true, perfect: true }); // only attacker reported
    const result = resolveShot(reports, 0);
    expect(result.isHit).toBe(true);
    expect(result.perfect).toBe(true);
  });

  it('should be miss when no one reports hit', () => {
    const reports = new Map();
    reports.set(0, { hit: false, perfect: false });
    reports.set(1, { hit: false, perfect: false });
    expect(resolveShot(reports, 0).isHit).toBe(false);
  });

  it('should be miss when no one reports at all', () => {
    const reports = new Map();
    expect(resolveShot(reports, 0).isHit).toBe(false);
  });
});
