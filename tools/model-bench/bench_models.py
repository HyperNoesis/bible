#!/usr/bin/env python3
"""Compare candidate person-segmentation/matting ONNX models on the same frame: IoU, edge-band alpha error, ms per frame.
SYNTHETIC fixture only (tools/e2e/mkfx.py writes /tmp/srv/fx/frame0.png + gt_alpha.png). CPU timings on THIS machine are for RANKING models against
each other, never phone numbers. Run on real footage before choosing a model: pass --frame/--gt with a real photo and a hand-made matte.
Usage: python3 tools/model-bench/bench_models.py [--frame f.png --gt g.png] [--runs 8] name=path[:kind] ...
  kinds: modnet | pphumanseg | u2net | rvm   (default: guessed from the name)
Licences (check before shipping): MODNet Apache-2.0, PP-HumanSeg Apache-2.0, U2Net MIT-style, silueta MIT, RVM GPL-3.0.
"""
import argparse, time, sys
import numpy as np, cv2, onnxruntime as ort

def load(sp, w, h):
    return cv2.cvtColor(cv2.imread(sp), cv2.COLOR_BGR2RGB)

def prep(kind, rgb):
    H, W = rgb.shape[:2]
    if kind == 'modnet':
        x = cv2.resize(rgb, (512, 288), interpolation=cv2.INTER_AREA).astype(np.float32)
        return {'input': ((x - 127.5) / 127.5).transpose(2, 0, 1)[None]}
    if kind == 'pphumanseg':
        x = cv2.resize(rgb, (192, 192), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
        return {'x': ((x - 0.5) / 0.5).transpose(2, 0, 1)[None]}
    if kind == 'u2net':
        x = cv2.resize(rgb, (320, 320), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
        m = np.array([0.485, 0.456, 0.406], np.float32); s = np.array([0.229, 0.224, 0.225], np.float32)
        return {'input.1': ((x - m) / s).transpose(2, 0, 1)[None]}
    if kind == 'rvm':
        x = cv2.resize(rgb, (640, 360), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
        z = np.zeros((1, 1, 1, 1), np.float32)
        return {'src': x.transpose(2, 0, 1)[None], 'r1i': z, 'r2i': z, 'r3i': z, 'r4i': z, 'downsample_ratio': np.array([0.5], np.float32)}
    raise SystemExit('unknown kind ' + kind)

def alpha_of(kind, outs, names):
    if kind == 'modnet': return outs[0][0, 0]
    if kind == 'pphumanseg':
        o = outs[0][0]; e = np.exp(o - o.max(0, keepdims=True)); return (e / e.sum(0, keepdims=True))[1]
    if kind == 'u2net':
        a = outs[0][0, 0]; return (a - a.min()) / max(1e-6, a.max() - a.min())
    if kind == 'rvm': return outs[names.index('pha')][0, 0]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frame', default='/tmp/srv/fx/frame0.png'); ap.add_argument('--gt', default='/tmp/srv/fx/gt_alpha.png')
    ap.add_argument('--runs', type=int, default=8); ap.add_argument('models', nargs='+')
    a = ap.parse_args()
    rgb = load(a.frame, 0, 0); H, W = rgb.shape[:2]
    gt = cv2.imread(a.gt, -1); gt = gt[..., -1] if gt.ndim == 3 and gt.shape[2] == 4 else (gt if gt.ndim == 2 else gt[..., 0])
    gt = cv2.resize(gt, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    edge = ((gt > 0.01) & (gt < 0.99)).astype(np.uint8); band = cv2.dilate(edge, np.ones((17, 17), np.uint8)) > 0
    print(f'{"model":<22}{"IoU":>7}{"edgeMAE":>9}{"ms/frame":>10}   (frame {W}x{H}, band px {int(band.sum())})')
    for spec in a.models:
        name, _, rest = spec.partition('='); path, _, kind = rest.partition(':')
        kind = kind or ('modnet' if 'modnet' in name else 'pphumanseg' if 'pphuman' in name else 'rvm' if 'rvm' in name else 'u2net')
        s = ort.InferenceSession(path, providers=['CPUExecutionProvider']); names = [o.name for o in s.get_outputs()]
        feed = prep(kind, rgb); ts = []
        for i in range(a.runs + 2):
            t = time.perf_counter(); outs = s.run(None, feed); ts.append((time.perf_counter() - t) * 1000)
            if kind == 'rvm':   # carry the recurrent state so frame 3+ is a real prediction
                for k, o in zip(['r1i', 'r2i', 'r3i', 'r4i'], ['r1o', 'r2o', 'r3o', 'r4o']): feed[k] = outs[names.index(o)]
        al = cv2.resize(alpha_of(kind, outs, names).astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR)
        iou = ((al > .5) & (gt > .5)).sum() / max(1, ((al > .5) | (gt > .5)).sum())
        print(f'{name:<22}{iou:>7.3f}{np.abs(al - gt)[band].mean():>9.3f}{np.median(ts[2:]):>10.0f}')

if __name__ == '__main__': main()
