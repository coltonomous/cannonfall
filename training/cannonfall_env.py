"""
Gymnasium environment for Cannonfall.

Communicates with a Node.js subprocess (bridge.js) that runs the
headless cannon-es physics simulation.  Each step = one shot.

Action space (Box, continuous):
    [yaw, pitch, power]  — normalised to [-1, 1] then rescaled

Observation space (Box, continuous):
    [targetDx, targetDy, targetDz, targetDist,
     cannonFacing,
     hp_self, hp_opponent,
     turnCount_normalised,
     lastHit (0/1), lastClosestDist_normalised]
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

# Paths
_HERE = Path(__file__).resolve().parent
_BRIDGE = _HERE / "env" / "bridge.js"


class CannonFallEnv(gym.Env):
    """Single-agent Cannonfall environment.

    The agent controls player 0 (always).  Player 1 is either idle (the
    agent effectively shoots at a static castle) or can be driven by an
    optional opponent policy later.
    """

    metadata = {"render_modes": []}

    # Action bounds (before rescaling)
    _YAW_RANGE = math.pi / 4        # MAX_YAW_OFFSET
    _PITCH_MIN = -0.15               # MIN_PITCH
    _PITCH_MAX = math.pi / 3         # MAX_PITCH
    _POWER_MIN = 10.0                # MIN_POWER
    _POWER_MAX = 50.0                # MAX_POWER

    def __init__(
        self,
        mode: str = "CASTLE",
        max_turns: int = 30,
        layout_generator: str = "random",
        node_executable: str = "node",
    ):
        super().__init__()

        self._mode = mode
        self._max_turns = max_turns
        self._layout_generator = layout_generator
        self._node_exe = node_executable
        self._proc: subprocess.Popen | None = None

        # --- spaces -----------------------------------------------------------
        # Actions normalised to [-1, 1]
        self.action_space = spaces.Box(
            low=np.array([-1.0, -1.0, -1.0], dtype=np.float32),
            high=np.array([1.0, 1.0, 1.0], dtype=np.float32),
        )

        # Observation: fixed-size numeric vector
        # [targetDx, targetDy, targetDz, targetDist,
        #  cannonFacing, hp_self, hp_opp, turnFrac,
        #  lastHit, lastClosestDistNorm]
        obs_low = np.full(10, -np.inf, dtype=np.float32)
        obs_high = np.full(10, np.inf, dtype=np.float32)
        # Bounded entries
        obs_low[4] = -1;  obs_high[4] = 1     # facing
        obs_low[5] = 0;   obs_high[5] = 3     # hp
        obs_low[6] = 0;   obs_high[6] = 3
        obs_low[7] = 0;   obs_high[7] = 1     # turn fraction
        obs_low[8] = 0;   obs_high[8] = 1     # lastHit
        obs_low[9] = 0;   obs_high[9] = 1     # closestDist normalised
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

        # Gymnasium API: terminated vs truncated
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
        """Spawn the Node.js bridge if not already running."""
        if self._proc and self._proc.poll() is None:
            return
        self._proc = subprocess.Popen(
            [self._node_exe, str(_BRIDGE)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,  # line-buffered
        )

    def _send(self, msg: dict) -> dict:
        """Send a JSON command and read the JSON response."""
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
        """Map [-1, 1] actions to game-native ranges."""
        a = np.clip(action, -1.0, 1.0)
        yaw = float(a[0]) * self._YAW_RANGE
        # pitch: [-1,1] → [PITCH_MIN, PITCH_MAX]
        pitch = self._PITCH_MIN + (float(a[1]) + 1) / 2 * (self._PITCH_MAX - self._PITCH_MIN)
        # power: [-1,1] → [POWER_MIN, POWER_MAX]
        power = self._POWER_MIN + (float(a[2]) + 1) / 2 * (self._POWER_MAX - self._POWER_MIN)
        return yaw, pitch, power

    def _parse_obs(self, raw: dict) -> np.ndarray:
        """Convert bridge observation dict to fixed-size numpy vector."""
        max_dist = 80.0  # normalisation constant

        last_hit = 0.0
        if raw.get("lastHit") is True:
            last_hit = 1.0

        last_close = 1.0  # default = far
        if raw.get("lastClosestDist") is not None:
            last_close = min(raw["lastClosestDist"] / max_dist, 1.0)

        turn_frac = raw["turnCount"] / self._max_turns

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
        ], dtype=np.float32)
