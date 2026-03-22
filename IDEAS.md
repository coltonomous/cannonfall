# Cannonade — Ideas & Roadmap

Features that would elevate this beyond a basic demo, ordered by impact.

## 1. Castle Builder (In Progress)
The core missing piece. A drag-and-drop 3D block editor where players design their own castle before each match. Block palette, rotation controls, budget counter, real-time validation. This is where player creativity and replayability live — without it, the game is just "pick preset, click fire."

## 2. Shareable Castle Designs
Encode castle layouts into URL hashes (base64 the layout JSON). Paste a link to a friend: "Try to crack THIS." Virality built into the mechanic. No backend needed — just client-side serialization. Could also support a clipboard button for sharing layouts.

## 3. Replay Camera
After a winning hit, replay the final shot from a cinematic angle in slow motion. Orbit around the impact, show the blocks cascading. This is the "clip moment" that makes people want to share. Could also support saving/exporting replays as short videos.

## 4. Destruction Fidelity
Blocks currently just tumble as rigid bodies. Next level: blocks crack on impact, fragment into smaller pieces, and cascade when supports are knocked out (structural integrity simulation). Every shot should feel consequential — a wall section collapsing after its supports are destroyed is deeply satisfying.

## 5. AI Opponent
Single-player mode with an AI that analyzes the castle structure and aims for weak points. Even a simple heuristic AI ("aim at the thinnest wall between cannon and target") makes the game playable solo. Could have difficulty levels that control aim accuracy and strategic depth.

## 6. Mobile / Touch Controls
A web game that works on phones has 100x the audience of keyboard-only. Tap-drag for aim direction + power (like Angry Birds slingshot mechanic). Pinch-to-zoom for looking around. The 3D view already works — just needs input adaptation.

## 7. Sound Design
- Cannon boom with reverb on fire
- Whistling wind during projectile flight
- Satisfying crunch/crumble on block impacts
- Rumble on screen shake
- Victory fanfare / defeat sound
- Ambient wind or battlefield atmosphere

## 8. Visual Polish
- PBR textures on blocks (stone, metal, wood)
- Environment map for metallic cannon surfaces
- Post-processing: subtle bloom on target glow, SSAO, tone mapping
- Dust clouds on ground impact
- Fire/ember particles on muzzle flash
- Block crack textures before they break free

## 9. Progression & Unlocks
- Unlock new block types through play (explosive blocks, reinforced blocks, sticky blocks)
- Cosmetic cannon skins
- Castle color/texture themes
- Stats tracking (shots fired, accuracy, wins)

## 10. Community Features
- Castle design gallery — browse and rate community designs
- "Hardest castle to crack" leaderboard
- Ranked matchmaking with ELO
- Spectator mode for ongoing matches
