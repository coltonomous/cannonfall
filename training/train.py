#!/usr/bin/env python3
"""
Train a PPO agent to play Cannonfall.

Usage:
    python train.py                          # defaults (1 env)
    python train.py --n-envs 8              # 8 parallel physics sims
    python train.py --config configs/default.json
    python train.py --resume models/ppo_castle_final --config configs/curriculum.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import (
    CheckpointCallback,
    EvalCallback,
)
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv

from callbacks import CurriculumCallback
from cannonfall_env import CannonFallEnv

_HERE = Path(__file__).resolve().parent
_MODELS_DIR = _HERE / "models"
_LOGS_DIR = _HERE / "logs"


def load_config(path: str | None) -> dict:
    if path and Path(path).exists():
        with open(path) as f:
            return json.load(f)
    return {}


def _make_env_fn(cfg: dict, rank: int = 0):
    """Return a callable that creates a single CannonFallEnv.

    Each env gets a unique rank so SubprocVecEnv spawns independent
    bridge.js subprocesses (each with its own physics simulation).
    """
    def _init():
        env = CannonFallEnv(
            mode=cfg.get("mode", "CASTLE"),
            max_turns=cfg.get("max_turns", 30),
            layout_generator=cfg.get("layout_generator", "mixed"),
            opponent_policy=cfg.get("opponent_policy", "heuristic"),
            opponent_noise=cfg.get("opponent_noise", 0.1),
            difficulty=cfg.get("difficulty", 1.0),
        )
        return Monitor(env)
    return _init


def make_vec_env(cfg: dict, n_envs: int):
    """Create a vectorized environment with n_envs parallel workers.

    n_envs=1 uses DummyVecEnv (in-process, easier to debug).
    n_envs>1 uses SubprocVecEnv (separate processes, true parallelism).
    """
    env_fns = [_make_env_fn(cfg, rank=i) for i in range(n_envs)]
    if n_envs == 1:
        return DummyVecEnv(env_fns)
    return SubprocVecEnv(env_fns, start_method="fork")


def main():
    parser = argparse.ArgumentParser(description="Train Cannonfall RL agent")
    parser.add_argument("--config", type=str, default=None, help="JSON config file")
    parser.add_argument("--mode", type=str, default=None, help="Game mode override")
    parser.add_argument("--steps", type=int, default=None, help="Total training steps")
    parser.add_argument("--n-envs", type=int, default=None, help="Parallel environments (default: 1)")
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
    n_envs = args.n_envs or cfg.get("n_envs", 1)

    _MODELS_DIR.mkdir(parents=True, exist_ok=True)
    _LOGS_DIR.mkdir(parents=True, exist_ok=True)

    run_name = f"ppo_{mode.lower()}"

    # Environments
    train_env = make_vec_env(cfg, n_envs)
    eval_env = make_vec_env(cfg, 1)  # eval always single-env

    # Adjust n_steps so rollout buffer = n_steps * n_envs
    # With more envs, each needs fewer steps per rollout to fill the same buffer
    base_n_steps = cfg.get("n_steps", 2048)
    # n_steps must be divisible by n_envs for SubprocVecEnv;
    # keep total rollout size roughly constant
    n_steps = max(64, base_n_steps // n_envs)

    # PPO hyperparameters
    ppo_kwargs = {
        "policy": "MlpPolicy",
        "env": train_env,
        "learning_rate": cfg.get("learning_rate", 3e-4),
        "n_steps": n_steps,
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
    callbacks = []

    checkpoint_cb = CheckpointCallback(
        save_freq=max(1, cfg.get("checkpoint_freq", 10_000) // n_envs),
        save_path=str(_MODELS_DIR / run_name),
        name_prefix="checkpoint",
    )
    callbacks.append(checkpoint_cb)

    eval_cb = EvalCallback(
        eval_env,
        best_model_save_path=str(_MODELS_DIR / run_name),
        log_path=str(_LOGS_DIR / run_name),
        eval_freq=max(1, cfg.get("eval_freq", 5_000) // n_envs),
        n_eval_episodes=cfg.get("eval_episodes", 10),
        deterministic=True,
    )
    callbacks.append(eval_cb)

    # Curriculum: auto-ramp difficulty if layout_generator is "curriculum"
    if cfg.get("layout_generator") == "curriculum":
        curriculum_cb = CurriculumCallback(
            start=cfg.get("curriculum_start", 0.1),
            end=cfg.get("curriculum_end", 1.0),
            ramp_steps=int(total_timesteps * cfg.get("curriculum_ramp_frac", 0.75)),
            verbose=1,
        )
        callbacks.append(curriculum_cb)
        print(f"Curriculum: difficulty {curriculum_cb.start} → {curriculum_cb.end}")

    print(f"Training PPO on {mode} mode for {total_timesteps:,} steps")
    print(f"Parallel envs: {n_envs} ({'SubprocVecEnv' if n_envs > 1 else 'DummyVecEnv'})")
    print(f"Rollout: {n_steps} steps/env × {n_envs} envs = {n_steps * n_envs} total/batch")
    print(f"Models → {_MODELS_DIR / run_name}")
    print(f"Logs   → {_LOGS_DIR / run_name}")

    try:
        model.learn(
            total_timesteps=total_timesteps,
            callback=callbacks,
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
