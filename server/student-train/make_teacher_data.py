#!/usr/bin/env python3
"""Turn ordinary videos into student training clips, labelled by the TEACHER (the v0.84 clean export pipeline):
   BiRefNet-matting (MIT) [+ flip test-time augmentation] -> hand-crop refinement -> optional SAM 2.1 gate -> flow-guided temporal fusion.
The labels are therefore steady, edge-accurate alphas that no live model can produce itself. The student learns to imitate them.

Licensing: only the clean teacher is used. MatAnyone 2 / SAM2Matting outputs are NOT used as labels (non-commercial licences); keep it that way.
Data: use footage you own or have written permission to train on (record your own people, rooms, phones, dark rooms). Anything else: get the licence first.

  python make_teacher_data.py --videos /data/raw/*.mp4 --out /data/clips --tag lowlight --max-size 720 --segment 240
Output: /data/clips/<video>_<segment>/{00000.jpg,00000.png,...,meta.json}. Run with the studio-export folder next to this one (default ../studio-export).
Videos are processed in segments so a long video never needs all its frames in RAM; fusion does not cross a segment boundary.
"""
import argparse
import glob
import json
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.abspath(os.path.join(HERE, "..", "studio-export"))


def teacher_args(**kw):
    """The same defaults studio_export.py's CLI would give, so clean_alpha() runs unchanged."""
    d = dict(birefnet_onnx=None, mask_model="matting", size=1024, no_temporal=False, causal=False, hands="auto", hands_mode="union", hands_pad=1.8,
             hands_max=2, tracker="off", sam2_checkpoint=None, start_frame=-1, tta=True)
    d.update(kw)
    return types.SimpleNamespace(**d)


def read_segments(path, max_side, segment):
    """Yield lists of RGB uint8 frames, `segment` frames at a time (all frames, original order)."""
    import cv2
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise SystemExit(f"cannot open {path}")
    seg = []
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        h, w = bgr.shape[:2]
        s = min(1.0, max_side / min(h, w)) if max_side > 0 else 1.0
        if s < 1.0:
            bgr = cv2.resize(bgr, (int(round(w * s / 2) * 2), int(round(h * s / 2) * 2)), interpolation=cv2.INTER_AREA)
        else:
            bgr = bgr[: h - h % 2, : w - w % 2]
        seg.append(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        if len(seg) == segment:
            yield seg
            seg = []
    cap.release()
    if len(seg) >= 8:
        yield seg


def write_clip(d, frames, alpha, tags, source):
    import cv2
    os.makedirs(d, exist_ok=True)
    for i, (f, a) in enumerate(zip(frames, alpha)):
        cv2.imwrite(os.path.join(d, f"{i:05d}.jpg"), f[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, 95])
        cv2.imwrite(os.path.join(d, f"{i:05d}.png"), (a.clip(0, 1) * 255 + 0.5).astype("uint8"))
    json.dump({"tags": tags, "source": os.path.basename(source), "teacher": "birefnet-matting+tta+hands+fusion"}, open(os.path.join(d, "meta.json"), "w"))


def main(a):
    sys.path.insert(0, EXPORT)
    import torch
    import studio_export as SE
    device = "cuda" if torch.cuda.is_available() else "cpu"
    vids = sorted({v for p in a.videos for v in glob.glob(p)})
    if not vids:
        raise SystemExit("no videos matched")
    targs = teacher_args(hands=a.hands, tta=not a.no_tta, size=a.size, tracker=a.tracker)
    os.makedirs(a.out, exist_ok=True)
    made = 0
    for v in vids:
        base = os.path.splitext(os.path.basename(v))[0]
        for k, seg in enumerate(read_segments(v, a.max_size, a.segment)):
            d = os.path.join(a.out, f"{base}_{k:03d}")
            if os.path.isdir(d) and not a.overwrite:
                continue
            fused, raw, backend, extra = SE.clean_alpha(seg, targs, device, lambda x: None)
            write_clip(d, seg, fused, a.tag, v)
            made += 1
            print(json.dumps({"clip": d, "frames": len(seg), "backend": backend, **extra}), flush=True)
    print(json.dumps({"done": True, "clips_made": made, "out": a.out}))


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--videos", nargs="+", required=True, help="video files or globs")
    p.add_argument("--out", required=True)
    p.add_argument("--tag", action="append", default=[], help="tag every clip (repeatable): lowlight, hands, phone, dark-room, ...")
    p.add_argument("--max-size", type=int, default=720, help="shorter side in px (the student trains on crops of this)")
    p.add_argument("--segment", type=int, default=240, help="frames per clip")
    p.add_argument("--size", type=int, default=1024, help="BiRefNet input size")
    p.add_argument("--hands", choices=["auto", "on", "off"], default="auto")
    p.add_argument("--tracker", choices=["off", "auto", "on"], default="off")
    p.add_argument("--no-tta", action="store_true", help="skip the flip test-time augmentation (2x faster, slightly noisier labels)")
    p.add_argument("--overwrite", action="store_true")
    main(p.parse_args())
