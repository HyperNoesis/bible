"""Run: python test_scene_logic.py   (numpy + opencv + scipy only; no GPU, no model weights)"""
import sys
import numpy as np, cv2
import scene_integrate as S
import temporal as T
import matting_logic as L

bad = 0


def t(name, cond, extra=""):
    global bad
    bad += (not cond)
    print(("PASS " if cond else "FAIL ") + name, extra)


H, W = 180, 320
rng = np.random.default_rng(3)

# ---------- 1. foreground colour estimation removes the old-wall fringe ----------
F_true = np.zeros((H, W, 3), np.float32); F_true[...] = (0.8, 0.55, 0.45)           # skin-ish person colour
B_old = np.zeros((H, W, 3), np.float32); B_old[...] = (0.1, 0.9, 0.1)               # green old wall
alpha = np.zeros((H, W), np.float32); alpha[40:150, 100:220] = 1.0
alpha = cv2.GaussianBlur(alpha, (0, 0), 3.0)                                        # soft edge
img = np.clip(F_true * alpha[..., None] + B_old * (1 - alpha[..., None]), 0, 1)
img_u8 = (img * 255 + 0.5).astype(np.uint8)
band = (alpha > 0.15) & (alpha < 0.85)
raw_err = np.abs(img[band] - F_true[band]).mean()
est = S.estimate_foreground(img_u8, alpha)
est_err = np.abs(est[band] - F_true[band]).mean()
t("foreground estimation cuts the edge colour error by at least half", est_err < 0.5 * raw_err, f"raw={raw_err:.3f} est={est_err:.3f}")
core = alpha > 0.99
t("foreground estimation leaves the solid interior alone", np.abs(est[core] - img[core]).max() < 0.02)

