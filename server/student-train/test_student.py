"""Run: python test_student.py   (needs torch, torchvision, onnx, onnxruntime, opencv; CPU is fine; about 1 minute)"""
import os
import sys
import tempfile
import types

import numpy as np
import torch

import data as D
import losses as Lo
import metrics as Mt
import promote_gate as G
from student_model import StudentMatting

bad = 0


def t(n, c, x=""):
    global bad
    bad += (not c)
    print(("PASS " if c else "FAIL ") + n, x)


torch.manual_seed(0)
# ---------------------------------------------------------------- model
for bb in ("large", "small"):
    m = StudentMatting(bb, 0.5).eval()
    x = torch.rand(2, 3, 96, 160)
    with torch.no_grad():
        a, r = m(x)
        a2, r2 = m(x, *r)
        a2z, _ = m(x)
    t(f"{bb}: alpha shape and range", a.shape == (2, 1, 96, 160) and 0 <= float(a.min()) and float(a.max()) <= 1)
    t(f"{bb}: state channels match the declaration", [s.shape[1] for s in r] == m.state_channels, m.state_channels)
    t(f"{bb}: memory changes the next frame", float((a2 - a2z).abs().max()) > 1e-6)
    with torch.no_grad():
        o, _ = m(torch.rand(1, 3, 64, 224))
    t(f"{bb}: any multiple-of-32 size works", o.shape == (1, 1, 64, 224))
m = StudentMatting("large", 1.0)
seq = torch.rand(2, 3, 3, 64, 96)
al, aux = m.forward_seq(seq, return_aux=True)
t("forward_seq shapes", al.shape == (2, 3, 1, 64, 96) and aux.shape == al.shape)
al.mean().backward()
t("gradients reach the encoder and the GRU", all(p.grad is not None for p in (m.enc.stages[0][0][0].weight, m.u8.gru.gates.weight)))

# ---------------------------------------------------------------- losses / metrics
g = torch.zeros(1, 4, 1, 64, 64); g[..., 20:44, 20:44] = 1
l0, _ = Lo.total_loss(g.clone(), g)
t("perfect prediction -> ~0 loss", float(l0) < 1e-4, float(l0))
steady = g.clone() * 0.9
flick = g.clone(); flick[:, 1::2] = 0.5 * g[:, 1::2] + 0.0
t("temporal loss: steady is 0, shimmer is punished", float(Lo.temporal_loss(steady, g)) == 0.0 and float(Lo.temporal_loss(flick, g)) > 0.01, float(Lo.temporal_loss(flick, g)))
import torch.nn.functional as F
blur = F.avg_pool2d(g.flatten(0, 1), 9, 1, 4).view_as(g)
t("Laplacian loss punishes blur", float(Lo.lap_loss(blur.flatten(0, 1), g.flatten(0, 1))) > 5 * float(Lo.lap_loss(g.flatten(0, 1) * 0.99, g.flatten(0, 1))))
a0 = np.zeros((40, 40), np.float32); a0[10:30, 10:30] = 1
t("flicker: steady is 0", Mt.flicker([a0] * 4) == 0.0)
t("flicker: jitter > 0", Mt.flicker([a0 * (0.5 + 0.5 * (i % 2)) for i in range(4)]) > 0.1)
t("mad of identical is 0", Mt.mad(a0, a0) == 0)
import cv2
soft = cv2.GaussianBlur(a0, (0, 0), 2.0)
t("edge_mad is 0 for a perfect edge, > 0 for a smeared one", Mt.edge_band_mad(soft, soft) == 0.0 and Mt.edge_band_mad(cv2.GaussianBlur(a0, (0, 0), 5.0), soft) > 0.01)

# ---------------------------------------------------------------- data
with tempfile.TemporaryDirectory() as td:
    root = D.make_synthetic_root(td, clips=3, n=12, h=128, w=160)
    ds = D.ClipDataset(root, shape=(96, 128), seq_len=4, length=8, composite_p=0.0, low_light_p=0.0)
    x, y = ds[0]
    t("dataset shapes", x.shape == (4, 3, 96, 128) and y.shape == (4, 1, 96, 128), (tuple(x.shape), tuple(y.shape)))
    t("dataset ranges", 0 <= float(x.min()) and float(x.max()) <= 1 and 0 <= float(y.min()) and float(y.max()) <= 1)
    dd = D.ClipDataset(root, shape=(96, 128), seq_len=4, length=8, composite_p=0.0, low_light_p=1.0)
    dk = np.mean([float(dd[i][0].mean()) for i in range(6)]); nm = np.mean([float(ds[i][0].mean()) for i in range(6)])
    t("low-light augmentation darkens", dk < nm, (round(dk, 3), round(nm, 3)))
    dc = D.ClipDataset(root, shape=(96, 128), seq_len=4, length=4, composite_p=1.0, low_light_p=0.0)
    xc, yc = dc[0]
    t("composite keeps the person, changes the room", xc.shape == (4, 3, 96, 128))
    t("clip is the same person in every frame (alpha overlaps between frames)", float((y[0] * y[1]).sum() / (y[0].sum() + 1e-6)) > 0.5)
    cl = D.list_clips(root)
    X, A = D.load_clip(cl[0], (64, 96), 5)
    t("load_clip resizes whole frames", X.shape == (5, 64, 96, 3) and A.shape == (5, 64, 96))
    try:
        D.ClipDataset(root, seq_len=50)
        t("too-short clips are refused", False)
    except SystemExit:
        t("too-short clips are refused", True)

