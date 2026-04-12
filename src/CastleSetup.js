import * as THREE from 'three';
import { Castle } from './Castle.js';
import { CannonTower } from './CannonTower.js';
import * as C from './constants.js';

/**
 * Builds both castles, cannons, and minimap target markers.
 * Extracted from Game to isolate castle construction logic.
 *
 * @param {object} opts
 * @param {object} opts.sceneManager
 * @param {object} opts.physicsWorld
 * @param {object} opts.gameMode
 * @param {object} opts.data0 - Player 0's castle data
 * @param {object} opts.data1 - Player 1's castle data
 * @returns {{ castles: Castle[], cannons: CannonTower[], targetMarkers: THREE.Mesh[] }}
 */
export function buildBothCastles({ sceneManager, physicsWorld, gameMode, data0, data1 }) {
  const offsetX = gameMode.castleOffsetX || C.CASTLE_OFFSET_X;
  const castleOpts = {
    gridWidth: gameMode.gridWidth,
    gridDepth: gameMode.gridDepth,
    blockMassMultiplier: gameMode.blockMassMultiplier,
    blockDamping: gameMode.blockDamping,
    noiseConfig: gameMode.noiseConfig,
  };

  const castles = [
    new Castle(sceneManager, physicsWorld, -offsetX, gameMode.player0Color, castleOpts),
    new Castle(sceneManager, physicsWorld, offsetX, gameMode.player1Color, castleOpts),
  ];

  const mirror = !!gameMode.mirrorZ;
  castles[0].buildFromLayout(data0.layout, data0.target, data0.floor, mirror);
  castles[1].buildFromLayout(data1.layout, data1.target, data1.floor);

  // Cannon positions
  const gw = gameMode.gridWidth;
  const gd = gameMode.gridDepth;
  const cp0 = data0.cannonPos || { x: gw - 1, z: Math.floor(gd / 2) };
  const cp1Raw = data1.cannonPos || { x: gw - 1, z: Math.floor(gd / 2) };
  const cp1 = { x: gw - 1 - cp1Raw.x, z: cp1Raw.z };
  const pos0 = castles[0].getCannonWorldPosition(cp0.x, cp0.z);
  const pos1 = castles[1].getCannonWorldPosition(cp1.x, cp1.z);
  pos0.x += C.CANNON_OFFSET_FROM_CASTLE;
  pos1.x -= C.CANNON_OFFSET_FROM_CASTLE;

  const cannonColors = { baseColor: gameMode.cannonBaseColor, barrelColor: gameMode.cannonBarrelColor };
  const cannonStyle = gameMode.cannonStyle;
  const cannons = [
    new CannonTower(sceneManager.scene, pos0, 1, cannonColors, cannonStyle),
    new CannonTower(sceneManager.scene, pos1, -1, cannonColors, cannonStyle),
  ];

  // Cannons on layer 1 — visible to main camera, hidden from minimap
  for (const c of cannons) {
    c.group.traverse(obj => { obj.layers.set(1); });
  }

  // Target markers on layer 2 — minimap only
  const targetMarkers = [];
  for (let i = 0; i < 2; i++) {
    const tp = castles[i].getTargetPosition();
    if (!tp) continue;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(C.MINIMAP_RING_INNER, C.MINIMAP_RING_OUTER, 16),
      new THREE.MeshBasicMaterial({ color: 0xff2222, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(tp.x, C.MINIMAP_RING_Y, tp.z);
    ring.layers.set(2);
    sceneManager.scene.add(ring);
    targetMarkers.push(ring);
  }

  return { castles, cannons, targetMarkers };
}
