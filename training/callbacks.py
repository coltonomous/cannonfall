"""
Custom training callbacks for Cannonfall RL.
"""

from __future__ import annotations

from stable_baselines3.common.callbacks import BaseCallback


class CurriculumCallback(BaseCallback):
    """Ramp difficulty from `start` to `end` over `ramp_steps` timesteps.

    Works by updating the env's ``_difficulty`` attribute, which is sent
    to the bridge on the next ``reset()``.  Compatible with Monitor-wrapped
    CannonFallEnv instances.

    Usage:
        cb = CurriculumCallback(start=0.1, end=1.0, ramp_steps=150_000)
        model.learn(total_timesteps=200_000, callback=cb)
    """

    def __init__(
        self,
        start: float = 0.1,
        end: float = 1.0,
        ramp_steps: int = 150_000,
        verbose: int = 0,
    ):
        super().__init__(verbose)
        self.start = start
        self.end = end
        self.ramp_steps = ramp_steps

    def _on_step(self) -> bool:
        frac = min(self.num_timesteps / self.ramp_steps, 1.0)
        difficulty = self.start + (self.end - self.start) * frac

        # Update difficulty on the training env (unwrap Monitor if needed)
        env = self.training_env.envs[0]
        inner = env.env if hasattr(env.env, "_difficulty") else env
        if hasattr(inner, "_difficulty"):
            inner._difficulty = difficulty

        if self.verbose > 0 and self.num_timesteps % 10_000 == 0:
            self.logger.record("curriculum/difficulty", difficulty)

        return True
