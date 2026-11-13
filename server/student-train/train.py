#!/usr/bin/env python3
"""Train the Genesis live matting student by distillation from teacher-labelled clips (see make_teacher_data.py).

Three-stage schedule (run_all.sh): short low-res sequences first (fast, learns the shape of a person), then longer sequences at higher resolution
(learns memory and steadiness), then a long fine-tune at the resolution the browser actually runs. Each stage resumes from the last.

  python train.py --data clips/train --val clips/val --out runs/s1 --steps 20000 --seq-len 4 --shape 256x256 --shape 224x384
  python train.py --synthetic --out runs/smoke --steps 6 --bs 2 --seq-len 3 --shape 96x128 --val-every 3      # CPU smoke test (proves the code runs)

Checkpoints: out/last.pt, out/best.pt (lowest validation composite score, EMA weights). Logs: out/log.jsonl.
"""
import argparse
import copy
import json
import math
import os
import random
import time

import numpy as np
import torch
from torch.utils.data import DataLoader

import data as D
import losses as Lo
import metrics as Mt
from student_model import StudentMatting, count_params


def parse_shape(s):
    h, w = s.lower().split("x")
    h, w = int(h), int(w)
    assert h % 32 == 0 and w % 32 == 0, f"shape {s}: both sides must be multiples of 32"
    return h, w


@torch.no_grad()
def validate(model, val_clips, shape, max_frames, device):
    model.eval()
    per, allm = [], []
    for c in val_clips:
        X, A = D.load_clip(c, shape, max_frames)
        x = torch.from_numpy(X.astype(np.float32) / 255.0).permute(0, 3, 1, 2).to(device)
        r, preds = [None] * 4, []
        for t in range(x.shape[0]):
            a, r = model(x[t:t + 1], *r)
            preds.append(a[0, 0].float().cpu().numpy())
        m = Mt.evaluate(preds, list(A))
        per.append({"clip": os.path.basename(c["dir"]), "tags": c["tags"], **m})
        allm.append(m)
    mean = {k: float(np.mean([m[k] for m in allm])) for k in allm[0] if k != "frames"}
    mean["score"] = Mt.composite_score(mean)
    model.train()
    return mean, per


def make_loaders(a, root, n_steps):
    loaders = []
    for s in a.shape:
        ds = D.ClipDataset(root, parse_shape(s), a.seq_len, length=max(1, n_steps) * a.bs + 1, composite_p=a.composite_p, low_light_p=a.low_light_p, bg_dir=a.bg_dir, seed=a.seed)
        loaders.append(iter(DataLoader(ds, batch_size=a.bs, shuffle=False, num_workers=a.workers, drop_last=True, persistent_workers=a.workers > 0)))
    return loaders


