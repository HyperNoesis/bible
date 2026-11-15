"""Run the shipped live ONNX models through the bundled ORT-WASM runtime.

Uses a stylised synthetic person clip and a supplied pixel mask. It is useful
for verifying the packaged model/runtime and comparing RVM analysis scales;
it is not a real-person or Android quality certification.

Run from the project root:
    python tools/e2e/model_onnx_fixture_bench.py
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "tools" / "e2e" / "fixtures"
N_FRAMES = 12

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def prepare_frames(path, width, height):
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open fixture video: {path}")
    frames = []
    while len(frames) < N_FRAMES:
        ok, bgr = cap.read()
        if not ok:
            break
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        frames.append(cv2.resize(rgb, (width, height), interpolation=cv2.INTER_LINEAR))
    cap.release()
    if len(frames) != N_FRAMES:
        raise RuntimeError(f"Expected {N_FRAMES} fixture frames, got {len(frames)}")
    return np.stack(frames).astype(np.uint8)

def metrics(alpha_path, width, height, gt, frames=N_FRAMES):
    raw = np.fromfile(alpha_path, dtype=np.uint8)
    expected = frames * width * height
    if raw.size != expected:
        raise RuntimeError(f"Unexpected mask data length at {alpha_path}: {raw.size} != {expected}")
    masks = raw.reshape(frames, height, width)
    target_size = (160, 120)
    gt_small = cv2.resize(gt, target_size, interpolation=cv2.INTER_LINEAR) > 127
    pred = [cv2.resize(m, target_size, interpolation=cv2.INTER_LINEAR) for m in masks]
    ious = []
    for p in pred:
        pb = p > 127
        i = np.logical_and(pb, gt_small).sum()
        u = np.logical_or(pb, gt_small).sum()
        ious.append(float(i / max(1, u)))
    flicker = float(np.mean([np.abs(pred[i].astype(np.float32) - pred[i-1].astype(np.float32)).mean()
                             for i in range(1, len(pred))]))
    return {"meanIoU": round(float(np.mean(ious)), 4), "lastFrameIoU": round(ious[-1], 4),
            "minFrameIoU": round(float(np.min(ious)), 4), "maskFlicker255": round(flicker, 3),
            "meanForegroundCoverage": round(float(np.mean([(p > 127).mean() for p in pred])), 4),
            "groundTruthCoverage": round(float(gt_small.mean()), 4)}

def main():
    models = [ROOT / "models" / "rvm_mobilenetv3_fp32.onnx", ROOT / "models" / "modnet.onnx"]
    for model in models:
        if not model.is_file():
            raise FileNotFoundError(f"Model missing: {model}")
    video = FIX / "raw_clip.webm"
    gt_path = FIX / "gt_alpha_640x480.png"
    rvm_frames = prepare_frames(video, 448, 336)
    mod_frames = prepare_frames(video, 448, 352)
    gt = cv2.imread(str(gt_path), cv2.IMREAD_GRAYSCALE)
    if gt is None:
        raise RuntimeError(f"Ground-truth fixture missing: {gt_path}")
    with tempfile.TemporaryDirectory(prefix="genesis_onnx_bench_") as td:
        td = Path(td)
        rvm_frames.tofile(td / "frames-rvm.rgb")
        mod_frames.tofile(td / "frames-modnet.rgb")
        runner = ROOT / "tools" / "e2e" / "model_onnx_fixture_bench.js"
        cmd = ["node", str(runner), str(ROOT), str(td), str(N_FRAMES)]
        proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
        # The Node runner emits one compact JSON object on stdout; WASM may print warnings to stderr.
        timings = json.loads(proc.stdout.strip().splitlines()[-1])
        report = []
        for row in timings:
            if row["engine"] == "rvm":
                row.update(metrics(td / f"rvm-{row['analysisEdge']}.alpha", 448, 336, gt))
            else:
                row.update(metrics(td / "modnet.alpha", 448, 352, gt))
            report.append(row)
        result = {
            "fixture": "stylised synthetic person / 12 frames / ground-truth alpha",
            "runtime": "bundled ONNX Runtime Web, WASM, one thread, Node.js",
            "models": {model.name: sha256(model) for model in models},
            "results": report,
            "limitations": ["not real-person evidence", "not browser camera/WebGL", "not Android performance", "no physical-device thermal or memory measurements"]
        }
        print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
