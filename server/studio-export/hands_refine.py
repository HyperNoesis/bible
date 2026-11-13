"""Hand refinement for the clean export engine (v0.84).

Why: a full-frame BiRefNet pass squeezes a 1080 x 1920 frame into 1024 x 1024, so a hand ends up about 80 px wide and the fingers
are soft, merged or missing. Here MediaPipe Hands (Apache-2.0) finds the hands, each hand is cut out with context, BiRefNet runs on
that crop (the hand then fills the whole 1024 px input, roughly 5x more pixels on the fingers), and the crop alpha is merged back.

The merge is guarded so a bad crop cannot make the picture worse:
  * the crop alpha is only trusted near pixels the full-frame pass already calls "person" (blocks background blobs),
  * the crop is feathered in, so there is no visible box edge,
  * hand boxes are tracked and smoothed over time (and held for a few frames when the detector drops the hand),
  * a crop with no person in it is skipped, and any error in a frame falls back to the full-frame alpha.

Everything except HandDetector is numpy/OpenCV only, so it is unit-tested without mediapipe, torch or a GPU.
"""
import numpy as np


# ---------------------------------------------------------------- boxes
def clamp_box(x0, y0, x1, y1, w, h):
    """Move (not shrink) a box so it lies inside the w x h frame. Returns ints (x0, y0, x1, y1)."""
    bw, bh = min(x1 - x0, w), min(y1 - y0, h)
    bw, bh = max(bw, 8), max(bh, 8)
    x0 = min(max(x0, 0), max(w - bw, 0))
    y0 = min(max(y0, 0), max(h - bh, 0))
    return int(round(x0)), int(round(y0)), int(round(x0 + bw)), int(round(y0 + bh))


def squarify(box, w, h):
    """Grow the short side of a box to make it square (BiRefNet resizes to a square, so a square crop is not stretched)."""
    x0, y0, x1, y1 = box
    side = max(x1 - x0, y1 - y0)
    side = min(side, w, h)
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    return clamp_box(cx - side / 2.0, cy - side / 2.0, cx + side / 2.0, cy + side / 2.0, w, h)


def boxes_from_landmarks(hands, w, h, pad=1.8, min_side=160, max_frac=0.6):
    """hands: list of (N, 2) arrays of NORMALISED x, y landmarks. Returns padded, square, in-frame int boxes.
    pad widens the landmark box so the wrist and the finger tips have context; max_frac keeps a crop from becoming the whole frame."""
    out = []
    for lm in hands:
        lm = np.asarray(lm, np.float32)
        if lm.ndim != 2 or lm.shape[0] == 0:
            continue
        xs, ys = lm[:, 0] * w, lm[:, 1] * h
        cx, cy = (xs.min() + xs.max()) / 2.0, (ys.min() + ys.max()) / 2.0
        side = max(xs.max() - xs.min(), ys.max() - ys.min()) * pad
        side = min(max(side, min_side), max_frac * min(h, w))
        out.append(clamp_box(cx - side / 2.0, cy - side / 2.0, cx + side / 2.0, cy + side / 2.0, w, h))
    return out


def _area(b):
    return max(0, b[2] - b[0]) * max(0, b[3] - b[1])


def _inter(a, b):
    return max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))


def merge_overlapping(boxes, overlap=0.5):
    """Two hands close together (clasped, praying) would be cropped twice: merge boxes that overlap by `overlap` of the smaller one."""
    boxes = [tuple(b) for b in boxes]
    changed = True
    while changed and len(boxes) > 1:
        changed = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, b = boxes[i], boxes[j]
                small = max(1, min(_area(a), _area(b)))
                if _inter(a, b) / small >= overlap:
                    boxes[i] = (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))
                    del boxes[j]
                    changed = True
                    break
            if changed:
                break
    return boxes


class BoxTracker:
    """Smooths hand boxes over time and keeps a hand's box for `hold` frames after the detector loses it (no popping on and off)."""

    def __init__(self, alpha=0.6, hold=6, max_dist=0.9):
        self.alpha, self.hold, self.max_dist = alpha, hold, max_dist
        self.tracks = []          # each: {"box": np.array(4), "miss": int}

    def update(self, boxes):
        boxes = [np.asarray(b, np.float32) for b in boxes]
        used = set()
        for t in self.tracks:
            tc = np.array([(t["box"][0] + t["box"][2]) / 2, (t["box"][1] + t["box"][3]) / 2])
            tside = max(t["box"][2] - t["box"][0], 1.0)
            best, best_d = None, None
            for k, b in enumerate(boxes):
                if k in used:
                    continue
                bc = np.array([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2])
                d = float(np.linalg.norm(tc - bc)) / tside
                if d <= self.max_dist and (best_d is None or d < best_d):
                    best, best_d = k, d
            if best is None:
                t["miss"] += 1
            else:
                used.add(best)
                t["box"] = self.alpha * boxes[best] + (1 - self.alpha) * t["box"]
                t["miss"] = 0
        for k, b in enumerate(boxes):
            if k not in used:
                self.tracks.append({"box": b.copy(), "miss": 0})
        self.tracks = [t for t in self.tracks if t["miss"] <= self.hold]
        return [tuple(int(round(v)) for v in t["box"]) for t in self.tracks]


# ---------------------------------------------------------------- merging a crop back
def _ramp(n, f_lo, f_hi):
    i = np.arange(n, dtype=np.float32)
    lo = np.ones(n, np.float32) if f_lo <= 0 else np.clip(i / f_lo, 0, 1)
    hi = np.ones(n, np.float32) if f_hi <= 0 else np.clip((n - 1 - i) / f_hi, 0, 1)
    return np.minimum(lo, hi)


