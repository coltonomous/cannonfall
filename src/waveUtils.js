/**
 * Shared wave height formula — used by both PhysicsWorld (buoyancy) and
 * SceneManager (vertex displacement) so they stay in sync.
 *
 * @param {number} x   World-space X coordinate
 * @param {number} z   World-space Z coordinate
 * @param {number} t   Elapsed time (seconds)
 * @param {number} swell  Swell multiplier (typically oscillates 0.6–1.4)
 * @returns {number} Vertical displacement at this position
 */
export function waveHeight(x, z, t, swell) {
  return Math.sin(x * 0.15 + t * 0.8) * 0.4 * swell
       + Math.cos(z * 0.12 + t * 0.6) * 0.25 * swell
       + Math.sin(x * 0.08 + z * 0.06 + t * 0.4) * 0.15;
}

/**
 * Compute the swell multiplier at a given time.
 * Oscillates between 0.6 and 1.4 over ~30 seconds.
 */
export function swellAtTime(t) {
  return 1.0 + 0.4 * Math.sin(t * 0.2);
}
