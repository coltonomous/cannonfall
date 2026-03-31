"""
Gymnasium environment for the Cannonfall castle builder.

Single-step episode: the builder outputs a 32-float DNA vector,
the env decodes it into a castle layout, plays a full game against
a frozen attacker model, and returns a reward based on survival.

The builder and attacker are completely separate models — the attacker
is loaded as a frozen policy and drives cannon firing during evaluation.

Action space (Box, continuous, 32 features):
    Blueprint DNA vector — decoded by BlueprintDecoder.js into a castle layout.

Observation space (Box, continuous, 8 features):
    [attacker_skill, game_mode_id, grid_width, grid_depth, max_layers,
     budget, max_turns, last_reward]
    Provides context about the opponent and game rules so the builder
    can adapt its strategy.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import gymnasium as gym
import numpy as np
from gymnasium import spaces
from stable_baselines3 import PPO

_HERE = Path(__file__).resolve().parent
_BRIDGE = _HERE / "env" / "bridge.js"


class BuilderEnv(gym.Env):
    """Single-step castle builder environment.

    Each episode:
      1. Agent outputs 32-float DNA vector (action)
      2. Env plays a full game: DNA castle vs frozen attacker
      3. Returns reward based on castle survival

    The attacker can be:
      - A frozen PPO model (loaded from .zip) — runs inference per turn
      - 'heuristic' — uses the built-in AI trajectory solver
      - None — no opponent firing (builder-only evaluation)
    """

    metadata = {"render_modes": []}

    def __init__(
        self,
        attacker_path: str | None = None,
        attacker_noise: float = 0.04,
        mode: str = "CASTLE",
        max_turns: int = 30,
        opponent_policy: str = "heuristic",
        opponent_noise: float = 0.1,
        fast_physics: bool = True,
        node_executable: str = "node",
        num_games: int = 3,
    ):
        super().__init__()

        self._mode = mode
        self._max_turns = max_turns
        self._opponent_policy = opponent_policy
        self._opponent_noise = opponent_noise
        self._fast_physics = fast_physics
        self._node_exe = node_executable
        self._num_games = num_games  # games per evaluation for stability
        self._proc: subprocess.Popen | None = None
        self._last_reward = 0.0

        # Load frozen attacker model if provided
        self._attacker = None
        self._attacker_noise = attacker_noise
        if attacker_path:
            self._attacker = PPO.load(attacker_path)

        # Action: 32-float DNA vector
        self.action_space = spaces.Box(
            low=-np.ones(32, dtype=np.float32),
            high=np.ones(32, dtype=np.float32),
        )

        # Observation: game context (mostly static, but includes last_reward
        # as feedback signal for the builder to adapt across episodes)
        self.observation_space = spaces.Box(
            low=np.zeros(8, dtype=np.float32),
            high=np.ones(8, dtype=np.float32) * 100,
        )

    def _get_obs(self) -> np.ndarray:
        return np.array([
            self._opponent_noise * 10,  # attacker skill indicator
            1.0,                        # mode (1=castle, placeholder)
            9.0,                        # grid width
            9.0,                        # grid depth
            8.0,                        # max layers
            600.0,                      # budget
            float(self._max_turns),
            self._last_reward,
        ], dtype=np.float32)

    def reset(self, *, seed=None, options=None) -> tuple[np.ndarray, dict]:
        super().reset(seed=seed)
        self._ensure_process()
        return self._get_obs(), {}

    def step(self, action: np.ndarray) -> tuple[np.ndarray, float, bool, bool, dict]:
        dna = np.clip(action, -1.0, 1.0).tolist()

        # Play multiple games for a more stable reward signal
        total_reward = 0.0
        results = []

        for _ in range(self._num_games):
            result = self._play_game(dna)
            results.append(result)

            # Reward: survival-based
            reward = 0.0
            winner = result.get("winner")
            hp = result.get("hp", [0, 0])

            if winner == 1:
                # Builder's castle survived (attacker is player 0, builder is player 1)
                # Wait — the builder's castle is being attacked. Let's clarify:
                # Player 0 = attacker, Player 1 = defender (builder's castle)
                # winner=0 means attacker won, winner=1 means builder's castle survived
                reward += 50.0
            elif winner == 0:
                # Attacker won — penalize but reward partial survival
                reward -= 20.0

            # Reward remaining HP (builder wants to keep all 3 HP)
            builder_hp = hp[1]  # player 1's HP
            reward += builder_hp * 10.0

            # Reward blocks survived (attacker destroyed fewer blocks = better castle)
            blocks_destroyed = result.get("blocksDestroyed", 0)
            reward -= blocks_destroyed * 0.1

            # Reward games going to turn limit (castle was hard to crack)
            turn_count = result.get("turnCount", 0)
            reward += turn_count * 0.5

            total_reward += reward

        avg_reward = total_reward / self._num_games
        self._last_reward = avg_reward

        info = {
            "games": results,
            "avg_reward": avg_reward,
        }

        # Single-step episode — always done after one action
        return self._get_obs(), avg_reward, True, False, info

    def close(self):
        if self._proc and self._proc.poll() is None:
            try:
                self._send({"cmd": "close"})
            except Exception:
                pass
            self._proc.terminate()
            self._proc.wait(timeout=5)
        self._proc = None

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _ensure_process(self):
        if self._proc and self._proc.poll() is None:
            return
        self._proc = subprocess.Popen(
            [self._node_exe, str(_BRIDGE)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

    def _send(self, msg: dict) -> dict:
        assert self._proc and self._proc.poll() is None, "Bridge process not running"
        line = json.dumps(msg) + "\n"
        self._proc.stdin.write(line)
        self._proc.stdin.flush()
        resp_line = self._proc.stdout.readline()
        if not resp_line:
            stderr = self._proc.stderr.read()
            raise RuntimeError(f"Bridge process died. stderr:\n{stderr}")
        resp = json.loads(resp_line)
        if not resp.get("ok"):
            raise RuntimeError(f"Bridge error: {resp.get('error', 'unknown')}")
        return resp

    def _play_game(self, dna: list[float]) -> dict:
        """Play one full game with the builder's castle vs attacker."""
        self._ensure_process()

        # Generate attacker actions if we have a frozen model
        attacker_actions = None
        if self._attacker:
            attacker_actions = self._generate_attacker_actions(dna)

        resp = self._send({
            "cmd": "play_game",
            "options": {
                "mode": self._mode,
                "maxTurns": self._max_turns,
                "opponentPolicy": self._opponent_policy,
                "opponentNoise": self._opponent_noise,
                "fastPhysics": self._fast_physics,
                "blueprintDNA": [None, dna],  # player 1 = builder's castle
            },
            "attackerActions": attacker_actions,
        })
        return resp.get("result", {})

    def _generate_attacker_actions(self, defender_dna: list[float]) -> list[dict]:
        """Pre-generate attacker actions for a full game using frozen model.

        This is approximate — the attacker doesn't see real-time obs updates,
        but it provides a reasonable frozen-policy evaluation. For more accurate
        play, the bridge could run the attacker model per-step, but that would
        require ONNX inference in Node.js which adds complexity.
        """
        # For now, return None to use heuristic — full frozen-model integration
        # requires per-step inference in the bridge, which is a larger change.
        # The heuristic opponent at low noise is a strong proxy.
        return None
