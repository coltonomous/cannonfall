"""
Gymnasium environment for Cannonfall.

Communicates with a Node.js subprocess (bridge.js) that runs the
headless cannon-es physics simulation.  Each step = one agent shot
followed by an automatic opponent shot.

Action space (Box, continuous):
    [yaw, pitch, power]  — normalised to [-1, 1] then rescaled

Observation space (Box, continuous, 14 features):
    [targetDx, targetDy, targetDz, targetDist,
     cannonFacing,
     hp_self, hp_opponent,
     turnCount_normalised,
     lastHit (0/1), lastClosestDist_normalised,
     opponentLastHit (0/1),
     blockCount_normalised,
     avgBlockDist_normalised,
     blockSpreadY_normalised]
"""

from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path

import gymnasium as gym
import numpy as np
from gymnasium import spaces

_HERE = Path(__file__).resolve().parent
_BRIDGE = _HERE / "env" / "bridge.js"


class CannonFallEnv(gym.Env):
    """Single-agent Cannonfall environment.

    The agent always controls player 0.  Player 1 is driven by the
    configured opponent policy (heuristic, random, or none).
    """

    metadata = {"render_modes": []}

    _YAW_RANGE = math.pi / 4
    _PITCH_MIN = -0.15
    _PITCH_MAX = math.pi / 3
    _POWER_MIN = 10.0
    _POWER_MAX = 50.0

    def __init__(
        self,
        mode: str = "CASTLE",
        max_turns: int = 30,
        layout_generator: str = "mixed",
        opponent_policy: str = "heuristic",
        opponent_noise: float = 0.1,
        difficulty: float = 1.0,
        fast_physics: bool = False,
        node_executable: str = "node",
    ):
        super().__init__()

        self._mode = mode
        self._max_turns = max_turns
        self._layout_generator = layout_generator
        self._opponent_policy = opponent_policy
        self._opponent_noise = opponent_noise
        self._difficulty = difficulty
        self._fast_physics = fast_physics
        self._node_exe = node_executable
        self._proc: subprocess.Popen | None = None

        # Actions normalised to [-1, 1]
        self.action_space = spaces.Box(
            low=np.array([-1.0, -1.0, -1.0], dtype=np.float32),
            high=np.array([1.0, 1.0, 1.0], dtype=np.float32),
        )

        # Observation: 14-element fixed-size vector
        obs_low = np.full(14, -np.inf, dtype=np.float32)
        obs_high = np.full(14, np.inf, dtype=np.float32)
        obs_low[4] = -1;   obs_high[4] = 1      # facing
        obs_low[5] = 0;    obs_high[5] = 3      # hp self
        obs_low[6] = 0;    obs_high[6] = 3      # hp opponent
        obs_low[7] = 0;    obs_high[7] = 1      # turn fraction
        obs_low[8] = 0;    obs_high[8] = 1      # lastHit
        obs_low[9] = 0;    obs_high[9] = 1      # closestDist norm
        obs_low[10] = 0;   obs_high[10] = 1     # opponentLastHit
        obs_low[11] = 0;   obs_high[11] = 1     # blockCount norm
        obs_low[12] = 0;   obs_high[12] = 1     # avgBlockDist norm
        obs_low[13] = 0;   obs_high[13] = 1     # blockSpreadY norm
        self.observation_space = spaces.Box(low=obs_low, high=obs_high, dtype=np.float32)

    # ------------------------------------------------------------------
    # Gym interface
    # ------------------------------------------------------------------

    def reset(self, *, seed=None, options=None) -> tuple[np.ndarray, dict]:
        super().reset(seed=seed)
        self._ensure_process()
        resp = self._send({
            "cmd": "reset",
            "options": {
                "mode": self._mode,
                "maxTurns": self._max_turns,
                "layoutGenerator": self._layout_generator,
                "opponentPolicy": self._opponent_policy,
                "opponentNoise": self._opponent_noise,
                "difficulty": self._difficulty,
                "fastPhysics": self._fast_physics,
            },
        })
        obs = self._parse_obs(resp["observation"])
        return obs, {}

    def step(self, action: np.ndarray) -> tuple[np.ndarray, float, bool, bool, dict]:
        yaw, pitch, power = self._rescale_action(action)
        resp = self._send({
            "cmd": "step",
            "action": {"yaw": yaw, "pitch": pitch, "power": power},
        })
        obs = self._parse_obs(resp["observation"])
        reward = float(resp["reward"])
        done = bool(resp["done"])
        info = resp.get("info", {})

        terminated = done and info.get("winner") is not None
        truncated = done and info.get("winner") is None
        return obs, reward, terminated, truncated, info

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

    def _rescale_action(self, action: np.ndarray) -> tuple[float, float, float]:
        a = np.clip(action, -1.0, 1.0)
        yaw = float(a[0]) * self._YAW_RANGE
        pitch = self._PITCH_MIN + (float(a[1]) + 1) / 2 * (self._PITCH_MAX - self._PITCH_MIN)
        power = self._POWER_MIN + (float(a[2]) + 1) / 2 * (self._POWER_MAX - self._POWER_MIN)
        return yaw, pitch, power

    def _parse_obs(self, raw: dict) -> np.ndarray:
        max_dist = 80.0
        max_blocks = 200.0  # normalisation ceiling for block count

        last_hit = 1.0 if raw.get("lastHit") is True else 0.0

        last_close = 1.0
        if raw.get("lastClosestDist") is not None:
            last_close = min(raw["lastClosestDist"] / max_dist, 1.0)

        opp_hit = 1.0 if raw.get("opponentLastHit") is True else 0.0
        turn_frac = raw["turnCount"] / self._max_turns

        # Block position summary features
        block_positions = raw.get("blockPositions", [])
        block_count_norm = min(len(block_positions) / max_blocks, 1.0)

        avg_block_dist = 0.0
        block_spread_y = 0.0
        if block_positions:
            dists = [math.sqrt(b["x"]**2 + b["y"]**2 + b["z"]**2) for b in block_positions]
            avg_block_dist = min(sum(dists) / len(dists) / max_dist, 1.0)
            ys = [b["y"] for b in block_positions]
            block_spread_y = min((max(ys) - min(ys)) / 10.0, 1.0)

        return np.array([
            raw["targetDx"],
            raw["targetDy"],
            raw["targetDz"],
            raw["targetDist"],
            float(raw["cannonFacing"]),
            float(raw["hp"][0]),
            float(raw["hp"][1]),
            turn_frac,
            last_hit,
            last_close,
            opp_hit,
            block_count_norm,
            avg_block_dist,
            block_spread_y,
        ], dtype=np.float32)
