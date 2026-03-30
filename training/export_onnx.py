#!/usr/bin/env python3
"""
Export a trained SB3 PPO model to ONNX format for browser inference.

Usage:
    python export_onnx.py models/ppo_castle_final
    python export_onnx.py models/ppo_castle_final --output models/cannonfall_agent.onnx
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch
from stable_baselines3 import PPO


def export(model_path: str, output_path: str | None = None, obs_size: int | None = None):
    """Export SB3 PPO policy network to ONNX.

    The input tensor is named "observation" to match OnnxAI.js.
    Outputs both "action" (mean) and "log_std" (learned log standard
    deviation) so the browser can sample from the policy distribution.
    obs_size is auto-detected from the model's observation space if not provided.
    """
    print(f"Loading model from {model_path}...")
    model = PPO.load(model_path)
    policy = model.policy

    if obs_size is None:
        obs_size = model.observation_space.shape[0]
        print(f"Auto-detected observation size: {obs_size}")

    # SB3 MlpPolicy: policy.mlp_extractor + policy.action_net + policy.log_std
    policy.set_training_mode(False)

    print(f"Learned log_std: {policy.log_std.data.tolist()}")
    print(f"Learned std:     {policy.log_std.data.exp().tolist()}")

    class PolicyWrapper(torch.nn.Module):
        def __init__(self, sb3_policy):
            super().__init__()
            self.features_extractor = sb3_policy.features_extractor
            self.mlp_extractor = sb3_policy.mlp_extractor
            self.action_net = sb3_policy.action_net
            self.log_std = sb3_policy.log_std

        def forward(self, obs):
            features = self.features_extractor(obs)
            latent_pi, _ = self.mlp_extractor(features)
            mean = self.action_net(latent_pi)
            log_std = self.log_std.expand_as(mean)
            return mean, log_std

    wrapper = PolicyWrapper(policy)
    wrapper.eval()

    # Dummy input
    dummy = torch.randn(1, obs_size)

    # Export
    if output_path is None:
        output_path = str(Path(model_path).with_suffix(".onnx"))

    print(f"Exporting to {output_path}...")
    torch.onnx.export(
        wrapper,
        dummy,
        output_path,
        input_names=["observation"],
        output_names=["action", "action_log_std"],
        dynamic_axes={
            "observation": {0: "batch"},
            "action": {0: "batch"},
            "action_log_std": {0: "batch"},
        },
        opset_version=17,
    )

    # Ensure all weights are inlined (no external .data files).
    import onnx
    model_proto = onnx.load(output_path, load_external_data=True)
    onnx.save_model(model_proto, output_path, save_as_external_data=False)
    # Clean up any leftover .data file
    data_file = Path(output_path + ".data")
    if data_file.exists():
        data_file.unlink()

    # Verify with onnxruntime
    try:
        import onnxruntime as ort
        sess = ort.InferenceSession(output_path)

        input_names = [inp.name for inp in sess.get_inputs()]
        output_names = [out.name for out in sess.get_outputs()]
        print(f"Input tensors:  {input_names}")
        print(f"Output tensors: {output_names}")

        if "observation" not in input_names:
            print(f"WARNING: Expected input named 'observation', got {input_names}.")

        test_obs = np.random.randn(1, obs_size).astype(np.float32)
        result = sess.run(None, {"observation": test_obs})
        print(f"Verification passed.")
        print(f"  action shape: {result[0].shape}, sample: {result[0][0]}")
        print(f"  log_std shape: {result[1].shape}, sample: {result[1][0]}")
    except ImportError:
        print("onnxruntime not installed — skipping verification")

    print(f"Done. ONNX model saved to {output_path}")
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Export trained model to ONNX")
    parser.add_argument("model_path", type=str, help="Path to saved SB3 model")
    parser.add_argument("--output", type=str, default=None, help="Output ONNX path")
    parser.add_argument("--obs-size", type=int, default=None, help="Observation vector size (auto-detected from model if omitted)")
    args = parser.parse_args()

    export(args.model_path, args.output, args.obs_size)


if __name__ == "__main__":
    main()
