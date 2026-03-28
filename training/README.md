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

The training pipeline is fully separate from the game. Shared imports are
read-only: `src/constants.js`, `src/GameModes.js`, `src/Presets.js`,
`src/PhysicsShapes.js`, and `src/AI.js` — ensuring the training env's
physics and opponent behaviour stay in sync with the real game.

The trained model is served as a static asset from `public/models/` and
loaded in the browser via onnxruntime-web. Players can fight the RL agent
by selecting "RL Agent" in the difficulty picker.

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

# Parallel envs (8 physics sims across CPU cores — ~4-6x faster)
python train.py --n-envs 8

# With curriculum learning (simple → complex castles)
python train.py --config configs/curriculum.json --n-envs 8

# Quick iteration (simple walls, no opponent, 10k steps)
python train.py --config configs/fast.json

# Override mode and steps
python train.py --mode SPACE --steps 500000

# Resume from checkpoint with harder settings
python train.py --resume models/ppo_castle_final --config configs/curriculum.json --n-envs 8
```

### Parallel Environments

The bottleneck is the physics simulation (each shot runs ~600 cannon-es
timesteps). `--n-envs N` spawns N independent bridge.js processes via
`SubprocVecEnv`, running physics in parallel across CPU cores.

Recommended values:
- MacBook M4: `--n-envs 8` (uses efficiency + performance cores)
- 4-core machine: `--n-envs 4`
- CI / testing: `--n-envs 1` (default, simplest)

### Self-Play Training

Train against copies of the agent itself, with periodic opponent swaps:

```bash
python train_selfplay.py
python train_selfplay.py --steps 500000 --swap-freq 20000
```

### End-to-End: Train → Export → Play

```bash
# 1. Train (curriculum, 8 parallel envs)
python train.py --config configs/curriculum.json --n-envs 8 --steps 100000

# 2. Export to ONNX
python export_onnx.py models/ppo_castle_final --output models/cannonfall_agent.onnx

# 3. Copy to game's static assets
cp models/cannonfall_agent.onnx ../public/models/cannonfall_agent.onnx

# 4. Start the game
cd .. && pnpm dev
# Click "Com Match" → "RL Agent"
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

The export prints input/output tensor names for verification. The input
tensor is named `"observation"` and output is `"action"` — matching the
feed keys in `inference/OnnxAI.js`.

The exported model can be loaded in the browser:

```js
import { OnnxAI } from './training/inference/OnnxAI.js';

const ai = new OnnxAI();
await ai.load('/models/cannonfall_agent.onnx');

const aim = await ai.computeAim(cannon, targetPos, gameMode);
// aim = { yaw, pitch, power }
```

## How It Works

### Environment

Each step = one agent shot + one opponent shot. The agent always
controls player 0. Player 1 is driven by the configured opponent
policy (`heuristic`, `random`, `self`, or `none`).

After a target hit, the defender's target automatically repositions
to a new grid cell (matching real game flow).

**Observation (14 features):**

| # | Feature | Description |
|---|---------|-------------|
| 0–2 | targetDx/Dy/Dz | Target position relative to cannon |
| 3 | targetDist | Euclidean distance to target |
| 4 | cannonFacing | Direction cannon faces (+1 or -1) |
| 5–6 | hp_self / hp_opp | Hit points for each player |
| 7 | turnFrac | Progress through the game (0→1) |
| 8 | lastHit | Whether the previous shot hit (0/1) |
| 9 | lastClosestDist | How close the last shot came (normalised) |
| 10 | opponentLastHit | Whether the opponent hit us last turn (0/1) |
| 11 | blockCountNorm | Number of defender blocks (normalised) |
| 12 | avgBlockDist | Mean distance to defender blocks (normalised) |
| 13 | blockSpreadY | Vertical spread of defender blocks (normalised) |

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

- **`heuristic`** (default): Uses `src/AI.js` trajectory solver with
  difficulty-based spread. Low noise → HARD, high noise → EASY.
- **`random`**: Uniformly random yaw/pitch/power.
- **`self`**: Self-play — opponent driven by an external policy
  (e.g. a frozen copy of the agent). See `train_selfplay.py`.
- **`none`**: Opponent never fires. Useful for aim-only training.

### Castle Layouts

- **`preset`**: Real game presets (KEEP, BUNKER, TOWER, GALLEON, etc.)
- **`random`**: Procedurally generated with mixed block types
- **`simple_wall`**: Perimeter walls for easy training warmup
- **`mixed`** (default): 50/50 split of preset and random layouts
- **`curriculum`**: Difficulty-scaled — simple walls at low difficulty,
  full presets at high difficulty. Use with `CurriculumCallback`.

### Curriculum Learning

The `curriculum` layout generator + `CurriculumCallback` automatically
ramp difficulty during training:

- **difficulty 0–0.3**: Simple walls (1–2 layers)
- **difficulty 0.3–0.6**: Random layouts with reduced budget
- **difficulty 0.6–1.0**: Full mixed layouts (presets + random)

```bash
python train.py --config configs/curriculum.json
```

### Headless Physics

`HeadlessGame.js` replicates the game's cannon-es physics simulation
without any THREE.js dependency. It imports shared code from `src/`
(physics shapes, AI trajectory solver, constants, game modes, presets)
to stay in sync with the real game. This minimises code drift — changes
to the game's physics or AI automatically propagate to the training env.

## Testing

```bash
# Run training env tests (33 JS tests)
npx vitest run training/env/headless.test.js

# Run bridge integration tests (8 Python tests)
python test_bridge.py

# Run all game + training tests
pnpm test
```

## Project Structure

```
training/
├── cannonfall_env.py      # Gymnasium environment (Python ↔ Node bridge)
├── train.py               # PPO training script (parallel envs, curriculum)
├── train_selfplay.py      # Self-play training (agent vs agent)
├── evaluate.py            # Evaluation and comparison metrics
├── export_onnx.py         # Export trained model to ONNX
├── callbacks.py           # CurriculumCallback for difficulty ramping
├── test_bridge.py         # Python ↔ Node integration tests (8 tests)
├── requirements.txt       # Python dependencies
├── configs/
│   ├── default.json       # Standard training config
│   ├── fast.json          # Quick iteration (simple walls, 10k steps)
│   └── curriculum.json    # Curriculum learning config
├── env/
│   ├── HeadlessGame.js    # Headless cannon-es game simulation
│   ├── bridge.js          # stdin/stdout JSON protocol server
│   ├── headless.test.js   # Training env tests (33 tests)
│   └── package.json       # Node.js dependencies
├── inference/
│   └── OnnxAI.js          # In-browser ONNX inference (AI.js drop-in)
├── models/                # Saved checkpoints (gitignored)
└── logs/                  # TensorBoard logs (gitignored)

public/
└── models/
    └── cannonfall_agent.onnx  # Trained model served to browser
```
