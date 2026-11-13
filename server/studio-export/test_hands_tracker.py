"""Run: python test_hands_tracker.py   (numpy, scipy, opencv only; no GPU, no models, no mediapipe)"""
import sys
import numpy as np
import hands_refine as H
import tracker_gate as TG

bad = 0


def t(n, c, x=""):
    global bad
    bad += (not c)
    print(("PASS " if c else "FAIL ") + n, x)


W, Hh = 400, 300
# ---- boxes
b = H.clamp_box(-20, -10, 80, 90, W, Hh)
t("clamp moves a box inside without shrinking", b == (0, 0, 100, 100), b)
b = H.clamp_box(350, 250, 450, 350, W, Hh)
t("clamp at the bottom-right corner", b == (300, 200, 400, 300), b)
sq = H.squarify((100, 100, 200, 140), W, Hh)
t("squarify makes a square", (sq[2] - sq[0]) == (sq[3] - sq[1]), sq)
t("squarify stays in frame", sq[0] >= 0 and sq[1] >= 0 and sq[2] <= W and sq[3] <= Hh)
lm = np.array([[0.5, 0.5], [0.55, 0.6], [0.52, 0.45]], np.float32)
bx = H.boxes_from_landmarks([lm], W, Hh, pad=1.8, min_side=40)
t("one hand -> one box", len(bx) == 1)
t("box contains the landmarks", bx[0][0] <= 0.5 * W <= bx[0][2] and bx[0][1] <= 0.45 * Hh <= bx[0][3], bx)
t("empty landmarks are skipped", H.boxes_from_landmarks([np.zeros((0, 2), np.float32)], W, Hh) == [])
big = np.array([[0.0, 0.0], [1.0, 1.0]], np.float32)
bb = H.boxes_from_landmarks([big], W, Hh, max_frac=0.5)[0]
t("a huge hand box is capped (max_frac)", (bb[2] - bb[0]) <= 0.5 * Hh + 1, bb)
m = H.merge_overlapping([(0, 0, 100, 100), (20, 20, 120, 120), (300, 200, 380, 280)])
t("overlapping boxes merge, far one stays", len(m) == 2 and (0, 0, 120, 120) in m, m)
t("slight overlap (25%) does not merge", len(H.merge_overlapping([(0, 0, 100, 100), (50, 50, 150, 150)])) == 2)
t("non-overlapping boxes are untouched", len(H.merge_overlapping([(0, 0, 50, 50), (200, 200, 250, 250)])) == 2)

# ---- tracker
tr = H.BoxTracker(alpha=0.5, hold=2)
o = tr.update([(100, 100, 200, 200)])
t("tracker starts a track", len(o) == 1)
o = tr.update([(110, 100, 210, 200)])
t("tracker smooths the move (halfway)", o[0][0] == 105, o)
for _ in range(2):
    o = tr.update([])
t("tracker holds a lost hand for `hold` frames", len(o) == 1)
o = tr.update([])
t("tracker drops it after that", len(o) == 0)
tr = H.BoxTracker()
tr.update([(0, 0, 50, 50)])
o = tr.update([(300, 200, 350, 250)])
t("a far-away box is a new track, not a jump", len(o) == 2, o)

# ---- blend_crop
full = np.zeros((Hh, W), np.float32)
full[100:250, 150:250] = 1.0                       # body
full[100:140, 250:262] = 0.9                       # a thumb the full pass saw
box = (230, 90, 330, 190)
crop = np.zeros((100, 100), np.float32)
crop[10:50, 20:32] = 1.0                           # thumb again
crop[20:30, 40:50] = 1.0                           # a finger the full pass MISSED (near the body: x 270..280, y 110..120)
out = H.blend_crop(full, crop, box, "union", gate=0.25, feather=0.2)
t("union adds the missing finger", out[115, 275] > 0.5, out[115, 275])
t("union never lowers alpha", (out >= full - 1e-6).all())
t("pixels outside the box are untouched", np.array_equal(out[:, :200 - 0], full[:, :200]) and np.array_equal(out[250:], full[250:]))
far = np.zeros((100, 100), np.float32)
far[80:95, 80:95] = 1.0                            # a blob far from any person pixel (box x 310..325 y 170..185; the body ends at x 250)
out2 = H.blend_crop(full, far, box, "union", gate=0.25, feather=0.2)
t("gate blocks a background blob far from the person", out2[177, 317] < 0.05, out2[177, 317])
empty = np.zeros((100, 100), np.float32)
out3 = H.blend_crop(full, empty, box, "replace", gate=1.0, feather=0.0)
t("replace mode lets the crop lower alpha inside the box", out3[100:140, 250:262].mean() < 0.1, out3[100:140, 250:262].mean())
out3u = H.blend_crop(full, empty, box, "union", gate=1.0, feather=0.0)
t("union mode never does", np.array_equal(out3u, full))
z = H.blend_crop(full, np.zeros((5, 5), np.float32), box)
t("wrong crop size is ignored", np.array_equal(z, full))
edge_full = np.zeros((60, 60), np.float32); edge_full[:, :30] = 1
edge_crop = np.ones((40, 40), np.float32)
eo = H.blend_crop(edge_full, edge_crop, (0, 0, 40, 40), "union", gate=1.0, feather=0.25)
t("no fade on a box side that lies on the frame border", eo[20, 0] >= 0.99, eo[20, 0])

