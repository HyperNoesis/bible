"""Clip data for the student. A clip is a folder: frames 00000.jpg ... and alpha 00000.png ... (+ optional meta.json {"tags": [...]}).
Labels come from the TEACHER (make_teacher_data.py) or, for the independent gate set, from hand-checked masks.

Augmentations are temporally consistent (same crop / flip / colour for every frame of a sequence), because the student learns motion from them.
"""
import glob
import json
import os
import random

import cv2
import numpy as np
import torch
from torch.utils.data import Dataset


# ------------------------------------------------------------------ synthetic clips (smoke tests only, NOT for real training)
def make_synthetic_clip(path, n=16, h=192, w=256, seed=0):
    """A textured background and a moving 'person' (body ellipse + head + a thin hand) with a soft alpha. Proves the code runs; teaches nothing real."""
    rng = np.random.default_rng(seed)
    os.makedirs(path, exist_ok=True)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    bg = np.stack([(np.sin(xx / rng.uniform(8, 30) + rng.uniform(0, 6)) + 1) * 90 + rng.uniform(0, 60) for _ in range(3)], -1)
    bg += rng.normal(0, 4, bg.shape)
    tex = np.stack([(np.sin((xx + 2 * yy) / 5.0 + c) + 1) * 60 + 80 for c in range(3)], -1)
    cx0, cy0 = rng.uniform(0.3, 0.7) * w, rng.uniform(0.5, 0.6) * h
    vx, vy = rng.uniform(-3, 3), rng.uniform(-1, 1)
    for i in range(n):
        cx, cy = cx0 + vx * i, cy0 + vy * i
        a = np.zeros((h, w), np.float32)
        cv2.ellipse(a, (int(cx), int(cy + 0.25 * h)), (int(0.18 * w), int(0.3 * h)), 0, 0, 360, 1.0, -1)
        cv2.circle(a, (int(cx), int(cy - 0.12 * h)), int(0.09 * h), 1.0, -1)
        hx, hy = cx + 0.25 * w + 4 * np.sin(i / 2.0), cy + 6 * np.cos(i / 2.0)
        cv2.line(a, (int(cx + 0.12 * w), int(cy + 0.15 * h)), (int(hx), int(hy)), 1.0, 2)
        a = cv2.GaussianBlur(a, (0, 0), 1.2)
        fr = bg * (1 - a[..., None]) + tex * a[..., None] + rng.normal(0, 3, (h, w, 3))
        cv2.imwrite(os.path.join(path, f"{i:05d}.jpg"), np.clip(fr, 0, 255).astype(np.uint8)[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, 95])
        cv2.imwrite(os.path.join(path, f"{i:05d}.png"), (a * 255 + 0.5).astype(np.uint8))
    json.dump({"tags": ["synthetic"]}, open(os.path.join(path, "meta.json"), "w"))


def make_synthetic_root(root, clips=4, n=16, h=192, w=256, seed=0):
    for k in range(clips):
        make_synthetic_clip(os.path.join(root, f"clip{k:03d}"), n, h, w, seed + k)
    return root


# ------------------------------------------------------------------ clip listing
def list_clips(root, min_frames=2):
    out = []
    for d in sorted(glob.glob(os.path.join(root, "*"))):
        if not os.path.isdir(d):
            continue
        fr = sorted(glob.glob(os.path.join(d, "*.jpg")))
        if len(fr) >= min_frames and all(os.path.exists(f[:-4] + ".png") for f in fr):
            tags = []
            mp = os.path.join(d, "meta.json")
            if os.path.exists(mp):
                try:
                    tags = json.load(open(mp)).get("tags", [])
                except Exception:
                    pass
            out.append({"dir": d, "frames": fr, "tags": tags})
    return out


