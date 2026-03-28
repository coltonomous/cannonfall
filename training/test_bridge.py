#!/usr/bin/env python3
"""
Integration smoke test for the Python ↔ Node.js bridge.

Spawns bridge.js as a subprocess and verifies the JSON protocol
works end-to-end: reset, step, get_config, close.

Run:
    python test_bridge.py
    # or via pytest:
    pytest test_bridge.py -v
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_BRIDGE = _HERE / "env" / "bridge.js"


class BridgeProcess:
    """Thin wrapper around the bridge subprocess for testing."""

    def __init__(self):
        self.proc = subprocess.Popen(
            ["node", str(_BRIDGE)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

    def send(self, msg: dict) -> dict:
        line = json.dumps(msg) + "\n"
        self.proc.stdin.write(line)
        self.proc.stdin.flush()
        resp_line = self.proc.stdout.readline()
        if not resp_line:
            stderr = self.proc.stderr.read()
            raise RuntimeError(f"Bridge died. stderr:\n{stderr}")
        return json.loads(resp_line)

    def close(self):
        if self.proc.poll() is None:
            try:
                self.send({"cmd": "close"})
            except Exception:
                pass
            self.proc.terminate()
            self.proc.wait(timeout=5)


# ── Tests ────────────────────────────────────────────────────


def test_get_config():
    """get_config should return available modes and action space bounds."""
    bridge = BridgeProcess()
    try:
        resp = bridge.send({"cmd": "get_config"})
        assert resp["ok"] is True
        assert "CASTLE" in resp["config"]["modes"]
        assert resp["config"]["actionSpace"]["yaw"]["min"] < 0
        assert resp["config"]["actionSpace"]["power"]["max"] > 0
    finally:
        bridge.close()


def test_reset_returns_observation():
    """reset should return a valid observation dict."""
    bridge = BridgeProcess()
    try:
        resp = bridge.send({
            "cmd": "reset",
            "options": {"mode": "CASTLE", "maxTurns": 10},
        })
        assert resp["ok"] is True
        obs = resp["observation"]
        assert "targetDx" in obs
        assert "targetDist" in obs
        assert "hp" in obs
        assert len(obs["hp"]) == 2
        assert obs["turnCount"] == 0
        assert isinstance(obs["blockPositions"], list)
    finally:
        bridge.close()


def test_step_returns_result():
    """step should return observation, reward, done, and info."""
    bridge = BridgeProcess()
    try:
        bridge.send({
            "cmd": "reset",
            "options": {"mode": "CASTLE", "maxTurns": 10, "opponentPolicy": "none"},
        })
        resp = bridge.send({
            "cmd": "step",
            "action": {"yaw": 0.0, "pitch": 0.5, "power": 30.0},
        })
        assert resp["ok"] is True
        assert "observation" in resp
        assert "reward" in resp
        assert "done" in resp
        assert "info" in resp
        assert isinstance(resp["reward"], (int, float))
        assert resp["info"]["turnCount"] >= 1
    finally:
        bridge.close()


def test_full_game_loop():
    """Play a full game (maxTurns=4, no opponent) without errors."""
    bridge = BridgeProcess()
    try:
        bridge.send({
            "cmd": "reset",
            "options": {"mode": "CASTLE", "maxTurns": 4, "opponentPolicy": "none"},
        })
        done = False
        steps = 0
        while not done and steps < 10:
            resp = bridge.send({
                "cmd": "step",
                "action": {"yaw": 0.0, "pitch": 0.3, "power": 25.0},
            })
            assert resp["ok"] is True
            done = resp["done"]
            steps += 1
        assert done, "Game should end within maxTurns"
    finally:
        bridge.close()


def test_step_before_reset_errors():
    """step without reset should return an error."""
    bridge = BridgeProcess()
    try:
        resp = bridge.send({
            "cmd": "step",
            "action": {"yaw": 0.0, "pitch": 0.5, "power": 30.0},
        })
        assert resp["ok"] is False
        assert "error" in resp
    finally:
        bridge.close()


def test_difficulty_parameter():
    """difficulty parameter should be accepted without error."""
    bridge = BridgeProcess()
    try:
        resp = bridge.send({
            "cmd": "reset",
            "options": {
                "mode": "CASTLE",
                "maxTurns": 10,
                "difficulty": 0.3,
                "layoutGenerator": "curriculum",
            },
        })
        assert resp["ok"] is True
    finally:
        bridge.close()


def test_self_play_returns_opponent_observation():
    """self-play mode should include opponentObservation in step response."""
    bridge = BridgeProcess()
    try:
        bridge.send({
            "cmd": "reset",
            "options": {"mode": "CASTLE", "maxTurns": 10, "opponentPolicy": "self"},
        })
        resp = bridge.send({
            "cmd": "step",
            "action": {"yaw": 0.0, "pitch": 0.5, "power": 30.0},
            "opponentAction": {"yaw": 0.0, "pitch": 0.5, "power": 30.0},
        })
        assert resp["ok"] is True
        assert "opponentObservation" in resp
        opp_obs = resp["opponentObservation"]
        assert "targetDx" in opp_obs
        assert opp_obs["cannonFacing"] == -1  # player 1 faces opposite
    finally:
        bridge.close()


def test_observation_has_block_features():
    """Observation should include blockPositions and blockCount."""
    bridge = BridgeProcess()
    try:
        resp = bridge.send({
            "cmd": "reset",
            "options": {"mode": "CASTLE", "maxTurns": 10},
        })
        obs = resp["observation"]
        assert "blockCount" in obs
        assert "blockPositions" in obs
        assert obs["blockCount"] == len(obs["blockPositions"])
        if obs["blockCount"] > 0:
            bp = obs["blockPositions"][0]
            assert "x" in bp and "y" in bp and "z" in bp
    finally:
        bridge.close()


# ── CLI runner ───────────────────────────────────────────────

def _run_all():
    """Simple test runner for use without pytest."""
    tests = [
        test_get_config,
        test_reset_returns_observation,
        test_step_returns_result,
        test_full_game_loop,
        test_step_before_reset_errors,
        test_difficulty_parameter,
        test_self_play_returns_opponent_observation,
        test_observation_has_block_features,
    ]
    passed = 0
    failed = 0
    for test_fn in tests:
        name = test_fn.__name__
        try:
            test_fn()
            print(f"  PASS  {name}")
            passed += 1
        except Exception as e:
            print(f"  FAIL  {name}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(_run_all())
