"""Matting metrics (numpy only). alpha arrays are float 0..1, shape (H, W); sequences are lists of them.
mad / mse / grad are against a reference alpha; flicker needs NO reference (it is intrinsic), so it is fair to every engine."""
import numpy as np


def mad(p, g):
    return float(np.abs(p - g).mean())


def mse(p, g):
    return float(((p - g) ** 2).mean())


def _sobel_mag(a):
    import cv2
    gx = cv2.Sobel(a, cv2.CV_32F, 1, 0, ksize=3) / 8.0
    gy = cv2.Sobel(a, cv2.CV_32F, 0, 1, ksize=3) / 8.0
    return gx, gy


def grad_err(p, g):
    px, py = _sobel_mag(p.astype(np.float32))
    gx, gy = _sobel_mag(g.astype(np.float32))
    return float(np.abs(px - gx).mean() + np.abs(py - gy).mean())


def edge_band_mad(p, g, lo=0.02, hi=0.98, dil=7):
    """MAD only where the reference is soft or near an edge: the number that tells hair/fingers apart from 'body is white'."""
    import cv2
    band = ((g > lo) & (g < hi)).astype(np.uint8)
    band = cv2.dilate(band, np.ones((dil, dil), np.uint8)).astype(bool)
    return float(np.abs(p - g)[band].mean()) if band.any() else 0.0


def flicker(seq, lo=0.02, hi=0.98):
    """Mean |alpha change| between frames over the soft band (lower = steadier). Reference-free."""
    d = []
    for a, b in zip(seq[:-1], seq[1:]):
        band = ((a > lo) & (a < hi)) | ((b > lo) & (b < hi))
        if band.any():
            d.append(float(np.abs(a - b)[band].mean()))
    return float(np.mean(d)) if d else 0.0


def temporal_err(seq, ref):
    """|d(pred) - d(ref)| between frames, over the band: does the pred move when (and only when) the reference moves."""
    d = []
    for (a, b), (ra, rb) in zip(zip(seq[:-1], seq[1:]), zip(ref[:-1], ref[1:])):
        band = ((ra > 0.02) & (ra < 0.98)) | ((rb > 0.02) & (rb < 0.98))
        if band.any():
            d.append(float(np.abs((b - a) - (rb - ra))[band].mean()))
    return float(np.mean(d)) if d else 0.0


def evaluate(pred_seq, ref_seq):
    """Dict of all metrics for one clip."""
    n = len(pred_seq)
    return {
        "mad": float(np.mean([mad(p, g) for p, g in zip(pred_seq, ref_seq)])),
        "mse": float(np.mean([mse(p, g) for p, g in zip(pred_seq, ref_seq)])),
        "grad": float(np.mean([grad_err(p, g) for p, g in zip(pred_seq, ref_seq)])),
        "edge_mad": float(np.mean([edge_band_mad(p, g) for p, g in zip(pred_seq, ref_seq)])),
        "flicker": flicker(pred_seq),
        "temporal_err": temporal_err(pred_seq, ref_seq),
        "frames": n,
    }


def composite_score(m):
    """One number for checkpoint picking / the promotion gate (lower is better). Edge detail and steadiness count most."""
    return 100.0 * m["mad"] + 200.0 * m["edge_mad"] + 100.0 * m["grad"] + 300.0 * m["flicker"] + 100.0 * m["temporal_err"]
