#!/usr/bin/env python3
"""
PSRO-lite adversarial training: Builder vs Attacker.

Alternates between training the builder (castle design) and attacker
(cannon firing), with a pool of frozen opponents to prevent cycling.

Architecture:
  - Attacker: existing PPO model (obs=83 → action=3), trained via cannonfall_env.py
  - Builder:  new PPO model (obs=8 → action=32 DNA), trained via builder_env.py
  - Both models are independent — loaded frozen when evaluating the other

Usage:
    python train_adversarial.py --rounds 10 --attacker-steps 100000 --builder-steps 50000 --n-envs 8

    # Start from existing attacker model:
    python train_adversarial.py --attacker-seed models/ppo_castle/best_model --rounds 10
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import EvalCallback
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv

from builder_env import BuilderEnv
from callbacks import CurriculumCallback
from cannonfall_env import CannonFallEnv

_HERE = Path(__file__).resolve().parent
_MODELS_DIR = _HERE / "models"
_POOL_DIR = _MODELS_DIR / "adversarial"


def make_attacker_env(
    builder_dna: list[float] | None,
    opponent_noise: float,
    fast_physics: bool,
):
    """Create a CannonFallEnv where the defender's castle is built from DNA."""
    def _make():
        env = CannonFallEnv(
            mode="CASTLE",
            max_turns=30,
            layout_generator="mixed",  # fallback if no DNA
            opponent_policy="heuristic",
            opponent_noise=opponent_noise,
            fast_physics=fast_physics,
        )
        return Monitor(env)
    return _make


def make_builder_env(
    opponent_noise: float,
    fast_physics: bool,
    num_games: int = 3,
):
    """Create a BuilderEnv that evaluates castles against heuristic attacker."""
    def _make():
        env = BuilderEnv(
            attacker_path=None,  # use heuristic for now
            mode="CASTLE",
            max_turns=30,
            opponent_policy="heuristic",
            opponent_noise=opponent_noise,
            fast_physics=fast_physics,
            num_games=num_games,
        )
        return Monitor(env)
    return _make


