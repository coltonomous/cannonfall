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

The training pipeline is fully separate from the game. The only shared
code is `src/constants.js` and `src/GameModes.js` (imported read-only
by HeadlessGame.js for accurate physics replication).

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
# Default: Castle mode, 200k steps
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

## How It Works

### Environment

Each environment step = one shot. The agent observes:

| Feature | Description |
|---------|-------------|
| targetDx/Dy/Dz | Target position relative to cannon |
| targetDist | Euclidean distance to target |
| cannonFacing | Direction cannon faces (+1 or -1) |
| hp_self / hp_opp | Hit points for each player |
| turnFrac | Progress through the game (0→1) |
| lastHit | Whether the previous shot hit (0/1) |
| lastClosestDist | How close the last shot came (normalised) |

The agent outputs three continuous values (normalised to [-1, 1]):
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

### Headless Physics

`HeadlessGame.js` replicates the game's cannon-es physics simulation
without any THREE.js dependency. It builds castles from generated
layouts, fires projectiles, detects collisions, and handles explosions
(space mode) — all driven by the same constants and game mode configs
as the real game.

## Project Structure

```
training/
├── cannonfall_env.py      # Gymnasium environment (Python ↔ Node bridge)
├── train.py               # PPO training script (Stable Baselines3)
├── evaluate.py            # Evaluation and comparison metrics
├── requirements.txt       # Python dependencies
├── configs/
│   └── default.json       # Hyperparameters
├── env/
│   ├── HeadlessGame.js    # Headless cannon-es game simulation
│   ├── bridge.js          # stdin/stdout JSON protocol server
│   └── package.json       # Node.js dependencies
├── models/                # Saved checkpoints (gitignored)
└── logs/                  # TensorBoard logs (gitignored)
```

## Next Steps

- [ ] Export trained model to ONNX for in-browser inference
- [ ] Add castle block positions to observation space
- [ ] Implement self-play (agent vs agent)
- [ ] Curriculum learning (simple castles → complex castles)
- [ ] Per-mode training configs (gravity vs zero-G physics differ significantly)
