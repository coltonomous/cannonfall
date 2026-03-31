# Cannonfall

3D turn-based artillery game. Build a castle, hide a target, fire cannons to destroy your opponent's defenses. Three game modes, lobby matchmaking, local and online multiplayer.

**Play it:** [cannonfall.coltonomous.com](https://cannonfall.coltonomous.com)

## Game Modes

- **Castle Siege** — Classic mode. Gravity, green fields, stone castles. Punch through walls to hit the target.
- **Pirate Cove** — Ships on water with wave physics. Decks rock with the swell, cannonballs punch through hulls.
- **Space Battle** — Zero gravity. Projectiles explode on contact, blasting blocks apart. Thrusters and shields available.

## How It Works

1. **Lobby** — Enter your name, create or join a game. Optional password for private matches.
2. **Build** — Place blocks on a grid to protect your target. 15 block types (cubes, ramps, walls, columns, shields, thrusters, etc.) with a point budget. Load a preset or build from scratch.
3. **Battle** — Aim with WASD/arrows, hold space to charge power, release to fire. Hit the sweet spot (80-88% power) for a perfect shot that deals double damage.
4. **Win** — First to deplete the opponent's 3 HP wins. After each hit, the defender repositions their target.

## RL Agent

An AI opponent trained via reinforcement learning (PPO) plays directly in the browser. The training pipeline runs headless cannon-es physics through a Python↔Node.js bridge, with curriculum learning that ramps both layout difficulty and opponent skill. The trained model is exported to ONNX and loaded in-browser via onnxruntime-web — the browser samples from the model's learned policy distribution for varied, non-deterministic play. Select "RL Agent" in the difficulty picker to play against it (Castle mode only).

An experimental adversarial training system pits a **builder agent** (designs castles via a 32-parameter "DNA" blueprint) against the cannon-firing **attacker agent** in a PSRO-lite loop, enabling the discovery of novel castle designs that emerge from competitive pressure rather than hand-crafting.

See [training/README.md](training/README.md) for the full training pipeline.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Rendering | Three.js |
| Physics | cannon-es |
| Server | Node.js + Express + Socket.io |
| RL Training | Stable Baselines3 (PPO) + Gymnasium |
| Model Inference | ONNX Runtime Web |
| Bundler | Vite |
| Tests | Vitest |
| Package Manager | pnpm |

## Development

```bash
pnpm install
pnpm dev        # client (Vite) + server (Express) concurrently
pnpm test       # 451 tests
```

## Deploy

Deployed via GitHub Actions on push to `master`. The workflow runs tests, rsyncs to EC2, and rebuilds the Docker container with a health-check gate.

Reverse proxy (Caddy) is managed separately via the [infra repo](https://github.com/coltonomous/infra).

## Project Structure

```
cannonfall/
├── server.js              # Express + Socket.io server, lobby, game state
├── index.html             # Game shell
├── Dockerfile
├── docker-compose.yml
├── src/
│   ├── main.js            # Entry point
│   ├── Game.js            # State machine, game flow orchestration
│   ├── BattleController.js # Firing, projectile tracking, hit detection
│   ├── CastleBuilder.js   # Build phase UI and block placement
│   ├── Castle.js          # Castle construction from layouts
│   ├── GameModes.js       # Mode configs (castle/pirate/space)
│   ├── SceneManager.js    # Three.js scene, camera, rendering
│   ├── PhysicsWorld.js    # cannon-es wrapper, water physics
│   ├── Network.js         # Socket.io client
│   ├── UI.js              # DOM state management
│   ├── Projectile.js      # Cannonball mesh + physics
│   ├── CannonTower.js     # Cannon model and aiming
│   ├── InputHandler.js    # Keyboard input
│   ├── ParticleManager.js # Particle effects
│   ├── constants.js       # Named constants
│   ├── Presets.js         # Castle presets
│   ├── PiratePresets.js   # Ship presets
│   ├── SpacePresets.js    # Space ship presets
│   ├── BlockGeometry.js   # Three.js geometries for block types
│   ├── PresetHelpers.js   # Preset generation utilities
│   ├── OrbitController.js # Camera orbit for build phase
│   ├── TargetRepositioner.js # Post-hit target repositioning
│   └── styles.css
├── training/
│   ├── train.py           # PPO training (parallel envs, curriculum)
│   ├── cannonfall_env.py  # Gymnasium environment
│   ├── export_onnx.py     # Export model to ONNX for browser
│   ├── env/
│   │   ├── HeadlessGame.js # Headless cannon-es physics sim
│   │   └── bridge.js      # Python↔Node JSON protocol
│   └── inference/
│       └── OnnxAI.js      # In-browser ONNX inference
└── tests/
    ├── integration.test.js
    ├── lobby.test.js
    ├── server.test.js
    ├── gameflow.test.js
    ├── gamemodes.test.js
    ├── physics.test.js
    ├── blocktypes.test.js
    ├── presets.test.js
    ├── presethelpers.test.js
    └── frontend.test.js
```
