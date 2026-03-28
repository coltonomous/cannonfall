# Cannonfall RL Training

Train a reinforcement learning agent to play Cannonfall using PPO.

## Architecture

```
Python (SB3/Gymnasium)          Node.js (cannon-es)
┌──────────────────┐            ┌─────────────────┐
│  train.py        │  stdin     │  bridge.js       │
│  CannonFallEnv   │ ──JSON──▶ │  HeadlessGame.js │
│  (Gymnasium)     │ ◀──JSON── │  (physics sim)   │
└──────────────────┘  stdout    └─────────────────┘
```

The training pipeline is fully separate from the game. The shared code
is `src/constants.js`, `src/GameModes.js`, and `src/Presets.js` (imported
read-only by HeadlessGame.js for accurate physics and layout replication).

## Setup

```bash
# Node.js environment (headless physics)
cd training/env
npm install

# Python environment
cd training
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Training

```bash
# Default: Castle mode, 200k steps, mixed layouts, heuristic opponent
python train.py

# Custom config
python train.py --config configs/default.json

# Override mode and steps
python train.py --mode SPACE --steps 500000

# Resume from checkpoint
python train.py --resume models/ppo_castle/checkpoint_100000_steps
```

Monitor with TensorBoard:
```bash
tensorboard --logdir training/logs
```

## Evaluation

```bash
# Evaluate trained model
python evaluate.py models/ppo_castle_final

# Compare against random baseline
python evaluate.py models/ppo_castle_final --compare-random --episodes 100
```

## ONNX Export (for in-browser play)

```bash
# Export trained model to ONNX
python export_onnx.py models/ppo_castle_final

# Custom output path
python export_onnx.py models/ppo_castle_final --output models/cannonfall_agent.onnx
```

The exported model can be loaded in the browser using `inference/OnnxAI.js`
with onnxruntime-web. See that file for the integration interface.

## How It Works

### Environment

Each step = one agent shot + one opponent shot.  The agent always
controls player 0.  Player 1 is driven by the configured opponent
policy (`heuristic`, `random`, or `none`).

**Observation (11 features):**

| Feature | Description |
|---------|-------------|
| targetDx/Dy/Dz | Target position relative to cannon |
| targetDist | Euclidean distance to target |
| cannonFacing | Direction cannon faces (+1 or -1) |
| hp_self / hp_opp | Hit points for each player |
| turnFrac | Progress through the game (0→1) |
| lastHit | Whether the previous shot hit (0/1) |
| lastClosestDist | How close the last shot came (normalised) |
| opponentLastHit | Whether the opponent hit us last turn (0/1) |

**Action (3 continuous values, normalised to [-1, 1]):**
- **Yaw**: horizontal aim angle
- **Pitch**: vertical aim angle
- **Power**: shot strength

### Reward Signal

| Event | Reward |
|-------|--------|
| Each shot | -0.1 (encourages efficiency) |
| Near miss | 0 to +1 (proximity shaping) |
| Hit target | +10 |
| Win game | +100 |
| Get hit by opponent | -5 |
| Lose game | -100 |

### Opponent Policies

- **`heuristic`** (default): Trajectory solver mirroring the game's AI
  with configurable noise. Uses ballistic equations for gravity modes
  and direct aim for zero-G.
- **`random`**: Uniformly random yaw/pitch/power.
- **`none`**: Opponent never fires. Useful for aim-only training.

### Castle Layouts

- **`preset`**: Real game presets (KEEP, BUNKER, TOWER, GALLEON, etc.)
- **`random`**: Procedurally generated with mixed block types
- **`simple_wall`**: Perimeter walls for easy training warmup
- **`mixed`** (default): 50/50 split of preset and random layouts

### Headless Physics

`HeadlessGame.js` replicates the game's cannon-es physics simulation
without any THREE.js dependency. It builds castles from real preset
layouts, fires projectiles, detects collisions, and handles explosions
(space mode) — all driven by the same constants, game modes, and
preset definitions as the real game.

## Testing

```bash
# Run training env tests (33 tests)
npx vitest run training/env/headless.test.js

# Run all tests (game + training)
pnpm test
```

## Project Structure

```
training/
├── cannonfall_env.py      # Gymnasium environment (Python ↔ Node bridge)
├── train.py               # PPO training script (Stable Baselines3)
├── evaluate.py            # Evaluation and comparison metrics
├── export_onnx.py         # Export trained model to ONNX
├── requirements.txt       # Python dependencies
├── configs/
│   └── default.json       # Hyperparameters
├── env/
│   ├── HeadlessGame.js    # Headless cannon-es game simulation
│   ├── bridge.js          # stdin/stdout JSON protocol server
│   ├── headless.test.js   # Training env tests (33 tests)
│   └── package.json       # Node.js dependencies
├── inference/
│   └── OnnxAI.js          # In-browser inference wrapper
├── models/                # Saved checkpoints (gitignored)
└── logs/                  # TensorBoard logs (gitignored)
```

## Next Steps

- [ ] Add castle block positions to observation space (spatial awareness)
- [ ] Implement self-play (agent vs agent training)
- [ ] Curriculum learning (simple castles → complex castles)
- [ ] Per-mode training configs (gravity vs zero-G physics differ significantly)
- [ ] Target repositioning after hits (matches real game flow)