def load_clip(clip, shape, max_frames=None):
    """Whole clip resized (not cropped) to shape=(h,w): for validation and the gate. Returns (frames uint8 [T,h,w,3] RGB, alpha float [T,h,w])."""
    fr = clip["frames"][:max_frames] if max_frames else clip["frames"]
    h, w = shape
    X = np.stack([cv2.resize(cv2.imread(f)[..., ::-1], (w, h), interpolation=cv2.INTER_AREA) for f in fr])
    A = np.stack([cv2.resize(cv2.imread(f[:-4] + ".png", 0), (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0 for f in fr])
    return X, A


# ------------------------------------------------------------------ backgrounds for the composite augmentation
def random_background(h, w, rng, bg_files=None):
    if bg_files and rng.random() < 0.7:
        im = cv2.imread(bg_files[rng.integers(len(bg_files))])
        if im is not None:
            s = max(h / im.shape[0], w / im.shape[1]) * rng.uniform(1.0, 1.6)
            im = cv2.resize(im, (max(w, int(im.shape[1] * s)), max(h, int(im.shape[0] * s))))
            y0, x0 = rng.integers(0, im.shape[0] - h + 1), rng.integers(0, im.shape[1] - w + 1)
            return im[y0:y0 + h, x0:x0 + w, ::-1].astype(np.float32)
    c0, c1 = rng.uniform(0, 255, 3), rng.uniform(0, 255, 3)
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None] if rng.random() < 0.5 else np.linspace(0, 1, w, dtype=np.float32)[None, :, None]
    bg = c0 * (1 - t) + c1 * t
    bg = np.broadcast_to(bg, (h, w, 3)).copy()
    for _ in range(rng.integers(0, 6)):                       # random blobs: busy backgrounds
        cv2.circle(bg, (int(rng.integers(w)), int(rng.integers(h))), int(rng.integers(8, max(9, min(h, w) // 3))), tuple(float(v) for v in rng.uniform(0, 255, 3)), -1)
    return cv2.GaussianBlur(bg, (0, 0), rng.uniform(0.5, 6))


class ClipDataset(Dataset):
    """Random sequences of `seq_len` frames, cropped to `shape` = (h, w) with temporally consistent augmentation.

    composite_p: chance of swapping the background (frame * alpha + new_bg * (1 - alpha)). The frame's edge pixels still carry a little of the OLD
    background, so this is an approximation: keep it moderate (0.3 to 0.5). It teaches the student not to depend on the room.
    low_light_p / noise: simulate a weak phone camera in a dark room (the main real-world failure for matting)."""

    def __init__(self, root, shape=(288, 512), seq_len=8, length=10000, composite_p=0.4, low_light_p=0.25, bg_dir=None, augment=True, seed=0):
        self.clips = list_clips(root, min_frames=max(2, seq_len))
        if not self.clips:
            raise SystemExit(f"no usable clips (frames .jpg + alpha .png with >= {seq_len} frames) under {root}")
        self.shape, self.T, self.length, self.augment = shape, seq_len, length, augment
        self.cp, self.llp = composite_p, low_light_p
        self.bg_files = sorted(glob.glob(os.path.join(bg_dir, "*.*"))) if bg_dir else []
        self.seed = seed

    def __len__(self):
        return self.length

    def __getitem__(self, i):
        rng = np.random.default_rng((self.seed * 1000003 + i + random.randrange(1 << 30)) & 0xFFFFFFFF)
        clip = self.clips[rng.integers(len(self.clips))]
        n = len(clip["frames"])
        start = int(rng.integers(0, n - self.T + 1))
        step = 1 if rng.random() < 0.7 else int(rng.integers(2, 4)) if start + 3 * (self.T - 1) < n else 1   # sometimes skip frames (low-fps cameras)
        idx = [min(n - 1, start + k * step) for k in range(self.T)]
        X = [cv2.imread(clip["frames"][j])[..., ::-1] for j in idx]
        A = [cv2.imread(clip["frames"][j][:-4] + ".png", 0).astype(np.float32) / 255.0 for j in idx]
        H, W = X[0].shape[:2]
        th, tw = self.shape
        # crop with the target aspect, random zoom, mostly keeping the person (bias toward where alpha is)
        zoom = rng.uniform(0.55, 1.0) if self.augment else 1.0
        ch = int(min(H, W * th / tw) * zoom)
        cw = int(ch * tw / th)
        ys, xs = np.where(A[len(A) // 2] > 0.5)
        if len(ys) and self.augment and rng.random() < 0.8:
            cy, cx = int(ys.mean() + rng.normal(0, 0.1 * ch)), int(xs.mean() + rng.normal(0, 0.1 * cw))
        else:
            cy, cx = int(rng.integers(ch // 2, max(ch // 2 + 1, H - ch // 2))), int(rng.integers(cw // 2, max(cw // 2 + 1, W - cw // 2)))
        y0, x0 = int(np.clip(cy - ch // 2, 0, H - ch)), int(np.clip(cx - cw // 2, 0, W - cw))
        flip = self.augment and rng.random() < 0.5
        X = [cv2.resize(x[y0:y0 + ch, x0:x0 + cw], (tw, th), interpolation=cv2.INTER_AREA).astype(np.float32) for x in X]
        A = [cv2.resize(a[y0:y0 + ch, x0:x0 + cw], (tw, th), interpolation=cv2.INTER_AREA) for a in A]
        if flip:
            X, A = [x[:, ::-1] for x in X], [a[:, ::-1] for a in A]
        if self.augment:
            if rng.random() < self.cp:
                bg = random_background(th, tw, rng, self.bg_files)
                X = [x * a[..., None] + bg * (1 - a[..., None]) for x, a in zip(X, A)]
            gain, gamma = rng.uniform(0.8, 1.2), rng.uniform(0.8, 1.25)
            sat = rng.uniform(0.7, 1.3)
            noise = 0.0
            if rng.random() < self.llp:                          # dark room + weak sensor: darker, noisier, softer
                gain *= rng.uniform(0.2, 0.6)
                noise = rng.uniform(4, 18)
            blur = rng.uniform(0.3, 1.6) if rng.random() < 0.3 else 0.0
            out = []
            for x in X:
                x = np.clip(x / 255.0, 0, 1) ** gamma * gain
                g = x.mean(-1, keepdims=True)
                x = np.clip(g + (x - g) * sat, 0, 1) * 255.0
                if blur:
                    x = cv2.GaussianBlur(x, (0, 0), blur)
                if noise:
                    x = x + rng.normal(0, noise, x.shape) * (0.4 + 0.6 * (x / 255.0))
                out.append(np.clip(x, 0, 255))
            X = out
        X = torch.from_numpy(np.stack(X).astype(np.float32) / 255.0).permute(0, 3, 1, 2).contiguous()
        A = torch.from_numpy(np.stack(A).astype(np.float32)).unsqueeze(1).contiguous()
        return X, A
