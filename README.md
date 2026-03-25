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

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Rendering | Three.js |
| Physics | cannon-es |
| Server | Node.js + Express + Socket.io |
| Bundler | Vite |
| Tests | Vitest |
| Package Manager | pnpm |

## Development

```bash
pnpm install
pnpm dev        # client (Vite) + server (Express) concurrently
pnpm test       # 278 tests
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
