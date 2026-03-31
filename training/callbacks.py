"""
Custom training callbacks for Cannonfall RL.
"""

from __future__ import annotations

from stable_baselines3.common.callbacks import BaseCallback


class CurriculumCallback(BaseCallback):
    """Ramp difficulty from `start` to `end` over `ramp_steps` timesteps.

    Works by updating the env's ``_difficulty`` attribute, which is sent
    to the bridge on the next ``reset()``.  Also ramps opponent noise
    down (EASY → HARD) so the agent faces tougher opponents as it improves.

    Compatible with Monitor-wrapped CannonFallEnv instances.

    Usage:
        cb = CurriculumCallback(start=0.1, end=1.0, ramp_steps=150_000)
        model.learn(total_timesteps=200_000, callback=cb)
    """

    def __init__(
        self,
        start: float = 0.1,
        end: float = 1.0,
        ramp_steps: int = 150_000,
        opponent_noise_start: float = 0.15,
        opponent_noise_end: float = 0.04,
        verbose: int = 0,
    ):
        super().__init__(verbose)
        self.start = start
        self.end = end
        self.ramp_steps = ramp_steps
        self.opponent_noise_start = opponent_noise_start
        self.opponent_noise_end = opponent_noise_end

    def _on_step(self) -> bool:
        frac = min(self.num_timesteps / self.ramp_steps, 1.0)
        difficulty = self.start + (self.end - self.start) * frac
        opponent_noise = self.opponent_noise_start + (self.opponent_noise_end - self.opponent_noise_start) * frac

        # Update difficulty and opponent noise on all training envs
        # (handles both DummyVecEnv and SubprocVecEnv via set_attr)
        try:
            self.training_env.set_attr("_difficulty", difficulty)
            self.training_env.set_attr("_opponent_noise", opponent_noise)
        except AttributeError:
            for env in self.training_env.envs:
                inner = env.env if hasattr(env.env, "_difficulty") else env
                if hasattr(inner, "_difficulty"):
                    inner._difficulty = difficulty
                if hasattr(inner, "_opponent_noise"):
                    inner._opponent_noise = opponent_noise

        if self.verbose > 0 and self.num_timesteps % 10_000 == 0:
            self.logger.record("curriculum/difficulty", difficulty)
            self.logger.record("curriculum/opponent_noise", opponent_noise)

        return True
