// Shared perfect shot visuals — consistent gold across all modes
const PERFECT_SHOT = {
  perfectColor: 0xffd700,
  perfectEmissive: 0xaa8800,
  perfectEmissiveIntensity: 0.3,
  perfectMuzzleColor: { r: 1, g: 0.85, b: 0.1 },
};

// Shared explosion settings (used when explosiveProjectile: true)
const EXPLOSION = {
  blastRadius: 4,
  blastForce: 12,
  perfectBlastRadius: 6,
  perfectBlastForce: 25,
  explosionDelay: 2500,
};

export const GAME_MODES = {
  CASTLE: {
    id: 'castle',
    label: 'Castle Siege',
    structureLabel: 'Castle',

    backgroundColor: 0x87CEEB,
    fogNear: 100,
    fogFar: 200,
    hasGround: true,
    groundColor: 0x4a7c3f,

    ambientIntensity: 0.4,
    dirIntensity: 0.8,
    dirPosition: [10, 20, 10],

    gravity: -9.82,
    friction: 0.5,
    restitution: 0.3,
    explosiveProjectile: false,

    player0Color: 0x8b7355,
    player1Color: 0x6b8e9b,
    floorColor: 0x8b7355,

    cannonBaseColor: 0x444444,
    cannonBarrelColor: 0x333333,

    projectileColor: 0x222222,
    projectileMetalness: 0.9,
    projectileRoughness: 0.1,
    projectileEmissive: null,
    projectileEmissiveIntensity: 0,
    projectileGlow: false,
    ...PERFECT_SHOT,

    muzzleColor: { r: 1, g: 0.7, b: 0.2 },
    impactColor: { r: 0.6, g: 0.5, b: 0.35 },
    trailColor: { r: 0.5, g: 0.5, b: 0.5 },

    presets: ['KEEP', 'BUNKER', 'TOWER'],
    excludeBlocks: ['THRUSTER', 'SHIELD'],

    outOfBoundsY: -5,
    castleOffsetX: 20,
    gridWidth: 9,
    gridDepth: 9,
    budget: 600,
    maxLayers: 8,

    ...EXPLOSION,
  },

  PIRATE: {
    id: 'pirate',
    label: 'Pirate Cove',
    structureLabel: 'Ship',

    backgroundColor: 0x4a7a9b,
    fogNear: 80,
    fogFar: 180,
    hasGround: true,
    groundColor: 0x1a6080,
    waterSurface: true,

    ambientIntensity: 0.45,
    dirIntensity: 0.9,
    dirPosition: [-8, 15, 12],

    gravity: -9.82,
    friction: 0.4,
    restitution: 0.4,
    explosiveProjectile: false,

    player0Color: 0x8b6340,
    player1Color: 0x6b4226,
    floorColor: 0x6b4e37,

    cannonBaseColor: 0x8b6914,
    cannonBarrelColor: 0x704e0e,

    projectileColor: 0x333333,
    projectileMetalness: 0.8,
    projectileRoughness: 0.2,
    projectileEmissive: null,
    projectileEmissiveIntensity: 0,
    projectileGlow: false,
    ...PERFECT_SHOT,

    muzzleColor: { r: 1, g: 0.6, b: 0.15 },
    impactColor: { r: 0.7, g: 0.5, b: 0.25 },
    trailColor: { r: 0.4, g: 0.4, b: 0.4 },

    presets: ['GALLEON', 'SLOOP', 'FORTRESS'],
    excludeBlocks: ['THRUSTER', 'SHIELD'],

    outOfBoundsY: -5,
    castleOffsetX: 16,
    gridWidth: 7,
    gridDepth: 11,
    budget: 500,
    maxLayers: 6,

    ...EXPLOSION,
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
    explosiveProjectile: true,
    debrisField: true,

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
    ...PERFECT_SHOT,

    muzzleColor: { r: 0.2, g: 0.8, b: 1.0 },
    impactColor: { r: 0.3, g: 0.6, b: 1.0 },
    trailColor: { r: 0.2, g: 0.6, b: 0.9 },

    presets: ['CORVETTE', 'FRIGATE', 'CRUISER'],
    excludeBlocks: [],

    outOfBoundsY: -60,
    castleOffsetX: 28,
    gridWidth: 7,
    gridDepth: 13,
    budget: 600,
    maxLayers: 5,

    ...EXPLOSION,
  },
};
