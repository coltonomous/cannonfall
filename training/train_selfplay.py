#!/usr/bin/env python3
"""
Self-play training for Cannonfall.

Trains an agent by playing against copies of itself.  Periodically
snapshots the current policy as the new opponent and continues.

Usage:
    python train_selfplay.py
    python train_selfplay.py --steps 500000 --swap-freq 20000
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
from pathlib import Path

import numpy as np
import gymnasium as gym
from gymnasium import spaces
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import CheckpointCallback, BaseCallback
from stable_baselines3.common.monitor import Monitor

from cannonfall_env import CannonFallEnv

_HERE = Path(__file__).resolve().parent
_MODELS_DIR = _HERE / "models"
_LOGS_DIR = _HERE / "logs"


class SelfPlayEnv(gym.Wrapper):
    """Wraps CannonFallEnv for self-play.

    Uses opponentPolicy='self' so the bridge expects an opponentAction
    each step.  The opponent action comes from a frozen copy of the
    agent's policy.
    """

    def __init__(self, opponent_model: PPO | None = None, **env_kwargs):
        env_kwargs["opponent_policy"] = "self"
        inner = CannonFallEnv(**env_kwargs)
        super().__init__(inner)
        self._opponent = opponent_model
        self._opponent_obs: np.ndarray | None = None

    def set_opponent(self, model: PPO):
        self._opponent = model

    def reset(self, **kwargs):
        obs, info = self.env.reset(**kwargs)
        # After reset, get initial opponent observation via a no-op query
        # The opponent obs will come from step responses
        self._opponent_obs = None
        return obs, info

    def step(self, action):
        # Get opponent action from frozen policy
        opp_action_raw = np.zeros(3, dtype=np.float32)
        if self._opponent is not None and self._opponent_obs is not None:
            opp_action_raw, _ = self._opponent.predict(
                self._opponent_obs, deterministic=False
            )

        # Rescale opponent action the same way CannonFallEnv does
        opp_yaw, opp_pitch, opp_power = self._rescale(opp_action_raw)

        # Send both actions to the bridge
        resp = self.env._send({
            "cmd": "step",
            "action": {
                "yaw": float(self.env._rescale_action(action)[0]),
                "pitch": float(self.env._rescale_action(action)[1]),
                "power": float(self.env._rescale_action(action)[2]),
            },
            "opponentAction": {
                "yaw": opp_yaw,
                "pitch": opp_pitch,
                "power": opp_power,
            },
        })

        obs = self.env._parse_obs(resp["observation"])
        reward = float(resp["reward"])
        done = bool(resp["done"])
        info = resp.get("info", {})

        # Store opponent observation for next step
        if "opponentObservation" in resp:
            self._opponent_obs = self.env._parse_obs(resp["opponentObservation"])

        terminated = done and info.get("winner") is not None
        truncated = done and info.get("winner") is None
        return obs, reward, terminated, truncated, info

    def _rescale(self, action: np.ndarray):
        a = np.clip(action, -1.0, 1.0)
        yaw = float(a[0]) * self.env._YAW_RANGE
        pitch = self.env._PITCH_MIN + (float(a[1]) + 1) / 2 * (
            self.env._PITCH_MAX - self.env._PITCH_MIN
        )
        power = self.env._POWER_MIN + (float(a[2]) + 1) / 2 * (
            self.env._POWER_MAX - self.env._POWER_MIN
        )
        return yaw, pitch, power


class OpponentSwapCallback(BaseCallback):
    """Periodically snapshot the current policy as the opponent."""

    def __init__(self, swap_freq: int = 20_000, verbose: int = 0):
        super().__init__(verbose)
        self.swap_freq = swap_freq
        self._last_swap = 0

    def _on_step(self) -> bool:
        if self.num_timesteps - self._last_swap >= self.swap_freq:
            self._last_swap = self.num_timesteps
            # Clone current model weights into opponent
            opponent = PPO.load(
                path=None,
                env=None,
                custom_objects={"policy": self.model.policy.__class__},
            ) if False else self._clone_model()
            env = self.training_env.envs[0]
            inner = env.env if hasattr(env.env, "set_opponent") else env
            if hasattr(inner, "set_opponent"):
                inner.set_opponent(self.model)
            if self.verbose > 0:
                print(f"[SelfPlay] Swapped opponent at step {self.num_timesteps}")
        return True

    def _clone_model(self) -> PPO:
        # Save to temp and reload for a frozen copy
        import tempfile, os
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "opponent")
            self.model.save(path)
            return PPO.load(path)


def main():
    parser = argparse.ArgumentParser(description="Self-play training")
    parser.add_argument("--steps", type=int, default=200_000)
    parser.add_argument("--swap-freq", type=int, default=20_000)
    parser.add_argument("--mode", type=str, default="CASTLE")
    parser.add_argument("--resume", type=str, default=None)
    args = parser.parse_args()

    _MODELS_DIR.mkdir(parents=True, exist_ok=True)
    _LOGS_DIR.mkdir(parents=True, exist_ok=True)

    run_name = f"ppo_selfplay_{args.mode.lower()}"

    train_env = Monitor(SelfPlayEnv(mode=args.mode, max_turns=30))
    eval_env = Monitor(CannonFallEnv(mode=args.mode))  # eval against heuristic

    if args.resume:
        print(f"Resuming from {args.resume}")
        model = PPO.load(args.resume, env=train_env)
    else:
        model = PPO(
            "MlpPolicy",
            train_env,
            learning_rate=3e-4,
            n_steps=2048,
            batch_size=64,
            n_epochs=10,
            gamma=0.99,
            ent_coef=0.01,
            verbose=1,
            tensorboard_log=str(_LOGS_DIR),
        )

    checkpoint_cb = CheckpointCallback(
        save_freq=10_000,
        save_path=str(_MODELS_DIR / run_name),
        name_prefix="checkpoint",
    )
    swap_cb = OpponentSwapCallback(swap_freq=args.swap_freq, verbose=1)

    print(f"Self-play training on {args.mode} for {args.steps:,} steps")
    print(f"Opponent swapped every {args.swap_freq:,} steps")

    try:
        model.learn(
            total_timesteps=args.steps,
            callback=[checkpoint_cb, swap_cb],
            tb_log_name=run_name,
        )
    except KeyboardInterrupt:
        print("\nTraining interrupted — saving...")
    finally:
        save_path = _MODELS_DIR / f"{run_name}_final"
        model.save(str(save_path))
        print(f"Model saved to {save_path}")
        train_env.close()
        eval_env.close()


if __name__ == "__main__":
    main()