def blend_crop(full, crop_alpha, box, mode="union", gate=0.25, feather=0.2, inplace=False):
    """Merge a hand-crop alpha into the full-frame alpha.
    full: float32 (H, W) 0..1.  crop_alpha: float32 (bh, bw) 0..1 for exactly `box` (x0, y0, x1, y1).
    mode "union":   alpha only ever goes UP in the box (adds missing fingers); safest.
    mode "replace": inside the box the crop alpha wins (also opens the gaps between fingers); sharper, trusts the crop more.
    gate: fraction of the box side; the crop is ignored farther than that from any pixel the full pass called person (> 0.3).
    feather: fraction of the box side used to fade the crop in. Box sides that lie on the frame border are not faded."""
    import cv2
    H, W = full.shape[:2]
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    out = full if inplace else full.copy()
    if bw < 4 or bh < 4 or crop_alpha.shape[:2] != (bh, bw):
        return out
    crop = np.clip(crop_alpha.astype(np.float32), 0, 1)
    g = int(round(gate * max(bw, bh)))
    if g > 0:
        ys0, ys1, xs0, xs1 = max(0, y0 - g), min(H, y1 + g), max(0, x0 - g), min(W, x1 + g)
        person = (full[ys0:ys1, xs0:xs1] > 0.3).astype(np.uint8)
        near = cv2.dilate(person, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * g + 1, 2 * g + 1)))
        near = near[y0 - ys0:y0 - ys0 + bh, x0 - xs0:x0 - xs0 + bw].astype(np.float32)
        near = cv2.GaussianBlur(near, (0, 0), max(1.0, g / 4.0))
        crop = crop * near
    fy, fx = int(round(feather * bh)), int(round(feather * bw))
    wy = _ramp(bh, fy if y0 > 0 else 0, fy if y1 < H else 0)
    wx = _ramp(bw, fx if x0 > 0 else 0, fx if x1 < W else 0)
    win = wy[:, None] * wx[None, :]
    region = out[y0:y1, x0:x1]
    target = np.maximum(region, crop) if mode == "union" else crop
    out[y0:y1, x0:x1] = region + (target - region) * win
    return out


# ---------------------------------------------------------------- detection + the per-frame refiner
class HandDetector:
    """MediaPipe Hands (Apache-2.0) wrapper: frame RGB uint8 -> list of (21, 2) normalised landmark arrays.
    Needs `pip install mediapipe`. NOT run in the sandbox that wrote it (see CHANGELOG-v0_84)."""

    def __init__(self, max_hands=4, complexity=1, min_conf=0.4):
        import mediapipe as mp
        self._h = mp.solutions.hands.Hands(static_image_mode=False, max_num_hands=max_hands, model_complexity=complexity,
                                           min_detection_confidence=min_conf, min_tracking_confidence=0.4)

    def landmarks(self, rgb):
        res = self._h.process(rgb)
        if not res.multi_hand_landmarks:
            return []
        return [np.array([[p.x, p.y] for p in hl.landmark], np.float32) for hl in res.multi_hand_landmarks]

    def close(self):
        self._h.close()


class HandRefiner:
    """Callable (frame_rgb, alpha, idx) -> refined alpha. `alpha_fn` is BiRefNetRunner.alpha (any RGB crop in, same-size alpha out)."""

    def __init__(self, alpha_fn, detector, mode="union", pad=1.8, gate=0.25, feather=0.2, max_boxes=2, min_person=0.2, tracker=None):
        self.alpha_fn, self.detector = alpha_fn, detector
        self.mode, self.pad, self.gate, self.feather = mode, pad, gate, feather
        self.max_boxes, self.min_person = max_boxes, min_person
        self.tracker = tracker or BoxTracker()
        self.stats = {"frames_with_hands": 0, "crops": 0, "skipped_no_person": 0, "errors": 0}
        self.last_error = None

    def __call__(self, frame, alpha, idx=0):
        try:
            return self._run(frame, alpha)
        except Exception as e:                       # a bad frame must never kill a long export: keep the full-frame alpha
            self.stats["errors"] += 1
            self.last_error = repr(e)
            return alpha

    def _run(self, frame, alpha):
        h, w = alpha.shape[:2]
        det = merge_overlapping(boxes_from_landmarks(self.detector.landmarks(frame), w, h, self.pad))
        boxes = self.tracker.update(det)
        if not boxes:
            return alpha
        self.stats["frames_with_hands"] += 1
        boxes = sorted(boxes, key=_area, reverse=True)[: self.max_boxes]
        out = alpha.astype(np.float32).copy()
        for b in boxes:
            b = squarify(b, w, h)
            x0, y0, x1, y1 = b
            if out[y0:y1, x0:x1].max() < self.min_person:
                self.stats["skipped_no_person"] += 1
                continue
            crop_alpha = self.alpha_fn(frame[y0:y1, x0:x1])
            blend_crop(out, crop_alpha, b, self.mode, self.gate, self.feather, inplace=True)
            self.stats["crops"] += 1
        return out

    def close(self):
        if hasattr(self.detector, "close"):
            self.detector.close()


def make_refiner(runner, a, say=print):
    """Build a HandRefiner from CLI args, or None. --hands auto quietly turns itself off when mediapipe is not installed."""
    if a.hands == "off":
        return None
    try:
        det = HandDetector(max_hands=4)
    except Exception as e:
        if a.hands == "on":
            raise SystemExit(f"--hands on needs mediapipe (pip install mediapipe): {e}")
        say(note="hand refinement off: mediapipe not installed (pip install mediapipe to enable it)")
        return None
    say(note="hand refinement on", mode=a.hands_mode)
    return HandRefiner(runner.alpha, det, mode=a.hands_mode, pad=a.hands_pad, max_boxes=a.hands_max)
