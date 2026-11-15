"""Regression tests for export sizing and fail-closed matte input handling."""
import os, sys, tempfile
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import studio_export as E
import birefnet_runner as B

bad = 0
def t(name, cond, extra=""):
    global bad
    bad += (not cond)
    print(("PASS " if cond else "FAIL ") + name, extra)

# Max-side semantics must hold for both landscape and portrait input.
t("landscape bounds the longest edge", E.scaled_even_size(1920, 1080, 720) == (720, 406), E.scaled_even_size(1920,1080,720))
t("portrait bounds the longest edge", E.scaled_even_size(1080, 1920, 720) == (406, 720), E.scaled_even_size(1080,1920,720))
t("small input is not upscaled", E.scaled_even_size(640, 360, 1080) == (640, 360))
t("zero max-side disables downscaling but makes dimensions even", E.scaled_even_size(641, 361, 0) == (640, 360))
t("max-side is based on the long side, not the short side", max(E.scaled_even_size(3840,2160,1080)) <= 1080)
odd_limit_size = E.scaled_even_size(3840, 2160, 999)
t("odd max-side is rounded down and never exceeded", max(odd_limit_size) <= 999 and max(odd_limit_size) == 998, odd_limit_size)
try:
    E.scaled_even_size(1, 100, 720); invalid_dims_rejected = False
except ValueError:
    invalid_dims_rejected = True
t("invalid frame dimensions are rejected", invalid_dims_rejected)

# Exercise the actual decoder path: max_size must bound the long edge.
import cv2
with tempfile.TemporaryDirectory(prefix="gen_resize_") as td:
    vp = os.path.join(td, "wide.mp4")
    writer = cv2.VideoWriter(vp, cv2.VideoWriter_fourcc(*"mp4v"), 5, (640, 360))
    for _ in range(2): writer.write(np.full((360, 640, 3), 120, np.uint8))
    writer.release()
    decoded, _fps = E.read_frames(vp, 180)
    t("read_frames applies max_size to the longest edge", bool(decoded) and max(decoded[0].shape[:2]) <= 180, decoded[0].shape[:2] if decoded else None)

# Exercise the output sanitation contract without requiring model weights.
class FakeOnnx:
    def run(self, *_): return [np.array([[[[np.nan, -0.2], [0.4, 1.2]]]], dtype=np.float32)]
runner = B.BiRefNetRunner.__new__(B.BiRefNetRunner)
runner.size = 64; runner.onnx = FakeOnnx(); runner.in_name = "input"; runner.net = None
try:
    import cv2
    out = runner.alpha(np.zeros((8, 12, 3), np.uint8))
    clean = out.shape == (8,12) and out.dtype == np.float32 and np.isfinite(out).all() and out.min() >= 0 and out.max() <= 1
except Exception as exc:
    clean = False; print("  output check exception:", repr(exc))
t("BiRefNet ONNX alpha is finite and clamped", clean)
try:
    runner.alpha(np.zeros((8, 12, 4), np.uint8)); invalid_rgb_rejected = False
except ValueError:
    invalid_rgb_rejected = True
t("invalid non-RGB model input is rejected", invalid_rgb_rejected)
try:
    B.BiRefNetRunner(HERE, onnx_path=os.path.join(HERE, "weights", "definitely_missing_test_model.onnx"))
    missing_onnx_rejected = False
except FileNotFoundError as exc:
    missing_onnx_rejected = "Requested BiRefNet ONNX weights are missing" in str(exc)
t("explicit missing ONNX model path fails with an actionable error", missing_onnx_rejected)
sys.exit(1 if bad else 0)
