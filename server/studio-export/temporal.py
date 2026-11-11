"""Temporal alpha fusion for per-frame matting models (numpy + OpenCV only; testable without torch).

Why: a strong image-matting model (BiRefNet, MIT) is run on every frame and its edge is excellent, but each frame is
decided independently, so hair and fingers shimmer. This module removes the shimmer WITHOUT blurring real motion:

  1. optical flow (OpenCV DIS) warps the previous smoothed alpha onto the current frame;
  2. the warped alpha is trusted only where the flow is self-consistent (forward/backward check) and where it still
     agrees with the new frame's own prediction (a big disagreement = real change, e.g. a hand moving in);
  3. run once forward and once backward and average, so there is no one-sided lag.
"""
import numpy as np


def _gray(rgb):
    import cv2
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)


def _flow(a_gray, b_gray, dis):
    """Dense flow that maps pixels of a -> b (H,W,2) float32."""
    return dis.calc(a_gray, b_gray, None)


def _warp(img, flow_cur_to_prev):
    """Sample `img` (previous frame space) at x + flow(x) so it lines up with the current frame."""
    import cv2
    h, w = img.shape[:2]
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(img.astype(np.float32), gx + flow_cur_to_prev[..., 0], gy + flow_cur_to_prev[..., 1],
                     cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def flow_confidence(f_back, f_fwd, sigma=1.5):
    """f_back: current->previous flow, f_fwd: previous->current flow. A pixel that goes to the previous frame and comes
    back should land where it started; the distance (px) is the error. Returns 0..1."""
    back_at = _warp(f_fwd[..., 0], f_back), _warp(f_fwd[..., 1], f_back)
    err = np.sqrt((f_back[..., 0] + back_at[0]) ** 2 + (f_back[..., 1] + back_at[1]) ** 2)
    return np.exp(-(err / sigma) ** 2).astype(np.float32)


def _smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def fuse_pair(prev_smooth, prev_gray, cur_alpha, cur_gray, dis, base=0.65, agree_lo=0.20, agree_hi=0.55):
    """One step: returns the new smoothed alpha for the current frame."""
    f_back = _flow(cur_gray, prev_gray, dis)
    f_fwd = _flow(prev_gray, cur_gray, dis)
    conf = flow_confidence(f_back, f_fwd)
    warped = _warp(prev_smooth, f_back)
    disagree = np.abs(warped - cur_alpha)
    w_prev = base * conf * (1.0 - _smoothstep(agree_lo, agree_hi, disagree))
    return (w_prev * warped + (1.0 - w_prev) * cur_alpha).astype(np.float32)


def _pass(alphas, grays, dis, order, **kw):
    out = [None] * len(alphas)
    prev = None
    for i in order:
        if prev is None:
            out[i] = alphas[i].astype(np.float32)
        else:
            j = prev
            out[i] = fuse_pair(out[j], grays[j], alphas[i], grays[i], dis, **kw)
        prev = i
    return out


def fuse_sequence(alphas, frames_rgb, bidirectional=True, progress=None, **kw):
    """alphas: list of float (H,W) 0..1 from the per-frame model; frames_rgb: list of uint8 RGB. Returns smoothed list."""
    import cv2
    n = len(alphas)
    if n < 2:
        return [a.astype(np.float32) for a in alphas]
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    grays = [_gray(f) for f in frames_rgb]
    fwd = _pass(alphas, grays, dis, range(n), **kw)
    if progress:
        progress(0.5)
    if not bidirectional:
        return fwd
    bwd = _pass(alphas, grays, dis, range(n - 1, -1, -1), **kw)
    if progress:
        progress(1.0)
    return [0.5 * (a + b) for a, b in zip(fwd, bwd)]
