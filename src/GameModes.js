export const GAME_MODES = {
  CASTLE: {
    id: 'castle',
    label: 'Castle Siege',
    structureLabel: 'Castle',

    // Scene
    backgroundColor: 0x87CEEB,
    fogNear: 100,
    fogFar: 200,
    hasGround: true,
    groundColor: 0x4a7c3f,

    // Lighting
    ambientIntensity: 0.4,
    dirIntensity: 0.8,
    dirPosition: [10, 20, 10],

    // Physics
    gravity: -9.82,
    friction: 0.5,
    restitution: 0.3,
    explosiveProjectile: false, // projectile bounces off blocks

    // Colors
    player0Color: 0x8b7355,
    player1Color: 0x6b8e9b,
    floorColor: 0x8b7355,

    // Cannon
    cannonBaseColor: 0x444444,
    cannonBarrelColor: 0x333333,

    // Projectile
    projectileColor: 0x222222,
    projectileMetalness: 0.9,
    projectileRoughness: 0.1,
    projectileEmissive: null,
    projectileEmissiveIntensity: 0,
    projectileGlow: false,
    perfectColor: 0xffd700,
    perfectEmissive: 0xaa8800,
    perfectEmissiveIntensity: 0.3,

    // Particles
    muzzleColor: { r: 1, g: 0.7, b: 0.2 },
    perfectMuzzleColor: { r: 1, g: 0.85, b: 0.1 },
    impactColor: { r: 0.6, g: 0.5, b: 0.35 },
    trailColor: { r: 0.5, g: 0.5, b: 0.5 },

    // Presets & blocks
    presets: ['KEEP', 'BUNKER', 'TOWER'],
    excludeBlocks: ['THRUSTER', 'SHIELD'], // blocks not available in this mode

    // Bounds
    outOfBoundsY: -5,

    // Grid
    gridWidth: 9,
    gridDepth: 9,

    // Building
    budget: 500,
    maxLayers: 8,

    // Explosion (only used when explosiveProjectile: true)
    blastRadius: 4,
    blastForce: 12,
    perfectBlastRadius: 6,
    perfectBlastForce: 25,
    explosionDelay: 2500,
  },

  SPACE: {
    id: 'space',
    label: 'Space Battle',
    structureLabel: 'Ship',

    backgroundColor: 0x050510,
    fogNear: null,
    fogFar: null,
    hasGround: false,
    groundColor: null,

    ambientIntensity: 0.2,
    dirIntensity: 0.5,
    dirPosition: [15, 10, 5],

    gravity: -0.5,
    friction: 0.9,
    restitution: 0.05,
    explosiveProjectile: true, // projectile explodes on impact

    player0Color: 0x2266aa,
    player1Color: 0xaa3344,
    floorColor: 0x334455,

    cannonBaseColor: 0x224466,
    cannonBarrelColor: 0x1a3a5a,

    projectileColor: 0x44ffff,
    projectileMetalness: 0.1,
    projectileRoughness: 0.0,
    projectileEmissive: 0x00ffff,
    projectileEmissiveIntensity: 0.6,
    projectileGlow: true,
    perfectColor: 0xff44ff,
    perfectEmissive: 0xff00ff,
    perfectEmissiveIntensity: 0.8,

    muzzleColor: { r: 0.2, g: 0.8, b: 1.0 },
    perfectMuzzleColor: { r: 1.0, g: 0.3, b: 1.0 },
    impactColor: { r: 0.3, g: 0.6, b: 1.0 },
    trailColor: { r: 0.2, g: 0.6, b: 0.9 },

    presets: ['CORVETTE', 'FRIGATE', 'CRUISER'],
    excludeBlocks: [], // all blocks available

    outOfBoundsY: -60,

    gridWidth: 7,
    gridDepth: 13,

    budget: 500,
    maxLayers: 5,

    blastRadius: 4,
    blastForce: 12,
    perfectBlastRadius: 6,
    perfectBlastForce: 25,
    explosionDelay: 2500,
  },
};