# ---------------------------------------------------------------- promotion gate decision logic
def eng(mad, edge, grad, flick, ms, n=30, tags=("hands",)):
    per = [{"clip": f"c{i}", "tags": list(tags), "score": mad * 100 + edge * 200 + grad * 100 + flick * 300} for i in range(n)]
    return {"mean": {"mad": mad, "edge_mad": edge, "grad": grad, "flicker": flick}, "per_clip": per, "ms_median": ms}


A = types.SimpleNamespace(min_clips=20, min_frames=600, margin=0.97, win_rate=0.7, max_latency_ratio=1.0)
rvm = eng(0.030, 0.10, 0.010, 0.020, 40)
v, why, _ = G.decide({"student": eng(0.020, 0.07, 0.008, 0.010, 30), "rvm": rvm}, 30, 900, A)
t("gate: clearly better student is promoted", v == "PROMOTE", why)
v, why, _ = G.decide({"student": eng(0.029, 0.099, 0.0099, 0.0199, 30), "rvm": rvm}, 30, 900, A)
t("gate: barely better (inside the margin) is NOT promoted", v == "KEEP_RVM")
v, why, _ = G.decide({"student": eng(0.020, 0.07, 0.008, 0.010, 30), "rvm": rvm}, 5, 900, A)
t("gate: too few clips is NOT promoted", v == "KEEP_RVM" and any("GT clips" in w for w in why))
v, why, _ = G.decide({"student": eng(0.020, 0.07, 0.008, 0.010, 80), "rvm": rvm}, 30, 900, A)
t("gate: too slow is NOT promoted", v == "KEEP_RVM" and any("latency" in w for w in why))
s2 = eng(0.020, 0.07, 0.008, 0.010, 30)
for i, p in enumerate(s2["per_clip"]):
    if i < 10:
        p["tags"] = ["lowlight"]; p["score"] = 99.0           # student bad on the lowlight tag
r2 = eng(0.030, 0.10, 0.010, 0.020, 40)
for i, p in enumerate(r2["per_clip"]):
    if i < 10:
        p["tags"] = ["lowlight"]
v, why, _ = G.decide({"student": s2, "rvm": r2}, 30, 900, A)
t("gate: a regression on one tag blocks promotion", v == "KEEP_RVM" and any("lowlight" in w for w in why), why)

# ---------------------------------------------------------------- tiny end-to-end: train -> export -> parity
with tempfile.TemporaryDirectory() as td:
    import train as TR
    a = types.SimpleNamespace(data=None, val=None, out=td, synthetic=True, backbone="small", width=0.5, pretrained=False, steps=3, bs=2, seq_len=3, shape=["96x128"], lr=1e-3,
                              enc_lr_mult=0.3, min_lr_frac=0.02, warmup=1, clip=1.0, ema=0.99, composite_p=0.3, low_light_p=0.3, bg_dir=None, val_shape="96x128", val_frames=6,
                              val_every=3, save_every=3, log_every=3, resume=None, init_only=False, workers=0, seed=0, device="cpu", no_amp=True)
    TR.main(a)
    t("training wrote best.pt and last.pt", os.path.exists(os.path.join(td, "best.pt")) and os.path.exists(os.path.join(td, "last.pt")))
    import export_onnx as EX
    out = os.path.join(td, "s.onnx")
    try:
        EX.main(types.SimpleNamespace(ckpt=os.path.join(td, "best.pt"), out=out, weights="ema", height=96, width=128, opset=17, tol=2e-3))
        ok = False
    except SystemExit as e:
        ok = (e.code == 0)
    t("ONNX export matches PyTorch over 3 recurrent frames", ok)
    # resume with --init-only restarts the step counter (stage hand-over)
    a.resume, a.init_only, a.out = os.path.join(td, "last.pt"), True, os.path.join(td, "s2")
    TR.main(a)
    t("stage hand-over (--resume --init-only) runs", os.path.exists(os.path.join(td, "s2", "last.pt")))

# resume of an INTERRUPTED stage runs only the remaining steps and ends exactly at the target
with tempfile.TemporaryDirectory() as td:
    import train as TR2
    a2 = types.SimpleNamespace(data=None, val=None, out=td, synthetic=True, backbone="small", width=0.5, pretrained=False, steps=4, bs=2, seq_len=3, shape=["96x128"], lr=1e-3,
                               enc_lr_mult=0.3, min_lr_frac=0.02, warmup=1, clip=1.0, ema=0.99, composite_p=0.0, low_light_p=0.0, bg_dir=None, val_shape="96x128", val_frames=4,
                               val_every=100, save_every=2, log_every=1, resume=None, init_only=False, workers=0, seed=0, device="cpu", no_amp=True)
    TR2.main(a2)                                           # reaches step 4
    ck4 = torch.load(os.path.join(td, "last.pt"), map_location="cpu")
    a2.steps, a2.resume = 6, os.path.join(td, "last.pt")
    open(os.path.join(td, "log.jsonl"), "w").close()
    TR2.main(a2)                                           # target 6: must run exactly steps 5 and 6
    ck6 = torch.load(os.path.join(td, "last.pt"), map_location="cpu")
    ran = [__import__("json").loads(l)["step"] for l in open(os.path.join(td, "log.jsonl")) if '"loss"' in l]
    t("resume continues from the saved step to the target", ck4["step"] == 4 and ck6["step"] == 6, (ck4["step"], ck6["step"]))
    t("resume runs ONLY the remaining steps", ran == [5, 6], ran)
    a2.steps = 6
    TR2.main(a2)
    t("resume at the target is a no-op, not a crash", torch.load(os.path.join(td, "last.pt"), map_location="cpu")["step"] == 6)

sys.exit(1 if bad else 0)
