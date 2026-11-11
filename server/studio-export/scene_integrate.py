"""Make the presenter look like they are IN the scene, not pasted on it (numpy + OpenCV only, no models).

The six cues a viewer's eye uses to spot a cut-out, and what is done about each:
  1. coloured fringe from the real room      -> estimate_foreground(): blur-fusion foreground colour estimation, so the
                                                 edge pixels carry the person's colour, not the old wall
  2. person lit by a different light         -> harmonise(): partial LAB colour/contrast transfer toward the scene (capped)
  3. no light from the scene on the edges    -> light_wrap(): the scene's own blurred colours bleed over the silhouette,
                                                 differently on each side (a window on the left warms the left edge only)
  4. no shadow on the wall                   -> cast_shadow(): soft shadow falling away from the scene's brighter side
  5. person noisier than the picture behind  -> match_noise(): scene gets the same sensor grain as the camera footage
  6. all of this flickers                    -> temporal.py (alpha) + the cues above are computed from smooth inputs

Everything is strength-controlled (0 = off) so the look can be dialled per scene.  Honest limit: this is 2-D image
processing. It sells a fixed camera and a soft room; it does not relight a face from a new direction.
"""
import numpy as np


def _odd(n):
    n = int(max(3, n))
    return n if n % 2 else n + 1


