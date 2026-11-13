#!/usr/bin/env python3
"""Export a trained student to ONNX (one frame per call, memory in/out like RVM) and check it against PyTorch.

  python export_onnx.py --ckpt runs/s3/best.pt --out genesis_student.onnx
  python ../../tools/model-pack/pack_fp16.py genesis_student.onnx genesis_student_fp16w.onnx      # optional: weights stored as fp16, maths stays fp32

Inputs: src [B,3,H,W] float 0..1 RGB (H, W multiples of 32), r1i..r4i (use zeros [1,1,1,1] on the first frame).
Outputs: pha [B,1,H,W], r1o..r4o. The check runs 3 recurrent frames in both PyTorch and onnxruntime and fails if they differ by more than --tol.
"""
import argparse
import json

import numpy as np
import torch

from student_model import StudentMatting, StepExport, count_params


def main(a):
    ck = torch.load(a.ckpt, map_location="cpu")
    args = ck.get("args", {})
    m = StudentMatting(args.get("backbone", "large"), args.get("width", 1.0), pretrained=False)
    m.load_state_dict(ck["ema"] if a.weights == "ema" else ck["model"])
    m.eval()
    w = StepExport(m).eval()
    H, W = a.height, a.width
    src = torch.rand(1, 3, H, W)
    z = torch.zeros(1, 1, 1, 1)
    names_in = ["src", "r1i", "r2i", "r3i", "r4i"]
    names_out = ["pha", "r1o", "r2o", "r3o", "r4o"]
    dyn = {n: {0: "batch_size", 2: "height", 3: "width"} for n in ["src", "pha"]}
    for n in names_in[1:] + names_out[1:]:
        dyn[n] = {0: "batch_size", 1: "channels", 2: "height", 3: "width"}
    kw = dict(input_names=names_in, output_names=names_out, dynamic_axes=dyn, opset_version=a.opset)
    try:
        torch.onnx.export(w, (src, z, z, z, z), a.out, dynamo=False, **kw)
    except TypeError:                                         # older torch without the dynamo flag
        torch.onnx.export(w, (src, z, z, z, z), a.out, **kw)
    import onnxruntime as ort
    s = ort.InferenceSession(a.out, providers=["CPUExecutionProvider"])
    worst = 0.0
    rt = [z.numpy()] * 4
    rp = [z] * 4
    for k in range(3):
        x = torch.rand(1, 3, H, W) if k else src
        with torch.no_grad():
            pa, *rp = w(x, *rp)
        out = s.run(None, dict(zip(names_in, [x.numpy(), *rt])))
        rt = out[1:]
        worst = max(worst, float(np.abs(out[0] - pa.numpy()).max()))
    # a different resolution must work too (the browser picks sizes per device)
    x2 = np.random.rand(1, 3, 192, 320).astype(np.float32)
    o2 = s.run(None, dict(zip(names_in, [x2, *[z.numpy()] * 4])))
    ok = worst <= a.tol and o2[0].shape == (1, 1, 192, 320)
    res = {"onnx": a.out, "params_m": round(count_params(m) / 1e6, 3), "state_channels": m.state_channels, "max_abs_diff_vs_torch": worst, "other_res_ok": o2[0].shape == (1, 1, 192, 320), "ok": ok}
    print(json.dumps(res))
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ckpt", required=True); p.add_argument("--out", default="genesis_student.onnx")
    p.add_argument("--weights", choices=["ema", "raw"], default="ema")
    p.add_argument("--height", type=int, default=288); p.add_argument("--width", type=int, default=512)
    p.add_argument("--opset", type=int, default=17); p.add_argument("--tol", type=float, default=2e-3)
    main(p.parse_args())
