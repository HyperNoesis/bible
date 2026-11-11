#!/bin/sh
# Fetches 4 REAL handheld photos (a person with curly hair on a busy outdoor background) for the real-photo gate (t45_real_photo_gate.js).
# Source: github.com/senguptaumd/Background-Matting sample_data, licence CC BY-NC-SA 4.0 = NON-COMMERCIAL, so these images are used for TESTING ONLY
# and must NOT be shipped inside the app or its zip. This script writes them to a folder OUTSIDE the project (default ../../../real_photos).
# Usage: sh get_real_photos.sh [outdir] ; then: python3 make_real_refs.py <outdir> <fp32 modnet.onnx> <fp32 rvm.onnx> ; then REAL_PHOTOS=<outdir> node t45_real_photo_gate.js
set -e
OUT="${1:-../../../real_photos}"; T=$(mktemp -d)
git clone -q --depth 1 https://github.com/senguptaumd/Background-Matting.git "$T/bm"
mkdir -p "$OUT"
python3 - "$T/bm/sample_data/input" "$OUT" <<'PY'
import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
for i in ('0001', '0500', '1000', '1500'):
    Image.open(f'{src}/{i}_img.png').convert('RGB').resize((640, 360), Image.LANCZOS).save(f'{out}/p{i}.jpg', quality=95)
print('wrote 4 photos to', out)
PY
rm -rf "$T"
