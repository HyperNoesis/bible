#!/usr/bin/env python3
"""PROMOTION GATE: may the student replace RVM in the live app? Default answer is NO. RVM is only removed when this says PROMOTE.

Runs the student, RVM and MODNet (ONNX, CPU) on the same clips at the same input size, scores each, times each, and decides.

  python promote_gate.py --student genesis_student.onnx --rvm ../../models/rvm_mobilenetv3_fp32.onnx --modnet ../../models/modnet.onnx \
      --gt-root gt_clips --size 288x512 --out gate_report.json

Why --gt-root matters: the student is trained on the teacher's masks, so scoring against teacher masks flatters it (and penalises RVM/MODNet for
disagreeing with a teacher they never saw). That comparison is reported but can NEVER promote. Promotion needs INDEPENDENT ground truth:
clips (same folder format as training clips) whose alpha was hand-checked / hand-corrected by a person, or from a licensed matting benchmark, and
that were never in the training set. Without --gt-root the verdict is INCONCLUSIVE.
flicker is reference-free (intrinsic), so it is fair to every engine and is always reported.

Rules (all must hold; margins are deliberately demanding):
  1. GT clips >= --min-clips (default 20) and >= --min-frames total.
  2. On GT: student mean mad, edge_mad, grad each <= RVM * 0.97, and flicker <= RVM * 0.97.
  3. Per-clip composite score: student beats RVM on >= 70% of clips.
  4. No tag (lowlight, hands, phone, ...) regresses: student tag-mean composite <= RVM's.
  5. Speed: student median ms/frame <= RVM * --max-latency-ratio (default 1.0) at the same input size.
Even then: run docs/BLIND_TEST.md (blindtest.html) on real recordings, and test on the real phones (S1, S5, S6), before deleting RVM.
"""
import argparse
import json
import os
import time

import cv2
import numpy as np

import data as D
import metrics as Mt


class Engine:
    def __init__(self, name, path, threads):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        so.inter_op_num_threads = 1
        self.name = name
        self.s = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
        self.inputs = [i.name for i in self.s.get_inputs()]

    def run_clip(self, X):
        """X uint8 [T,h,w,3] RGB -> list of float alpha (h,w), per-frame seconds."""
        raise NotImplementedError