# ---------- 2. light wrap is spatially varying (bright left, dark right) ----------
bg = np.zeros((H, W, 3), np.float32); bg[:, : W // 2] = (0.95, 0.85, 0.6); bg[:, W // 2:] = (0.05, 0.05, 0.1)
fg = np.full((H, W, 3), 0.4, np.float32)
a = np.zeros((H, W), np.float32); a[30:170, 110:210] = 1.0
a = cv2.GaussianBlur(a, (0, 0), 1.5)
out = S.light_wrap(fg, a, bg, 0.5)
# sample 1-4 px inside each edge (the frame is only 180 px tall, so the wrap band is thin)
left_edge = out[100, 111:115].mean(); right_edge = out[100, 205:209].mean(); centre = out[100, 160].mean()
t("light wrap: the edge facing the bright side is brighter than the edge facing the dark side", left_edge > right_edge + 0.03, f"L={left_edge:.3f} R={right_edge:.3f}")
t("light wrap: deep inside the person is untouched", abs(centre - 0.4) < 0.01, f"{centre:.3f}")
t("light wrap: strength 0 is a no-op", np.allclose(S.light_wrap(fg, a, bg, 0), fg))

# ---------- 3. light side + cast shadow direction ----------
bg_u8 = (bg * 255).astype(np.uint8)
side = S.light_side(bg_u8)
t("light side: bright left reads as +", side > 0.5, f"{side:.2f}")
t("light side: even light reads ~0", abs(S.light_side(np.full((H, W, 3), 120, np.uint8))) < 0.05)
sh = S.cast_shadow(a, side, 0.4)
left_sh = sh[100, 60:100].mean(); right_sh = sh[100, 220:260].mean()
t("shadow falls AWAY from the bright (left) side", right_sh > left_sh * 1.5, f"left={left_sh:.3f} right={right_sh:.3f}")
t("shadow strength 0 is empty", S.cast_shadow(a, side, 0).max() == 0)

# ---------- 4. noise estimate: flat person ~0, noisy person > 0, capped ----------
flat = np.full((H, W, 3), 120, np.uint8); solid = np.ones((H, W), np.float32)
t("noise estimate on a flat person is ~0", S.estimate_noise(flat, solid) < 0.5)
noisy = np.clip(120 + rng.normal(0, 4, (H, W, 3)), 0, 255).astype(np.uint8)
n_est = S.estimate_noise(noisy, solid)
t("noise estimate sees real sensor noise", 2.0 < n_est <= 6.0, f"{n_est:.2f}")

# ---------- 5. integrate(): shape/dtype, person kept, background reached ----------
rgb = np.full((H, W, 3), (200, 150, 120), np.uint8)
res = S.integrate(rgb, a, bg_u8, rng=np.random.default_rng(0))
t("integrate returns the same size uint8 RGB", res.shape == (H, W, 3) and res.dtype == np.uint8)
t("integrate: person interior stays person-coloured", abs(int(res[100, 160, 0]) - 200) < 25, str(res[100, 160]))
t("integrate: far background is the scene (left bright)", res[10, 10, 0] > 200, str(res[10, 10]))
res0 = S.integrate(rgb, a, bg_u8, 0, 0, 0, 0, fg_estimate=False)
plain = L.composite(rgb, a, bg_u8)
t("integrate with every cue off ~ plain composite", np.abs(res0.astype(int) - plain.astype(int)).mean() < 3.0, f"{np.abs(res0.astype(int)-plain.astype(int)).mean():.2f}")

# harmonise: moves chroma toward a blue scene but never by more than the cap
blue_bg = np.zeros((H, W, 3), np.uint8); blue_bg[...] = (40, 70, 160)
skin = np.full((H, W, 3), (0.8, 0.6, 0.5), np.float32)
hs = S.harmonise(skin, np.ones((H, W), np.float32), blue_bg, 0.5)
t("harmonise pulls the person toward the scene's colour", hs[..., 2].mean() > skin[..., 2].mean() and hs[..., 0].mean() < skin[..., 0].mean())
t("harmonise is capped (no blue person)", hs[..., 2].mean() - skin[..., 2].mean() < 0.12, f"{hs[...,2].mean()-skin[...,2].mean():.3f}")

# ---------- 6. temporal fusion: jitter goes down, motion does not lag ----------
N = 24
frames, truth, noisy_a = [], [], []
base = (rng.random((H, W, 3)) * 255).astype(np.uint8)
base = cv2.GaussianBlur(base, (0, 0), 4)                                            # textured, so flow can lock on
for i in range(N):
    x0 = 80 + 3 * i                                                                  # person drifts right 3 px / frame
    tr = np.zeros((H, W), np.float32); tr[40:150, x0:x0 + 90] = 1.0
    tr = cv2.GaussianBlur(tr, (0, 0), 1.2)
    fr = base.copy(); fr[40:150, x0:x0 + 90] = (np.array([180, 120, 100]) + rng.normal(0, 3, (110, 90, 3))).clip(0, 255).astype(np.uint8)
    na = np.clip(tr + rng.normal(0, 0.16, tr.shape) * ((tr > 0.02) & (tr < 0.98)) * 2.5 + (rng.random(tr.shape) < 0.01) * 0.0, 0, 1).astype(np.float32)
    # extra edge-band shimmer, the thing the model gets wrong frame to frame
    edge = ((tr > 0.02) & (tr < 0.98))
    na = np.where(edge, np.clip(tr + rng.uniform(-0.35, 0.35, tr.shape), 0, 1), tr).astype(np.float32)
    frames.append(fr); truth.append(tr); noisy_a.append(na)
fused = T.fuse_sequence(noisy_a, frames, bidirectional=True)
fl_raw = L.temporal_flicker(noisy_a); fl_fused = L.temporal_flicker(fused)
t("temporal fusion cuts flicker by at least 40%", fl_fused < 0.6 * fl_raw, f"raw={fl_raw:.3f} fused={fl_fused:.3f}")
def band_err(seq):   # error only where it can happen: the soft edge band
    e = []
    for a_, b_ in zip(seq, truth):
        m = cv2.dilate(((b_ > 0.02) & (b_ < 0.98)).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        e.append(np.abs(a_ - b_)[m].mean())
    return float(np.mean(e))
err_raw, err_fused = band_err(noisy_a), band_err(fused)
t("temporal fusion is closer to the truth, not just smoother", err_fused < 0.85 * err_raw, f"raw={err_raw:.4f} fused={err_fused:.4f}")
mid = N // 2
iou = lambda p, q: float(((p > 0.5) & (q > 0.5)).sum() / max(1, ((p > 0.5) | (q > 0.5)).sum()))
t("moving person: fused mask still overlaps the truth (no ghost lag)", iou(fused[mid], truth[mid]) > 0.95, f"{iou(fused[mid], truth[mid]):.3f}")
# a hand that appears suddenly must not be erased by the history
jump = [a_.copy() for a_ in noisy_a]; hand = np.zeros((H, W), np.float32); hand[60:100, 10:50] = 1.0
for i in range(10, N):
    jump[i] = np.maximum(jump[i], hand)
    frames[i] = frames[i].copy(); frames[i][60:100, 10:50] = (230, 200, 180)
fj = T.fuse_sequence(jump, frames, bidirectional=True)
t("a newly appearing hand is kept", fj[12][80, 30] > 0.8, f"{fj[12][80,30]:.2f}")
t("single-frame sequence is returned as is", np.allclose(T.fuse_sequence([noisy_a[0]], [frames[0]])[0], noisy_a[0]))

sys.exit(1 if bad else 0)
