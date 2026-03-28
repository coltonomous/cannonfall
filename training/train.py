#!/usr/bin/env python3
"""
Train a PPO agent to play Cannonfall.

Usage:
    python train.py                          # defaults
    python train.py --mode CASTLE --steps 500000
    python train.py --config configs/default.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import (
    CheckpointCallback,
    EvalCallback,
)
from stable_baselines3.common.monitor import Monitor

from cannonfall_env import CannonFallEnv

_HERE = Path(__file__).resolve().parent
_MODELS_DIR = _HERE / "models"
_LOGS_DIR = _HERE / "logs"


def load_config(path: str | None) -> dict:
    if path and Path(path).exists():
        with open(path) as f:
            return json.load(f)
    return {}


def make_env(cfg: dict) -> CannonFallEnv:
    return Monitor(
        CannonFallEnv(
            mode=cfg.get("mode", "CASTLE"),
            max_turns=cfg.get("max_turns", 30),
            layout_generator=cfg.get("layout_generator", "mixed"),
            opponent_policy=cfg.get("opponent_policy", "heuristic"),
            opponent_noise=cfg.get("opponent_noise", 0.1),
        )
    )


def main():
    parser = argparse.ArgumentParser(description="Train Cannonfall RL agent")
    parser.add_argument("--config", type=str, default=None, help="JSON config file")
    parser.add_argument("--mode", type=str, default=None, help="Game mode override")
    parser.add_argument("--steps", type=int, default=None, help="Total training steps")
    parser.add_argument("--resume", type=str, default=None, help="Path to checkpoint to resume from")
    args = parser.parse_args()

    cfg = load_config(args.config)

    # CLI overrides
    if args.mode:
        cfg["mode"] = args.mode
    if args.steps:
        cfg["total_timesteps"] = args.steps

    # Defaults
    total_timesteps = cfg.get("total_timesteps", 200_000)
    mode = cfg.get("mode", "CASTLE")

    _MODELS_DIR.mkdir(parents=True, exist_ok=True)
    _LOGS_DIR.mkdir(parents=True, exist_ok=True)

    run_name = f"ppo_{mode.lower()}"

    # Environments
    train_env = make_env(cfg)
    eval_env = make_env(cfg)

    # PPO hyperparameters
    ppo_kwargs = {
        "policy": "MlpPolicy",
        "env": train_env,
        "learning_rate": cfg.get("learning_rate", 3e-4),
        "n_steps": cfg.get("n_steps", 2048),
        "batch_size": cfg.get("batch_size", 64),
        "n_epochs": cfg.get("n_epochs", 10),
        "gamma": cfg.get("gamma", 0.99),
        "gae_lambda": cfg.get("gae_lambda", 0.95),
        "clip_range": cfg.get("clip_range", 0.2),
        "ent_coef": cfg.get("ent_coef", 0.01),
        "verbose": 1,
        "tensorboard_log": str(_LOGS_DIR),
    }

    # Policy network architecture
    policy_kwargs = cfg.get("policy_kwargs")
    if policy_kwargs:
        ppo_kwargs["policy_kwargs"] = policy_kwargs

    if args.resume:
        print(f"Resuming from {args.resume}")
        model = PPO.load(args.resume, env=train_env)
    else:
        model = PPO(**ppo_kwargs)

    # Callbacks
    checkpoint_cb = CheckpointCallback(
        save_freq=cfg.get("checkpoint_freq", 10_000),
        save_path=str(_MODELS_DIR / run_name),
        name_prefix="checkpoint",
    )
    eval_cb = EvalCallback(
        eval_env,
        best_model_save_path=str(_MODELS_DIR / run_name),
        log_path=str(_LOGS_DIR / run_name),
        eval_freq=cfg.get("eval_freq", 5_000),
        n_eval_episodes=cfg.get("eval_episodes", 10),
        deterministic=True,
    )

    print(f"Training PPO on {mode} mode for {total_timesteps:,} steps")
    print(f"Models → {_MODELS_DIR / run_name}")
    print(f"Logs   → {_LOGS_DIR / run_name}")

    try:
        model.learn(
            total_timesteps=total_timesteps,
            callback=[checkpoint_cb, eval_cb],
            tb_log_name=run_name,
        )
    except KeyboardInterrupt:
        print("\nTraining interrupted — saving current model...")
    finally:
        save_path = _MODELS_DIR / f"{run_name}_final"
        model.save(str(save_path))
        print(f"Model saved to {save_path}")
        train_env.close()
        eval_env.close()


if __name__ == "__main__":
    main()
