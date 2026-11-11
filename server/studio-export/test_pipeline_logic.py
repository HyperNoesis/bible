"""Run: python test_pipeline_logic.py   (needs numpy, scipy, opencv only; no GPU, no models)"""
import numpy as np, matting_logic as L, sys
bad = 0
def t(n, c, x=""):
    global bad
    bad += (not c); print(("PASS " if c else "FAIL ") + n, x)
rng = np.random.default_rng(1)
# start frame: a blurry first frame must be skipped for a sharp one
import cv2
sharp = (rng.random((120, 160, 3)) * 255).astype(np.uint8); blur = cv2.GaussianBlur(sharp, (0, 0), 6)
frames = [blur, blur, blur, blur, sharp, sharp, sharp, sharp]
t("picks a sharp start frame over blurry first frames", L.pick_start_frame(frames, probe=8, step=1) == 4)
t("all equal -> earliest", L.pick_start_frame([sharp] * 6, probe=6, step=1) == 0)
# first mask cleanup
p = np.zeros((100, 100), np.float32); p[20:90, 30:70] = 0.9; p[40:44, 45:49] = 0.1; p[2:4, 2:4] = 0.9   # person + small hole + speck
m = L.clean_first_mask(p)
t("keeps the person", m[50, 40] == 255); t("fills the small hole", m[42, 47] == 255); t("drops the speck", m[3, 3] == 0)
p2 = p.copy(); p2[20:90, 5:20] = 0.9    # a second large piece (another person) is kept
t("keeps a second person", L.clean_first_mask(p2)[50, 10] == 255)
t("empty -> empty mask", L.clean_first_mask(np.zeros((10, 10), np.float32)).sum() == 0)
ok, f = L.mask_is_plausible(np.zeros((10, 10), np.uint8)); t("empty mask is rejected", not ok)
ok, f = L.mask_is_plausible(np.full((10, 10), 255, np.uint8)); t("full-frame mask is rejected", not ok)
ok, f = L.mask_is_plausible(m); t("normal mask is accepted", ok, f)
# split / merge: every frame covered exactly once, order preserved
n, s = 10, 4; fw, bk = L.split_plan(n, s)
t("forward pass is start..end", fw == list(range(4, 10))); t("backward pass is start..0", bk == [4, 3, 2, 1, 0])
out = L.merge_alpha(n, s, [np.full((2, 2), i, np.float32) for i in fw], [np.full((2, 2), i, np.float32) for i in bk])
t("merged sequence is complete and in order", all(out[i] is not None and out[i][0, 0] == i for i in range(n)))
out0 = L.merge_alpha(5, 0, [np.full((2, 2), i, np.float32) for i in range(5)], [np.zeros((2, 2), np.float32)])
t("start at frame 0 needs no backward pass", all(out0[i][0, 0] == i for i in range(5)))
# composite
rgb = np.full((20, 20, 3), 200, np.uint8); bg = np.zeros((20, 20, 3), np.uint8); al = np.zeros((20, 20), np.float32); al[5:15, 5:15] = 1
c = L.composite(rgb, al, bg); t("composite: inside is the person", abs(int(c[10, 10, 0]) - 200) <= 1); t("composite: outside is the background", c[0, 0, 0] == 0)
al2 = al.copy(); al2[5:15, 5:15] = 0.5; c2 = L.composite(rgb, al2, bg); t("composite: half alpha is about half", 90 <= c2[10, 10, 0] <= 110, c2[10, 10, 0])
t("fit_background covers the target size", L.fit_background(np.zeros((50, 200, 3), np.uint8), 160, 90).shape == (90, 160, 3))
# flicker metric
steady = [al] * 5; jitter = [np.clip(al * (0.5 + 0.5 * (i % 2)), 0, 1) for i in range(5)]
t("flicker: steady is 0", L.temporal_flicker(steady) == 0.0); t("flicker: jitter is larger", L.temporal_flicker(jitter) > 0.1)
sys.exit(1 if bad else 0)
