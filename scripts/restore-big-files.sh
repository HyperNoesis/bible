#!/bin/sh
# The FULL zip (genesis-v0_62-FULL-deployable.zip) already contains every binary: you only need this if a file is missing.
# Restores: the 2 onnxruntime-web WASM files (verified against BIG_FILES.sha256) and the 2 models. The models are downloaded as the unmodified
# float32 originals, verified against BIG_FILES_ORIGINAL.sha256, then packed to fp16 weights with tools/model-pack/pack_fp16.py (needs python3 + `pip install onnx`).
# Run from the repo root.
set -e
B=https://raw.githubusercontent.com/HyperNoesis/Beggining-/main
mkdir -p models vendor/ort
for f in vendor/ort/ort-wasm-simd-threaded.wasm vendor/ort/ort-wasm-simd-threaded.jsep.wasm; do
  [ -f "$f" ] || curl -fL --retry 3 -o "$f" "$B/$f"
done
T=$(mktemp -d)
if [ ! -f models/modnet.onnx ]; then
  curl -fL --retry 3 -o "$T/modnet.onnx" "$B/models/modnet.onnx"
fi
if [ ! -f models/rvm_mobilenetv3_fp32.onnx ]; then
  curl -fL --retry 3 -o "$T/rvm_mobilenetv3_fp32.onnx" "$B/models/rvm_mobilenetv3_fp32.onnx" || curl -fL --retry 3 -o "$T/rvm_mobilenetv3_fp32.onnx" https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx
fi
for f in modnet.onnx rvm_mobilenetv3_fp32.onnx; do
  [ -f "$T/$f" ] || continue
  want=$(grep " $f\$" BIG_FILES_ORIGINAL.sha256 | cut -d' ' -f1); got=$(sha256sum "$T/$f" | cut -d' ' -f1)
  [ "$want" = "$got" ] || { echo "ORIGINAL $f hash mismatch (got $got) - not used"; exit 1; }
  python3 -c "import onnx" 2>/dev/null || pip install --break-system-packages -q onnx
  python3 tools/model-pack/pack_fp16.py "$T/$f" "models/$f"
done
rm -rf "$T"
sha256sum -c BIG_FILES.sha256 || echo "NOTE: a re-packed model can differ byte-for-byte (different onnx version). It is numerically the same; if js/enhance-core.js rejects it, copy the new sha256 into that file."
