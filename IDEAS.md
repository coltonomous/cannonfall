# Cannonfall — Ideas & Roadmap

## Done

- **Castle Builder** — Drag-and-drop 3D block editor with block palette, rotation, budget, presets, and grid layers.
- **Mobile / Touch Controls** — Swipe-to-aim, tap-hold-release-to-fire, contextual build phase touch, pinch-to-zoom. PWA for fullscreen.
- **Shareable Castle Designs** — Castle layouts encoded into URL hashes. Share a link, friend loads it into their builder.
- **AI Opponent** — Single-player mode with ballistic trajectory solver. Three difficulty levels (Easy/Medium/Hard) control aim accuracy.
- **Replay Camera** — Slow-motion cinematic replay of the winning shot with orbiting camera.

## Up Next

### 1. Sound Design
- Cannon boom with reverb on fire
- Whistling wind during projectile flight
- Satisfying crunch/crumble on block impacts
- Rumble on screen shake
- Victory fanfare / defeat sound
- Ambient wind or battlefield atmosphere

### 2. Visual Polish
- PBR textures on blocks (stone, metal, wood)
- Environment map for metallic cannon surfaces
- Post-processing: subtle bloom on target glow, SSAO, tone mapping
- Dust clouds on ground impact
- Fire/ember particles on muzzle flash
- Block crack textures before they break free

## Future

### 3. Destruction Fidelity
Structural integrity simulation — blocks crack on impact, fragment into smaller pieces, cascade when supports collapse. High risk/reward: deeply satisfying if done well, physics rabbit hole if not scoped carefully.

### 4. Progression & Unlocks
Unlock new block types through play (explosive, reinforced, sticky blocks). Cosmetic cannon skins, castle themes, stats tracking. Requires backend/auth.

### 5. Community Features
Castle design gallery, "hardest castle" leaderboard, ranked matchmaking with ELO, spectator mode. Each is its own backend project — the URL-based sharing gets 80% of the value at 1% of the cost.
