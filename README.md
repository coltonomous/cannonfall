# Cannonfall

## Overview

A 3D turn-based artillery game where two players build castles out of blocks, then take turns firing cannons to destroy each other's defenses and hit a target hidden within. Inspired by classic Neopets castle battle games. Built with Three.js and cannon-es for physics.

## Game Modes

**Online Match** — Two players connect via WebSocket (Socket.io), build simultaneously on their own screens, then battle in real-time turns.

**Local Match** — Two players share one device. Build phases are sequential with a "pass the device" screen between them to hide castle designs. Battle phase alternates control between players.

## Game Flow

```
Menu → Select Mode [Online | Local]
  → Build Phase (design your castle, place your target)
  → Battle Phase (turn-based cannon firing)
  → Result Screen → Play Again / Menu
```

## Build Phase

Each player is given a 7x7 base footprint and a point budget of **120 points** to construct a castle.

### Block Types

| Shape | Size | Cost | Notes |
|-------|------|------|-------|
| Cube | 1x1x1 | 3 pts | Standard block, most durable |
| Half-slab | 1x0.5x1 | 1 pt | Low cover, catwalks, target platforms |
| Wall | 1x1x0.5 | 2 pts | Thin wall, space-efficient but fragile |
| Ramp | 1x1x1 wedge | 2 pts | Deflects shots, interesting physics |

- Blocks can be placed on layers 1-5 above a fixed solid floor (layer 0)
- All blocks can be rotated in 4 orientations around the Y-axis
- Blocks must be placed on the grid and rest on either the floor or another block

### Target Placement Rules

- Must be at ground level (y=0) or on any flat surface (top of a cube or slab)
- Must be adjacent to or touching at least one placed block
- Cannot be positioned on the far side of the castle from the attacker — must sit within the middle ~60% of the castle's X-depth to prevent hiding it completely behind the structure

### Preset Castles

Players can select a preset instead of building from scratch:

1. **Keep** — Classic castle. Thick perimeter walls, crenellations on top, target at ground floor center. Straightforward to attack, but requires punching through heavy walls.
2. **Bunker** — Low-profile. Dense slab and ramp roof to deflect incoming shots downward. Target at ground level. Hard to lob over, must find an angle.
3. **Tower** — Tall, narrow structure. Target elevated on an interior catwalk (slab). Harder to angle a shot into the vertical gap.

### Builder UI

- Isometric or top-down camera focused on the build area
- Layer selector to switch active vertical layer (1-5)
- Block palette showing available shapes with rotation control
- Click grid cells to place or remove blocks
- Drag to position target
- Budget counter showing remaining points
- "Ready" button to finalize

### Local Mode Build Privacy

Player 1 builds → screen goes to "Pass to Player 2" overlay → Player 2 builds → battle begins. Neither player sees the other's build process.

## Battle Phase

### Scene Layout

- Two castles face each other along the X-axis, separated by ~40 units
- Player 1's castle at x=-20, Player 2's at x=+20
- Each cannon floats above the center of its owner's castle
- Targets glow red inside the castles (visible but may not have direct line of sight from the cannon)
- Green ground plane, sky-blue background, directional lighting with shadows

### Cannon & Aiming

The cannon is a floating turret above the castle center (y≈8). On your turn:

- **A/D or Left/Right arrows** — rotate cannon horizontally (yaw, ±45°)
- **W/S or Up/Down arrows** — adjust cannon elevation (pitch, 5°–60°)
- **Q/E** — decrease/increase power
- **Space** — fire

A trajectory preview line (dashed) shows the projected arc while aiming.

### Physics

- Powered by cannon-es
- Blocks are dynamic rigid bodies — they tumble, fall, and pile up on impact
- Base floor (layer 0) is static/kinematic — never moves
- Cannonball is a heavy sphere (mass 5 vs block mass 1) that punches through structures
- No ammo limit — turns continue until a target is hit
- Blocks start in sleep mode for performance, wake on collision
- Gravity at standard 9.82 m/s²

### Turn Flow

1. Active player aims and fires
2. Cannonball flies, collides with blocks, physics simulates destruction
3. If cannonball contacts the target sphere → game over, firing player wins
4. If miss → physics settles (~5-6 seconds), then turn passes to opponent
5. Repeat

### Camera

- **Your turn:** Camera positioned behind and above your cannon, looking toward the opponent's castle
- **Opponent's turn:** Camera shows your castle from a defensive angle so you can watch the incoming shot
- Fixed spectator camera also an option (overhead view showing both castles)

### Win Condition

First player to hit the opponent's target with a cannonball wins. Blocks falling onto the target do not count — only a direct cannonball hit.

## Networking (Online Mode)

**Stack:** Node.js + Express + Socket.io

- Server manages a matchmaking queue, pairs players into rooms
- Both players build simultaneously; game starts when both click "Ready"
- On fire: client sends `{yaw, pitch, power}` to server, server relays to opponent
- Both clients run physics locally from identical initial conditions
- Hit detection reported by client, server broadcasts game-over
- Turn advancement managed by server with a timeout (~6 seconds post-fire)
- Opponent disconnect = win by default

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Rendering | Three.js |
| Physics | cannon-es |
| Server | Node.js + Express + Socket.io |
| Bundler | Vite |
| Client networking | socket.io-client |

## Development

```bash
# Install dependencies
npm install

# Development (client + server concurrently)
npm run dev

# Production build
npm run build
npm start
```

## Docker

```bash
# Build and run
docker compose up --build

# Stop
docker compose down
```

## Project Structure

```
cannonfall/
├── package.json
├── vite.config.js
├── server.js
├── index.html
├── Dockerfile
├── docker-compose.yml
└── src/
    ├── main.js
    ├── styles.css
    ├── constants.js
    ├── Game.js
    ├── SceneManager.js
    ├── PhysicsWorld.js
    ├── Castle.js
    ├── CastleBuilder.js
    ├── CannonTower.js
    ├── Projectile.js
    ├── Network.js
    └── UI.js
```
