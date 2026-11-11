"""Run: python test_export_e2e.py  - end-to-end wiring test of studio_export.py (clean engine) with a STAND-IN matte model.
Real BiRefNet weights are NOT used here (they need ~12 GB RAM at 1024 px); this proves video in -> alpha -> fusion -> scene look -> video out."""
import json, os, subprocess, sys, tempfile, types
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
bad = 0
def t(n, c, x=""):
    global bad; bad += (not c); print(("PASS " if c else "FAIL ") + n, x)

tmp = tempfile.mkdtemp(prefix="gen_e2e_")
H, W, N = 144, 256, 20
rng = np.random.default_rng(5)
base = cv2.GaussianBlur((rng.random((H, W, 3)) * 120 + 60).astype(np.uint8), (0, 0), 5)
vid = os.path.join(tmp, "clip.mp4")
vw = cv2.VideoWriter(vid, cv2.VideoWriter_fourcc(*"mp4v"), 20, (W, H))
for i in range(N):
    f = base.copy(); x0 = 70 + 2 * i
    f[30:130, x0:x0 + 70] = (190, 140, 110)
    vw.write(cv2.cvtColor(f, cv2.COLOR_RGB2BGR))
vw.release()
bgp = os.path.join(tmp, "scene.png"); sc = np.zeros((H, W, 3), np.uint8); sc[:, :W // 2] = (230, 190, 120); sc[:, W // 2:] = (40, 50, 90)
cv2.imwrite(bgp, cv2.cvtColor(sc, cv2.COLOR_RGB2BGR))

# stand-in runner: finds the person by colour and adds shimmer to the edge, like a per-frame model would
mod = types.ModuleType("birefnet_runner")
class BiRefNetRunner:
    backend = "stand-in"
    def __init__(self, *a, **k): self.r = np.random.default_rng(1)
    def alpha(self, rgb):
        m = (np.abs(rgb.astype(int) - np.array([190, 140, 110])).sum(-1) < 40).astype(np.float32)
        m = cv2.GaussianBlur(m, (0, 0), 1.2)
        edge = (m > 0.02) & (m < 0.98)
        return np.where(edge, np.clip(m + self.r.uniform(-.35, .35, m.shape), 0, 1), m).astype(np.float32)
mod.BiRefNetRunner = BiRefNetRunner
sys.modules["birefnet_runner"] = mod

import studio_export as E
out = os.path.join(tmp, "out.mp4")
args = E.argparse.Namespace(input=vid, output=out, engine="clean", background=bgp, out_mode="composite", look="scene", harmonise=.3, wrap=.35,
                            shadow=.3, grain=.8, mask_model="matting", birefnet_onnx=None, size=256, no_temporal=False, causal=False,
                            first_mask=None, start_frame=-1, max_size=0, warmup=10, erode=10, dilate=10)
import io, contextlib
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    E.main(args)
lines = [json.loads(l) for l in buf.getvalue().splitlines() if l.startswith("{")]
done = [l for l in lines if l.get("stage") == "done"][0]
t("finished line is emitted", done["frames"] == N and done["engine"] == "clean", str(done))
t("temporal fusion lowered the flicker the exporter reports", done["flicker"] < 0.7 * done["flicker_before_fusion"], f"{done['flicker_before_fusion']} -> {done['flicker']}")
cap = cv2.VideoCapture(out); n_out = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)); ok, fr = cap.read(); cap.release()
t("output video has every frame and the right size", n_out == N and fr.shape[:2] == (H, W), f"{n_out} {fr.shape}")
fr = cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)
t("output shows the scene (bright left half)", fr[5, 5].astype(int).sum() > fr[5, W - 5].astype(int).sum() + 150, f"{fr[5,5]} {fr[5,W-5]}")
# plain look + alpha mode + no-temporal still run
for kw in ({"look": "plain"}, {"out_mode": "alpha"}, {"no_temporal": True}, {"causal": True}):
    a2 = E.argparse.Namespace(**{**vars(args), **kw, "output": os.path.join(tmp, "o2.mp4")})
    with contextlib.redirect_stdout(io.StringIO()):
        E.main(a2)
    t("variant runs: " + ",".join(kw), os.path.getsize(a2.output) > 1000)
sys.exit(1 if bad else 0)