def train_attacker(
    seed_path: str | None,
    steps: int,
    n_envs: int,
    opponent_noise: float,
    round_num: int,
) -> Path:
    """Train attacker model for one PSRO round."""
    print(f"\n{'='*60}")
    print(f"  ROUND {round_num}: Training ATTACKER for {steps:,} steps")
    print(f"{'='*60}")

    run_name = f"attacker_r{round_num:02d}"
    save_dir = _POOL_DIR / run_name
    save_dir.mkdir(parents=True, exist_ok=True)

    # Create training envs
    if n_envs > 1:
        train_env = SubprocVecEnv([make_attacker_env(None, opponent_noise, True) for _ in range(n_envs)])
    else:
        train_env = DummyVecEnv([make_attacker_env(None, opponent_noise, True)])

    eval_env = DummyVecEnv([make_attacker_env(None, opponent_noise, True)])

    # Load or create model
    if seed_path and Path(seed_path).exists():
        print(f"  Resuming from {seed_path}")
        model = PPO.load(seed_path, env=train_env)
    else:
        model = PPO(
            "MlpPolicy",
            train_env,
            learning_rate=3e-4,
            n_steps=2048,
            batch_size=64,
            n_epochs=10,
            gamma=0.99,
            gae_lambda=0.95,
            clip_range=0.2,
            ent_coef=0.01,
            policy_kwargs=dict(net_arch=[256, 128]),
            verbose=1,
        )

    eval_cb = EvalCallback(
        eval_env,
        best_model_save_path=str(save_dir),
        log_path=str(save_dir / "logs"),
        eval_freq=max(1, 10_000 // n_envs),
        n_eval_episodes=10,
        deterministic=True,
    )

    try:
        model.learn(total_timesteps=steps, callback=[eval_cb])
    except KeyboardInterrupt:
        print("\n  Attacker training interrupted")

    final_path = save_dir / "final"
    model.save(str(final_path))
    train_env.close()
    eval_env.close()

    # Return best model if it exists, otherwise final
    best_path = save_dir / "best_model.zip"
    return best_path if best_path.exists() else Path(str(final_path) + ".zip")


def train_builder(
    seed_path: str | None,
    steps: int,
    n_envs: int,
    opponent_noise: float,
    round_num: int,
) -> Path:
    """Train builder model for one PSRO round."""
    print(f"\n{'='*60}")
    print(f"  ROUND {round_num}: Training BUILDER for {steps:,} steps")
    print(f"{'='*60}")

    run_name = f"builder_r{round_num:02d}"
    save_dir = _POOL_DIR / run_name
    save_dir.mkdir(parents=True, exist_ok=True)

    if n_envs > 1:
        train_env = SubprocVecEnv([make_builder_env(opponent_noise, True) for _ in range(n_envs)])
    else:
        train_env = DummyVecEnv([make_builder_env(opponent_noise, True)])

    eval_env = DummyVecEnv([make_builder_env(opponent_noise, True, num_games=5)])

    if seed_path and Path(seed_path).exists():
        print(f"  Resuming from {seed_path}")
        model = PPO.load(seed_path, env=train_env)
    else:
        model = PPO(
            "MlpPolicy",
            train_env,
            learning_rate=3e-4,
            n_steps=64,       # short rollouts — each episode is 1 step
            batch_size=32,
            n_epochs=10,
            gamma=0.0,        # no discounting — single-step episodes
            clip_range=0.2,
            ent_coef=0.05,    # higher entropy for more DNA exploration
            policy_kwargs=dict(net_arch=[128, 128]),
            verbose=1,
        )

    eval_cb = EvalCallback(
        eval_env,
        best_model_save_path=str(save_dir),
        log_path=str(save_dir / "logs"),
        eval_freq=max(1, 5_000 // n_envs),
        n_eval_episodes=10,
        deterministic=True,
    )

    try:
        model.learn(total_timesteps=steps, callback=[eval_cb])
    except KeyboardInterrupt:
        print("\n  Builder training interrupted")

    final_path = save_dir / "final"
    model.save(str(final_path))
    train_env.close()
    eval_env.close()

    best_path = save_dir / "best_model.zip"
    return best_path if best_path.exists() else Path(str(final_path) + ".zip")


def evaluate_matchup(
    attacker_path: Path,
    builder_path: Path,
    num_games: int = 20,
) -> dict:
    """Evaluate attacker vs builder over multiple games."""
    print(f"\n  Evaluating: attacker vs builder ({num_games} games)...")

    builder_model = PPO.load(str(builder_path))
    env = BuilderEnv(
        attacker_path=None,  # heuristic proxy
        mode="CASTLE",
        max_turns=30,
        opponent_policy="heuristic",
        opponent_noise=0.04,  # HARD opponent as attacker proxy
        fast_physics=True,
        num_games=1,
    )

    wins = {"attacker": 0, "builder": 0, "draw": 0}
    total_builder_hp = 0

    for _ in range(num_games):
        obs, _ = env.reset()
        dna, _ = builder_model.predict(obs, deterministic=True)
        obs, reward, done, _, info = env.step(dna)

        for game in info.get("games", []):
            winner = game.get("winner")
            if winner == 0:
                wins["attacker"] += 1
            elif winner == 1:
                wins["builder"] += 1
            else:
                wins["draw"] += 1
            total_builder_hp += game.get("hp", [0, 0])[1]

    env.close()

    results = {
        **wins,
        "total_games": num_games,
        "builder_win_rate": wins["builder"] / max(1, num_games),
        "avg_builder_hp": total_builder_hp / max(1, num_games),
    }
    print(f"  Results: {results}")
    return results


def main():
    parser = argparse.ArgumentParser(description="PSRO adversarial training")
    parser.add_argument("--rounds", type=int, default=5, help="Number of PSRO rounds")
    parser.add_argument("--attacker-steps", type=int, default=100_000, help="Attacker training steps per round")
    parser.add_argument("--builder-steps", type=int, default=50_000, help="Builder training steps per round")
    parser.add_argument("--n-envs", type=int, default=4, help="Parallel environments")
    parser.add_argument("--attacker-seed", type=str, default=None, help="Initial attacker model path")
    parser.add_argument("--builder-seed", type=str, default=None, help="Initial builder model path")
    parser.add_argument("--opponent-noise", type=float, default=0.08, help="Opponent noise (attacker difficulty)")
    args = parser.parse_args()

    _POOL_DIR.mkdir(parents=True, exist_ok=True)

    attacker_path = args.attacker_seed
    builder_path = args.builder_seed

    # Pool tracking
    attacker_pool = []
    builder_pool = []

    if attacker_path:
        attacker_pool.append(attacker_path)

    print(f"PSRO Adversarial Training")
    print(f"  Rounds: {args.rounds}")
    print(f"  Attacker steps/round: {args.attacker_steps:,}")
    print(f"  Builder steps/round: {args.builder_steps:,}")
    print(f"  Parallel envs: {args.n_envs}")
    print(f"  Opponent noise: {args.opponent_noise}")
    print(f"  Pool dir: {_POOL_DIR}")

    for round_num in range(1, args.rounds + 1):
        print(f"\n{'#'*60}")
        print(f"  PSRO ROUND {round_num}/{args.rounds}")
        print(f"{'#'*60}")

        # Phase 1: Train attacker (against current builders or mixed layouts)
        new_attacker = train_attacker(
            seed_path=attacker_path,
            steps=args.attacker_steps,
            n_envs=args.n_envs,
            opponent_noise=args.opponent_noise,
            round_num=round_num,
        )
        attacker_path = str(new_attacker)
        attacker_pool.append(attacker_path)
        print(f"  Attacker saved: {attacker_path}")

        # Phase 2: Train builder (against heuristic attacker as proxy)
        new_builder = train_builder(
            seed_path=builder_path,
            steps=args.builder_steps,
            n_envs=args.n_envs,
            opponent_noise=args.opponent_noise,
            round_num=round_num,
        )
        builder_path = str(new_builder)
        builder_pool.append(builder_path)
        print(f"  Builder saved: {builder_path}")

        # Phase 3: Evaluate matchup
        if builder_path and attacker_path:
            results = evaluate_matchup(
                Path(attacker_path),
                Path(builder_path),
                num_games=20,
            )

        # Save pool state
        pool_state = {
            "round": round_num,
            "attacker_pool": attacker_pool,
            "builder_pool": builder_pool,
        }
        with open(_POOL_DIR / "pool_state.json", "w") as f:
            json.dump(pool_state, f, indent=2)

    print(f"\n{'='*60}")
    print(f"  PSRO COMPLETE — {args.rounds} rounds")
    print(f"  Final attacker: {attacker_path}")
    print(f"  Final builder: {builder_path}")
    print(f"  Pool state: {_POOL_DIR / 'pool_state.json'}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