def estimate_foreground(rgb_u8, alpha, r_big=None, r_small=None):
    """Blur-fusion foreground estimation (Forte & Pitie 2021, 'Approximate Fast Foreground Colour Estimation'), two passes.
    Returns float RGB 0..1 where edge pixels are the person's colour with the old background removed."""
    import cv2
    h, w = alpha.shape
    img = rgb_u8.astype(np.float32) / 255.0
    a = np.clip(alpha, 0, 1).astype(np.float32)
    a3 = a[..., None]
    rb = _odd(r_big or min(h, w) * 0.10)              # measured: 0.06 left 58% of the edge error, 0.10 leaves ~35% (synthetic soft edge)
    rs = _odd(r_small or max(3, rb // 8))

    def fb(F, B, r):
        ba = cv2.blur(a, (r, r))[..., None]
        bF = cv2.blur(F * a3, (r, r)) / (ba + 1e-5)
        bB = cv2.blur(B * (1 - a3), (r, r)) / ((1 - ba) + 1e-5)
        Fn = bF + a3 * (img - a3 * bF - (1 - a3) * bB)
        return np.clip(Fn, 0, 1), bB

    F, bB = fb(img, img, rb)
    F, _ = fb(F, bB, rs)
    return F


def light_side(bg_u8):
    """-1..+1: positive = the LEFT of the scene is brighter (light comes from the left). ~0 = even light."""
    import cv2
    g = cv2.cvtColor(bg_u8, cv2.COLOR_RGB2GRAY).astype(np.float32)
    cols = g.mean(0)
    w = len(cols)
    L, R = cols[: w // 3].mean(), cols[-(w // 3):].mean()
    return float(np.clip((L - R) / (L + R + 1e-3) * 4.0, -1, 1))


def harmonise(fg, alpha, bg_u8, strength=0.30, max_shift=14.0):
    """Move the person's average chroma (and a little of the contrast) toward the scene's. fg: float RGB 0..1."""
    import cv2
    m = alpha > 0.9
    if strength <= 0 or m.sum() < 100:
        return fg
    f_lab = cv2.cvtColor((fg * 255 + 0.5).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    b_lab = cv2.cvtColor(bg_u8, cv2.COLOR_RGB2LAB).astype(np.float32).reshape(-1, 3)
    fm, fs = f_lab[m].mean(0), f_lab[m].std(0) + 1e-3
    bm, bs = b_lab.mean(0), b_lab.std(0) + 1e-3
    # Copy the room's COLOUR CAST (its distance from neutral), not its average chroma: pulling skin toward a grey-ish
    # room average washed faces out in testing. A neutral room therefore leaves the person's colour alone.
    shift = np.zeros(3, np.float32)
    shift[1:] = np.clip((bm[1:] - 128.0) * strength * 0.5, -max_shift, max_shift)
    shift[0] = float(np.clip((bm[0] - fm[0]) * strength * 0.15, -6.0, 6.0))      # exposure mostly stays the camera's
    out = f_lab + shift
    gain = 1.0 + float(np.clip((bs[0] / fs[0] - 1.0) * strength * 0.3, -0.12, 0.12))
    c = fm[0] + shift[0]
    out[..., 0] = (out[..., 0] - c) * gain + c
    out = np.clip(out, 0, 255).astype(np.uint8)
    return cv2.cvtColor(out, cv2.COLOR_LAB2RGB).astype(np.float32) / 255.0


def light_wrap(fg, alpha, bg_f, strength=0.35):
    """Screen the scene's own (blurred) colours onto a thin band just inside the silhouette. fg, bg_f: float RGB 0..1."""
    import cv2
    if strength <= 0:
        return fg
    h = alpha.shape[0]
    soft_bg = cv2.GaussianBlur(bg_f, (0, 0), max(2.0, 0.02 * h))
    near_bg = cv2.GaussianBlur((1 - alpha).astype(np.float32), (0, 0), max(1.5, 0.012 * h))
    band = np.clip(near_bg * 1.6, 0, 1) * alpha        # 0 deep inside the person, strongest at the edge
    s = (strength * band)[..., None] * soft_bg
    return 1.0 - (1.0 - fg) * (1.0 - s)


def cast_shadow(alpha, side, strength=0.30):
    """Soft shadow map 0..1 on the scene, pushed away from the bright side. Even light -> a small, centred contact shadow."""
    import cv2
    if strength <= 0:
        return np.zeros_like(alpha, np.float32)
    h, w = alpha.shape
    dx = side * 0.05 * w
    dy = 0.012 * h
    M = np.float32([[1, 0, dx], [0, 1, dy]])
    s = cv2.warpAffine(alpha.astype(np.float32), M, (w, h), borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    s = cv2.GaussianBlur(s, (0, 0), 0.028 * h)
    return np.clip(s * strength, 0, 0.9)


def estimate_noise(rgb_u8, alpha, cap=6.0):
    """Camera noise level (8-bit grey levels) from the person's own flat-ish pixels. Capped: texture reads as noise."""
    import cv2
    g = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2GRAY).astype(np.float32)
    hp = g - cv2.GaussianBlur(g, (0, 0), 1.2)
    m = cv2.erode((alpha > 0.98).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    if m.sum() < 200:
        return 0.0
    v = hp[m]
    return float(min(cap, 1.4826 * np.median(np.abs(v - np.median(v)))))


def integrate(rgb_u8, alpha, bg_u8, harmonise_k=0.30, wrap_k=0.35, shadow_k=0.30, noise_k=0.8,
              fg_estimate=True, side=None, rng=None):
    """Return the finished frame (uint8 RGB). rgb/alpha/bg must be the same H x W."""
    a = np.clip(alpha, 0, 1).astype(np.float32)
    bg_f = bg_u8.astype(np.float32) / 255.0
    fg = estimate_foreground(rgb_u8, a) if fg_estimate else rgb_u8.astype(np.float32) / 255.0
    fg = harmonise(fg, a, bg_u8, harmonise_k)
    fg = light_wrap(fg, a, bg_f, wrap_k)
    if side is None:
        side = light_side(bg_u8)
    bg_s = bg_f * (1.0 - cast_shadow(a, side, shadow_k)[..., None])
    if noise_k > 0:
        sig = estimate_noise(rgb_u8, a) * noise_k / 255.0
        if sig > 0:
            rng = rng or np.random.default_rng()
            bg_s = bg_s + rng.normal(0.0, sig, bg_s.shape[:2]).astype(np.float32)[..., None]
    out = fg * a[..., None] + bg_s * (1.0 - a[..., None])
    return (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)
