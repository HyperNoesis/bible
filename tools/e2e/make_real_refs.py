# Builds REFERENCE masks for the real-photo gate from the ORIGINAL float32 models, run in desktop onnxruntime (no weight rounding, no browser).
# The gate then checks that the shipped (fp16-packed) models, run in the real browser runtime, give the same masks.
# Usage: python3 make_real_refs.py <photos dir> <original fp32 modnet.onnx> <original fp32 rvm_mobilenetv3_fp32.onnx>
import sys, glob, os, numpy as np, onnxruntime as ort
from PIL import Image
d, mpath, rpath = sys.argv[1:4]
so = ort.SessionOptions(); so.log_severity_level = 3
mod = ort.InferenceSession(mpath, so, providers=['CPUExecutionProvider']); rvm = ort.InferenceSession(rpath, so, providers=['CPUExecutionProvider'])
W, H = 448, 256
for f in sorted(glob.glob(os.path.join(d, 'p*.jpg'))):
    im = Image.open(f).convert('RGB').resize((W, H), Image.BILINEAR); a = np.asarray(im, np.float32)
    m = mod.run(None, {mod.get_inputs()[0].name: (a / 127.5 - 1).transpose(2, 0, 1)[None]})[0][0, 0]
    rec = [np.zeros((1, 1, 1, 1), np.float32)] * 4; x = (a / 255).transpose(2, 0, 1)[None]; ds = np.array([168 / max(W, H)], np.float32)
    for _ in range(6):
        o = rvm.run(None, {'src': x, 'downsample_ratio': ds, 'r1i': rec[0], 'r2i': rec[1], 'r3i': rec[2], 'r4i': rec[3]})
        dct = dict(zip([n.name for n in rvm.get_outputs()], o)); rec = [dct['r1o'], dct['r2o'], dct['r3o'], dct['r4o']]
    base = f[:-4]
    Image.fromarray((np.clip(m, 0, 1) * 255 + .5).astype(np.uint8)).save(base + '_ref_modnet.png')
    Image.fromarray((np.clip(dct['pha'][0, 0], 0, 1) * 255 + .5).astype(np.uint8)).save(base + '_ref_rvm.png')
    print('ref', os.path.basename(f))