class Recurrent(Engine):
    def __init__(self, name, path, threads, downsample=None):
        super().__init__(name, path, threads)
        self.ds = downsample
        self.out_names = [o.name for o in self.s.get_outputs()]

    def run_clip(self, X):
        z = np.zeros((1, 1, 1, 1), np.float32)
        r = [z] * 4
        out, times = [], []
        pha_i = self.out_names.index("pha")
        rec_i = [i for i, n in enumerate(self.out_names) if n.startswith("r") and n.endswith("o")]
        for f in X:
            x = (f.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
            feed = {"src": x, "r1i": r[0], "r2i": r[1], "r3i": r[2], "r4i": r[3]}
            if "downsample_ratio" in self.inputs:
                feed["downsample_ratio"] = np.array([self.ds or 1.0], np.float32)
            t = time.perf_counter()
            o = self.s.run(None, feed)
            times.append(time.perf_counter() - t)
            r = [o[i] for i in rec_i]
            out.append(np.clip(o[pha_i][0, 0], 0, 1))
        return out, times


class Modnet(Engine):
    def run_clip(self, X):
        out, times = [], []
        for f in X:
            x = (f.astype(np.float32) / 127.5 - 1.0).transpose(2, 0, 1)[None]
            t = time.perf_counter()
            o = self.s.run(None, {self.inputs[0]: x})
            times.append(time.perf_counter() - t)
            out.append(np.clip(o[0][0, 0], 0, 1))
        return out, times


def score_engine(eng, clips, shape, max_frames, warm=3):
    per, lat = [], []
    for c in clips:
        X, A = D.load_clip(c["gt"], shape, max_frames)
        pred, times = eng.run_clip(X)
        m = Mt.evaluate(pred, list(A))
        m["score"] = Mt.composite_score(m)
        per.append({"clip": os.path.basename(c["gt"]["dir"]), "tags": c["gt"]["tags"], **m})
        lat += times[warm:]
    mean = {k: float(np.mean([p[k] for p in per])) for k in ("mad", "mse", "grad", "edge_mad", "flicker", "temporal_err", "score")}
    return {"mean": mean, "per_clip": per, "ms_median": float(np.median(lat) * 1000) if lat else None}


def decide(res, n_clips, n_frames, a):
    why, ok = [], True

    def check(cond, msg):
        nonlocal ok
        if not cond:
            ok = False
            why.append(msg)
    check(n_clips >= a.min_clips, f"only {n_clips} GT clips (need {a.min_clips})")
    check(n_frames >= a.min_frames, f"only {n_frames} GT frames (need {a.min_frames})")
    s, r = res["student"], res["rvm"]
    for k in ("mad", "edge_mad", "grad", "flicker"):
        check(s["mean"][k] <= r["mean"][k] * a.margin, f"{k}: student {s['mean'][k]:.5f} vs RVM {r['mean'][k]:.5f} (needs <= {a.margin} x RVM)")
    wins = np.mean([sp["score"] < rp["score"] for sp, rp in zip(s["per_clip"], r["per_clip"])])
    check(wins >= a.win_rate, f"student beats RVM on {wins:.0%} of clips (needs {a.win_rate:.0%})")
    tags = sorted({t for p in s["per_clip"] for t in p["tags"]})
    tag_rows = {}
    for t in tags:
        sv = np.mean([p["score"] for p in s["per_clip"] if t in p["tags"]])
        rv = np.mean([p["score"] for p in r["per_clip"] if t in p["tags"]])
        tag_rows[t] = {"student": float(sv), "rvm": float(rv)}
        check(sv <= rv, f"tag '{t}' regresses: student {sv:.3f} vs RVM {rv:.3f}")
    ratio = s["ms_median"] / r["ms_median"] if r["ms_median"] else float("inf")
    check(ratio <= a.max_latency_ratio, f"latency {s['ms_median']:.1f} ms vs RVM {r['ms_median']:.1f} ms (ratio {ratio:.2f}, limit {a.max_latency_ratio})")
    return ("PROMOTE" if ok else "KEEP_RVM"), why, {"win_rate": float(wins), "tags": tag_rows, "latency_ratio": ratio}


def main(a):
    h, w = (int(v) for v in a.size.lower().split("x"))
    shape = (h, w)
    if not a.gt_root:
        print(json.dumps({"verdict": "INCONCLUSIVE", "reason": "no --gt-root: independent ground truth is required to promote. Teacher-label scores can not decide."}))
    eng = {"student": Recurrent("student", a.student, a.threads), "rvm": Recurrent("rvm", a.rvm, a.threads, a.rvm_downsample), "modnet": Modnet("modnet", a.modnet, a.threads)} if a.modnet else \
          {"student": Recurrent("student", a.student, a.threads), "rvm": Recurrent("rvm", a.rvm, a.threads, a.rvm_downsample)}
    report = {"size": a.size, "threads": a.threads, "note": "CPU onnxruntime latency is a proxy only; phones are not measured here."}
    for label, root in (("independent_gt", a.gt_root), ("teacher_labels_biased", a.teacher_root)):
        if not root:
            continue
        clips = [{"gt": c} for c in D.list_clips(root)]
        if a.max_clips:
            clips = clips[: a.max_clips]
        res = {n: score_engine(e, clips, shape, a.max_frames) for n, e in eng.items()}
        sec = {"clips": len(clips), "frames": sum(len(c["gt"]["frames"][: a.max_frames]) for c in clips), "engines": {n: {"mean": r["mean"], "ms_median": r["ms_median"]} for n, r in res.items()}}
        if label == "independent_gt":
            verdict, why, extra = decide(res, len(clips), sec["frames"], a)
            sec.update(extra); report["verdict"] = verdict; report["why_not" if verdict != "PROMOTE" else "passed"] = why or ["all rules held"]
            sec["per_clip"] = {n: r["per_clip"] for n, r in res.items()}
        else:
            sec["warning"] = "student was trained on these labels: informational only, can not promote"
        report[label] = sec
    report.setdefault("verdict", "INCONCLUSIVE")
    if a.out:
        json.dump(report, open(a.out, "w"), indent=1)
    show = {k: v for k, v in report.items() if k not in ("independent_gt", "teacher_labels_biased")}
    for k in ("independent_gt", "teacher_labels_biased"):
        if k in report:
            show[k] = {"clips": report[k]["clips"], "engines": report[k]["engines"]}
    print(json.dumps(show, indent=1))


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--student", required=True); p.add_argument("--rvm", required=True); p.add_argument("--modnet")
    p.add_argument("--gt-root", help="independent ground-truth clips (hand-checked alpha, never trained on)")
    p.add_argument("--teacher-root", help="optional: validation clips with TEACHER labels (informational, biased toward the student)")
    p.add_argument("--size", default="288x512"); p.add_argument("--max-frames", type=int, default=60); p.add_argument("--max-clips", type=int, default=0)
    p.add_argument("--threads", type=int, default=2); p.add_argument("--rvm-downsample", type=float, default=1.0, help="RVM downsample_ratio (1.0 at <=512 like the app's 'fast' preset)")
    p.add_argument("--margin", type=float, default=0.97); p.add_argument("--win-rate", type=float, default=0.7)
    p.add_argument("--min-clips", type=int, default=20); p.add_argument("--min-frames", type=int, default=600); p.add_argument("--max-latency-ratio", type=float, default=1.0)
    p.add_argument("--out", default="gate_report.json")
    main(p.parse_args())
