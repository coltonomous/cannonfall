#!/usr/bin/env python3
"""
Evaluate a trained Cannonfall agent.

Runs N episodes, reports win rate, avg reward, hit rate, and
avg shots to hit.  Optionally compares against a random baseline.

Usage:
    python evaluate.py models/ppo_castle_final
    python evaluate.py models/ppo_castle_final --episodes 100 --compare-random
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from stable_baselines3 import PPO

from cannonfall_env import CannonFallEnv


def run_episodes(
    model,
    env: CannonFallEnv,
    n_episodes: int,
    deterministic: bool = True,
) -> dict:
    """Run episodes and collect metrics."""
    total_rewards = []
    hits = 0
    total_shots = 0
    wins = 0

    for ep in range(n_episodes):
        obs, _ = env.reset()
        ep_reward = 0.0
        done = False

        while not done:
            if model is not None:
                action, _ = model.predict(obs, deterministic=deterministic)
            else:
                action = env.action_space.sample()

            obs, reward, terminated, truncated, info = env.step(action)
            ep_reward += reward
            total_shots += 1
            done = terminated or truncated

            if info.get("hit"):
                hits += 1

        total_rewards.append(ep_reward)
        if info.get("winner") == 0:
            wins += 1

    return {
        "episodes": n_episodes,
        "avg_reward": float(np.mean(total_rewards)),
        "std_reward": float(np.std(total_rewards)),
        "win_rate": wins / n_episodes,
        "hit_rate": hits / max(total_shots, 1),
        "avg_shots": total_shots / n_episodes,
        "total_hits": hits,
    }


def print_results(label: str, metrics: dict):
    print(f"\n{'=' * 50}")
    print(f"  {label}")
    print(f"{'=' * 50}")
    print(f"  Episodes:     {metrics['episodes']}")
    print(f"  Avg reward:   {metrics['avg_reward']:.2f} ± {metrics['std_reward']:.2f}")
    print(f"  Win rate:     {metrics['win_rate']:.1%}")
    print(f"  Hit rate:     {metrics['hit_rate']:.1%}")
    print(f"  Avg shots/ep: {metrics['avg_shots']:.1f}")
    print(f"  Total hits:   {metrics['total_hits']}")
    print()


def main():
    parser = argparse.ArgumentParser(description="Evaluate Cannonfall agent")
    parser.add_argument("model_path", type=str, help="Path to saved model")
    parser.add_argument("--episodes", type=int, default=50, help="Evaluation episodes")
    parser.add_argument("--mode", type=str, default="CASTLE", help="Game mode")
    parser.add_argument("--compare-random", action="store_true", help="Also evaluate random agent")
    parser.add_argument("--stochastic", action="store_true", help="Use stochastic policy")
    args = parser.parse_args()

    env = CannonFallEnv(mode=args.mode)

    # Trained agent
    print(f"Loading model from {args.model_path}...")
    model = PPO.load(args.model_path)
    metrics = run_episodes(model, env, args.episodes, deterministic=not args.stochastic)
    print_results("Trained Agent (PPO)", metrics)

    # Random baseline
    if args.compare_random:
        random_metrics = run_episodes(None, env, args.episodes)
        print_results("Random Baseline", random_metrics)

        # Improvement
        if random_metrics["avg_reward"] != 0:
            improvement = (
                (metrics["avg_reward"] - random_metrics["avg_reward"])
                / abs(random_metrics["avg_reward"])
                * 100
            )
            print(f"  Reward improvement over random: {improvement:+.1f}%")
        print(f"  Win rate delta:  {metrics['win_rate'] - random_metrics['win_rate']:+.1%}")
        print(f"  Hit rate delta:  {metrics['hit_rate'] - random_metrics['hit_rate']:+.1%}")

    env.close()


if __name__ == "__main__":
    main()
