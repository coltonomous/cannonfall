#!/usr/bin/env python3
"""
Train the castle builder model standalone.

The builder learns to output 32-float DNA vectors that BlueprintDecoder.js
converts into castle layouts. Each episode is a single step: output DNA,
play a full game against a heuristic attacker, receive a reward.

Usage:
    python train_builder.py                           # defaults (5k steps, MEDIUM attacker)
    python train_builder.py --steps 50000 --difficulty HARD
    python train_builder.py --n-envs 4 --steps 20000
    python train_builder.py --resume models/builder/best_model
"""

from __future__ import annotations

import argparse
from pathlib import Path

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import CheckpointCallback, EvalCallback
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv

from builder_env import BuilderEnv

_HERE = Path(__file__).resolve().parent
_MODELS_DIR = _HERE / "models" / "builder"
_LOGS_DIR = _HERE / "logs" / "builder"


def make_builder_env(difficulty: str, fast_physics: bool, num_games: int = 1, max_turns: int = 8):
    noise = {"EASY": 0.15, "MEDIUM": 0.08, "HARD": 0.04}.get(difficulty, 0.08)

    def _make():
        env = BuilderEnv(
            mode="CASTLE",
            max_turns=max_turns,
            opponent_policy="heuristic",
            opponent_noise=noise,
            fast_physics=fast_physics,
            num_games=num_games,
            attacker_difficulty=difficulty,
        )
        return Monitor(env)
    return _make


def main():
    parser = argparse.ArgumentParser(description="Train castle builder model")
    parser.add_argument("--steps", type=int, default=5000, help="Total training steps")
    parser.add_argument("--n-envs", type=int, default=1, help="Parallel environments")
    parser.add_argument("--n-steps", type=int, default=16, help="Rollout steps per update (games per batch)")
    parser.add_argument("--difficulty", type=str, default="EASY",
                        choices=["EASY", "MEDIUM", "HARD"], help="Attacker difficulty")
    parser.add_argument("--max-turns", type=int, default=8, help="Max turns per game (fewer = faster)")
    parser.add_argument("--resume", type=str, default=None, help="Path to checkpoint to resume from")
    args = parser.parse_args()

    _MODELS_DIR.mkdir(parents=True, exist_ok=True)
    _LOGS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Builder Model Training")
    print(f"  Steps: {args.steps:,}")
    print(f"  Parallel envs: {args.n_envs}")
    print(f"  Rollout size: {args.n_steps} games/batch")
    print(f"  Max turns/game: {args.max_turns}")
    print(f"  Attacker difficulty: {args.difficulty}")
    print(f"  Models → {_MODELS_DIR}")
    print(f"  Logs   → {_LOGS_DIR}")

    if args.n_envs > 1:
        train_env = SubprocVecEnv([
            make_builder_env(args.difficulty, True, max_turns=args.max_turns)
            for _ in range(args.n_envs)
        ])
    else:
        train_env = DummyVecEnv([make_builder_env(args.difficulty, True, max_turns=args.max_turns)])

    eval_env = DummyVecEnv([make_builder_env(args.difficulty, True, num_games=2, max_turns=args.max_turns)])

    if args.resume and Path(args.resume).exists():
        print(f"  Resuming from {args.resume}")
        model = PPO.load(args.resume, env=train_env, tensorboard_log=str(_LOGS_DIR))
    else:
        model = PPO(
            "MlpPolicy",
            train_env,
            learning_rate=3e-4,
            n_steps=args.n_steps,
            batch_size=min(args.n_steps, 32),
            n_epochs=10,
            gamma=0.0,
            clip_range=0.2,
            ent_coef=0.05,
            policy_kwargs=dict(net_arch=[128, 128]),
            verbose=1,
            tensorboard_log=str(_LOGS_DIR),
        )

    checkpoint_cb = CheckpointCallback(
        save_freq=max(1, 500 // args.n_envs),
        save_path=str(_MODELS_DIR),
        name_prefix="checkpoint",
    )

    eval_cb = EvalCallback(
        eval_env,
        best_model_save_path=str(_MODELS_DIR),
        log_path=str(_LOGS_DIR),
        eval_freq=max(1, 250 // args.n_envs),
        n_eval_episodes=3,
        deterministic=True,
    )

    try:
        model.learn(
            total_timesteps=args.steps,
            callback=[checkpoint_cb, eval_cb],
            tb_log_name="builder",
        )
    except KeyboardInterrupt:
        print("\nTraining interrupted — saving current model...")
    finally:
        save_path = _MODELS_DIR / "final"
        model.save(str(save_path))
        print(f"Model saved to {save_path}")
        train_env.close()
        eval_env.close()


if __name__ == "__main__":
    main()