def main(a):
    random.seed(a.seed); np.random.seed(a.seed); torch.manual_seed(a.seed)
    device = a.device or ("cuda" if torch.cuda.is_available() else "cpu")
    os.makedirs(a.out, exist_ok=True)
    root, val_root = a.data, a.val
    if a.synthetic:
        root = D.make_synthetic_root(os.path.join(a.out, "synthetic_train"), clips=4, n=12, h=128, w=160, seed=1)
        val_root = D.make_synthetic_root(os.path.join(a.out, "synthetic_val"), clips=2, n=10, h=128, w=160, seed=99)
    if not root:
        raise SystemExit("--data is required (or --synthetic for a smoke test)")
    val_clips = D.list_clips(val_root) if val_root else []
    model = StudentMatting(a.backbone, a.width, pretrained=a.pretrained).to(device)
    ema = copy.deepcopy(model).eval()
    for p in ema.parameters():
        p.requires_grad_(False)
    enc_params = list(model.enc.parameters())
    ids = {id(p) for p in enc_params}
    dec_params = [p for p in model.parameters() if id(p) not in ids]
    opt = torch.optim.AdamW([{"params": enc_params, "lr": a.lr * a.enc_lr_mult}, {"params": dec_params, "lr": a.lr}], weight_decay=1e-4)
    base = [g["lr"] for g in opt.param_groups]
    step0, best = 0, float("inf")
    for path in ([a.resume] if a.resume else []):
        ck = torch.load(path, map_location=device)
        model.load_state_dict(ck["model"]); ema.load_state_dict(ck["ema"])
        if not a.init_only and "opt" in ck:
            opt.load_state_dict(ck["opt"]); step0 = ck.get("step", 0); best = ck.get("best", best)
        print(json.dumps({"resumed": path, "step": step0, "init_only": a.init_only}), flush=True)
    print(json.dumps({"params_m": round(count_params(model) / 1e6, 3), "device": device, "backbone": a.backbone, "width": a.width, "shapes": a.shape, "seq_len": a.seq_len}), flush=True)
    loaders = make_loaders(a, root, a.steps - step0)
    amp = device == "cuda" and not a.no_amp
    logf = open(os.path.join(a.out, "log.jsonl"), "a")
    model.train()
    t0 = time.time()
    total_steps = a.steps                       # the stage's TARGET step count; a resumed stage only runs what is left
    if step0 >= total_steps:
        print(json.dumps({"note": "stage already reached its target steps", "step": step0}), flush=True)
    for gstep in range(step0 + 1, total_steps + 1):
        step = gstep - step0
        warm = min(1.0, gstep / max(1, a.warmup))
        cos = 0.5 * (1 + math.cos(math.pi * min(1.0, gstep / total_steps)))
        for g, b in zip(opt.param_groups, base):
            g["lr"] = b * warm * (a.min_lr_frac + (1 - a.min_lr_frac) * cos)
        x, y = next(loaders[step % len(loaders)])
        x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
        with torch.autocast(device_type="cuda", dtype=torch.bfloat16, enabled=amp):
            pred, aux = model.forward_seq(x, return_aux=True)
        loss, parts = Lo.total_loss(pred.float(), y, aux.float())
        opt.zero_grad(set_to_none=True)
        loss.backward()
        gn = torch.nn.utils.clip_grad_norm_(model.parameters(), a.clip)
        if torch.isfinite(gn):
            opt.step()
        else:
            print(json.dumps({"warn": "non-finite gradient, step skipped", "step": gstep}), flush=True)
        d = min(a.ema, (1 + gstep) / (10 + gstep))
        with torch.no_grad():
            for pe, pm in zip(ema.parameters(), model.parameters()):
                pe.mul_(d).add_(pm.detach(), alpha=1 - d)
            for be, bm in zip(ema.buffers(), model.buffers()):
                be.copy_(bm)
        if gstep % a.log_every == 0 or step == 1:
            rec = {"step": gstep, "loss": round(float(loss.detach()), 5), **{k: round(v, 5) for k, v in parts.items()}, "lr": opt.param_groups[1]["lr"], "sec": round(time.time() - t0, 1)}
            print(json.dumps(rec), flush=True); logf.write(json.dumps(rec) + "\n"); logf.flush()
        if val_clips and (gstep % a.val_every == 0 or gstep == total_steps):
            mean, per = validate(ema, val_clips, parse_shape(a.val_shape), a.val_frames, device)
            rec = {"step": gstep, "val": {k: round(v, 5) for k, v in mean.items()}}
            print(json.dumps(rec), flush=True); logf.write(json.dumps(rec) + "\n"); logf.flush()
            if mean["score"] < best:
                best = mean["score"]
                torch.save({"model": model.state_dict(), "ema": ema.state_dict(), "step": gstep, "best": best, "args": vars(a)}, os.path.join(a.out, "best.pt"))
                json.dump({"step": gstep, "mean": mean, "per_clip": per}, open(os.path.join(a.out, "best_val.json"), "w"), indent=1)
        if gstep % a.save_every == 0 or gstep == total_steps:
            torch.save({"model": model.state_dict(), "ema": ema.state_dict(), "opt": opt.state_dict(), "step": gstep, "best": best, "args": vars(a)}, os.path.join(a.out, "last.pt"))
    print(json.dumps({"done": True, "steps": total_steps, "resumed_from": step0, "best_val_score": None if best == float("inf") else best}))


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data"); p.add_argument("--val"); p.add_argument("--out", required=True)
    p.add_argument("--synthetic", action="store_true", help="tiny generated clips: a CPU smoke test of the code, NOT training")
    p.add_argument("--backbone", choices=["large", "small"], default="large")
    p.add_argument("--width", type=float, default=1.0, help="decoder width multiplier (0.5 for a phone tier)")
    p.add_argument("--pretrained", action="store_true", help="ImageNet-pretrained MobileNetV3 (downloads from the PyTorch hub; see README licence note)")
    p.add_argument("--steps", type=int, default=20000); p.add_argument("--bs", type=int, default=8); p.add_argument("--seq-len", type=int, default=6)
    p.add_argument("--shape", action="append", default=[], help="HxW (multiples of 32); repeat for mixed aspect ratios (round-robin)")
    p.add_argument("--lr", type=float, default=2e-4); p.add_argument("--enc-lr-mult", type=float, default=0.3); p.add_argument("--min-lr-frac", type=float, default=0.02)
    p.add_argument("--warmup", type=int, default=500); p.add_argument("--clip", type=float, default=1.0); p.add_argument("--ema", type=float, default=0.999)
    p.add_argument("--composite-p", type=float, default=0.4); p.add_argument("--low-light-p", type=float, default=0.25); p.add_argument("--bg-dir")
    p.add_argument("--val-shape", default="288x512"); p.add_argument("--val-frames", type=int, default=48); p.add_argument("--val-every", type=int, default=1000)
    p.add_argument("--save-every", type=int, default=500); p.add_argument("--log-every", type=int, default=50)
    p.add_argument("--resume"); p.add_argument("--init-only", action="store_true", help="load weights from --resume but restart the optimiser, LR schedule and step count (stage hand-over)")
    p.add_argument("--workers", type=int, default=4); p.add_argument("--seed", type=int, default=0); p.add_argument("--device"); p.add_argument("--no-amp", action="store_true")
    a = p.parse_args()
    if not a.shape:
        a.shape = ["256x256", "224x384"]
    main(a)
