"""Pure helpers for Studio Export (numpy/scipy/cv2 only; no torch) so they are unit-testable anywhere."""
import numpy as np


def sharpness(gray):
    """Variance of the Laplacian: higher = sharper frame."""
    import cv2
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def pick_start_frame(frames, probe=40, step=4):
    """Choose the frame (index) MatAnyone starts from: the sharpest of the first `probe` frames, ties -> earliest.
    A blurry first frame gives a bad first mask and the error then travels through the whole clip."""
    import cv2
    best, best_s = 0, -1.0
    for i in range(0, min(len(frames), probe), step):
        s = sharpness(cv2.cvtColor(frames[i], cv2.COLOR_RGB2GRAY))
        if s > best_s * 1.05:  # must be clearly sharper to move away from an earlier frame
            best, best_s = i, s
    return best


def clean_first_mask(prob, thr=0.5, keep_ratio=0.15, hole_frac=0.002):
    """prob: float 0..1 (H,W) from the segmenter -> uint8 0/255 mask.
    Keeps the main person (+ other pieces >= keep_ratio of the largest), fills small holes, drops specks."""
    from scipy import ndimage as ndi
    m = prob >= thr
    lab, n = ndi.label(m)
    if n == 0:
        return np.zeros(prob.shape, np.uint8)
    areas = ndi.sum(m, lab, index=np.arange(1, n + 1))
    keep = [i + 1 for i, a in enumerate(areas) if a >= keep_ratio * areas.max()]
    m = np.isin(lab, keep)
    bg_lab, bn = ndi.label(~m)
    for i in range(1, bn + 1):  # background pieces fully enclosed and small = holes in the person
        piece = bg_lab == i
        ys, xs = np.where(piece)
        touches = ys.min() == 0 or xs.min() == 0 or ys.max() == m.shape[0] - 1 or xs.max() == m.shape[1] - 1
        if not touches and piece.sum() <= hole_frac * m.size:
            m[piece] = True
    return (m * 255).astype(np.uint8)


def mask_is_plausible(mask, lo=0.02, hi=0.92):
    """A first-frame mask covering almost nothing or almost everything is a failure: do not run the matting on it."""
    f = float((mask > 127).mean())
    return lo <= f <= hi, f


def split_plan(n_frames, start):
    """Frames [start..end] go forward; frames [0..start] go backward (reversed). Returns two index lists (the start frame is in both)."""
    fwd = list(range(start, n_frames))
    back = list(range(start, -1, -1))
    return fwd, back


def merge_alpha(n_frames, start, fwd_alpha, back_alpha):
    """Rebuild the full alpha sequence (list of HxW float arrays) from the two passes."""
    out = [None] * n_frames
    for k, idx in enumerate(range(start, n_frames)):
        out[idx] = fwd_alpha[k]
    for k, idx in enumerate(range(start, -1, -1)):
        if idx != start:
            out[idx] = back_alpha[k]
    return out


def composite(rgb, alpha, bg):
    """Alpha-blend a person over a background (float math, edge colour pulled toward the person to avoid dark/bright halos).
    rgb,bg: uint8 HxWx3; alpha: float HxW 0..1."""
    a = alpha[..., None].astype(np.float32)
    f = rgb.astype(np.float32)
    # simple decontamination: in the soft edge band, push the colour toward the nearby solid-person colour
    from scipy import ndimage as ndi
    solid = (alpha > 0.97).astype(np.float32)
    w = ndi.uniform_filter(solid, 7)[..., None] + 1e-4
    core = np.stack([ndi.uniform_filter(f[..., c] * solid, 7) for c in range(3)], -1) / w
    edge = ((alpha > 0.02) & (alpha < 0.97))[..., None].astype(np.float32)
    k = 0.7 * edge * np.clip(w / 0.1, 0, 1)   # only where solid person pixels really are nearby; otherwise keep the camera colour
    f = f * (1 - k) + core * k
    out = f * a + bg.astype(np.float32) * (1 - a)
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def fit_background(bg, w, h):
    """Cover-fit a background image to w x h (centre crop)."""
    import cv2
    s = max(w / bg.shape[1], h / bg.shape[0])
    r = cv2.resize(bg, (int(round(bg.shape[1] * s)), int(round(bg.shape[0] * s))), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
    y0, x0 = (r.shape[0] - h) // 2, (r.shape[1] - w) // 2
    return r[y0:y0 + h, x0:x0 + w]


def temporal_flicker(alpha_seq):
    """Mean absolute frame-to-frame alpha change over the soft edge band (lower = steadier). For benchmark reports."""
    d = []
    for a, b in zip(alpha_seq[:-1], alpha_seq[1:]):
        band = ((a > 0.02) & (a < 0.98)) | ((b > 0.02) & (b < 0.98))
        if band.any():
            d.append(float(np.abs(a - b)[band].mean()))
    return float(np.mean(d)) if d else 0.0
