# Cannonfall

3D turn-based artillery game. Build a castle, hide a target, fire cannons to destroy your opponent's defenses. Three game modes, lobby matchmaking, local and online multiplayer.

**Play it:** [cannonfall.coltonomous.com](https://cannonfall.coltonomous.com)

## Game Modes

- **Castle Siege** — Classic mode. Gravity, green fields, stone castles. Punch through walls to hit the target.
- **Pirate Cove** — Ships on water with wave physics. Decks rock with the swell, cannonballs punch through hulls.
- **Space Battle** — Zero gravity. Projectiles explode on contact, blasting blocks apart. Thrusters and shields available.

## How It Works

1. **Lobby** — Enter your name, create or join a game. Optional password for private matches.
2. **Build** — Place blocks on a grid to protect your target. 14 block types (cubes, ramps, walls, columns, shields, thrusters, etc.) with a point budget. Load a preset or build from scratch.
3. **Battle** — Aim with WASD/arrows, hold space to charge power, release to fire. Hit the sweet spot (62–70% power) for a perfect shot that deals double damage.
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
pnpm test       # Vitest: server, online client flow, physics, presets, UI
```

## Deploy

Deployed via GitHub Actions on push to `master`. The workflow runs tests, rsyncs to EC2, and rebuilds the Docker container with a health-check gate.

Reverse proxy (Caddy) is managed separately via the [infra repo](https://github.com/coltonomous/infra).

## Online Play

The server (`server/game-server.js`) holds all game state in memory and validates every message against the shared rules in `shared/`: castles must fit the mode's grid, block types and budget; only the player whose turn it is can fire; the server decides whether a shot was a perfect shot. Both clients simulate each shot with the same inputs and report the result. The defender's report decides whether its target was hit, with the attacker's report as a fallback if the defender never answers. After a hit, only the damaged player can move their target.

## Project Structure

```
cannonfall/
├── server.js               # Entry point: starts the game server, graceful shutdown
├── server/
│   ├── game-server.js      # Express + Socket.io: lobby, matchmaking, turns, shot resolution
│   └── logger.js           # Structured JSON logging
├── shared/                 # Imported by both client and server
│   ├── constants.js        # Aim/power limits, block catalog, per-mode build rules, server limits
│   └── rules.js            # Perfect-shot rule, castle and target validation
├── src/                    # Browser client
│   ├── main.js             # Entry point
│   ├── Game.js             # Game flow orchestration
│   ├── StateMachine.js     # Allowed game state transitions
│   ├── BattleController.js # Firing, projectile tracking, hit detection
│   ├── Network.js          # Socket.io client
│   ├── NetworkHandler.js   # Server events → game state
│   ├── CastleBuilder.js    # Build phase (BuilderUI.js for its DOM)
│   ├── Castle.js           # Castle construction from layouts (CastleSetup.js places both sides)
│   ├── GameModes.js        # Mode configs (castle/pirate/space)
│   ├── AI.js               # Heuristic AI opponent (AIController.js wires it and the RL agent in)
│   ├── *Presets.js         # Built-in castles and ships
│   └── ...                 # Rendering, physics, input, particles, UI
├── training/               # RL training pipeline — see training/README.md
└── tests/                  # Vitest suites (helpers/ has the THREE mock and DOM loader)
```