# ---- refiner with fakes
class FakeDet:
    def __init__(self, seq): self.seq, self.i = seq, 0
    def landmarks(self, rgb):
        r = self.seq[min(self.i, len(self.seq) - 1)]; self.i += 1; return r
    def close(self): pass


frame = np.zeros((Hh, W, 3), np.uint8)
alpha = np.zeros((Hh, W), np.float32); alpha[100:250, 150:250] = 1
calls = []
def alpha_fn(img):
    calls.append(img.shape); return np.ones(img.shape[:2], np.float32)
hand = np.array([[0.6, 0.45], [0.65, 0.5], [0.62, 0.4]], np.float32)
ref = H.HandRefiner(alpha_fn, FakeDet([[hand], [hand], []]), min_person=0.2)
r0 = ref(frame, alpha, 0)
t("refiner runs one crop for one hand", len(calls) == 1 and ref.stats["crops"] == 1, ref.stats)
t("crop is square (not stretched)", calls[0][0] == calls[0][1], calls[0])
ref(frame, alpha, 1)
r_lost = ref(frame, alpha, 2)
t("a lost detection keeps the tracked box for a few frames", len(calls) >= 2 or ref.stats["frames_with_hands"] >= 2, ref.stats)
nobody = np.zeros((Hh, W), np.float32)
calls.clear()
ref2 = H.HandRefiner(alpha_fn, FakeDet([[hand]]), min_person=0.2)
r = ref2(frame, nobody, 0)
t("no person in the box -> crop skipped", len(calls) == 0 and ref2.stats["skipped_no_person"] == 1 and np.array_equal(r, nobody), ref2.stats)
def boom(img): raise RuntimeError("gpu oom")
ref3 = H.HandRefiner(boom, FakeDet([[hand]]))
r = ref3(frame, alpha, 0)
t("an error falls back to the full-frame alpha", np.array_equal(r, alpha) and ref3.stats["errors"] == 1, ref3.last_error)

# ---- tracker gate
a = np.zeros((Hh, W), np.float32); a[80:260, 150:260] = 1.0
a[10:40, 20:60] = 0.9                              # a stray blob in the corner
mask = np.zeros((Hh, W), bool); mask[90:250, 160:250] = True
g, st = TG.gate_alpha(a, mask)
t("gate removes the stray blob", g[25, 40] < 0.05, g[25, 40])
t("gate keeps the person", g[170, 200] > 0.99, g[170, 200])
t("gate keeps hair/fingers just outside the coarse mask", g[85, 155] > 0.5, g[85, 155])
t("status is gated", st == "gated", st)
t("gate never adds alpha", (g <= a + 1e-6).all())
g2, st2 = TG.gate_alpha(a, np.zeros((Hh, W), bool))
t("empty tracker mask -> no change", st2 == "no_mask" and np.array_equal(g2, a))
g3, st3 = TG.gate_alpha(a, None)
t("None mask -> no change", st3 == "no_mask" and np.array_equal(g3, a))
wrong = np.zeros((Hh, W), bool); wrong[0:30, 350:400] = True      # tracker locked onto something else
g4, st4 = TG.gate_alpha(a, wrong)
t("tracker/alpha disagreement switches the gate off", st4 == "disagree" and np.array_equal(g4, a), st4)
seq, stats = TG.gate_sequence([a, a, a], [mask, None, wrong])
t("sequence stats add up", stats == {"gated": 1, "no_mask": 1, "disagree": 1}, stats)
bx = TG.bbox_from_alpha(a)
t("bbox is around the person", bx is not None and bx[0] <= 150 and bx[2] >= 260, bx)
t("bbox of nothing is None", TG.bbox_from_alpha(np.zeros((10, 10), np.float32)) is None)

sys.exit(1 if bad else 0)
