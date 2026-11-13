#!/bin/sh
# v0.83: the weights and code are ALREADY BUNDLED in this package (weights/ and vendor/). Run this only to re-download or verify.
#   ./fetch_models.sh   -> fetches anything missing (BiRefNet matting + portrait, BiRefNet general ONNX, MatAnyone 2 REFERENCE weights) and checks SHA256SUMS
# Everything comes from GitHub. Pinned to the commits this was written against (Nov 2026).
set -e
cd "$(dirname "$0")"; mkdir -p vendor weights
[ -d vendor/BiRefNet ] || { git clone https://github.com/ZhengPeng7/BiRefNet vendor/BiRefNet && git -C vendor/BiRefNet checkout f7079632d681ecf12161fcea8905682934e59e51; }
if [ "${SKIP_REFERENCE:-0}" != "1" ]; then [ -d vendor/MatAnyone2 ] || { git clone https://github.com/pq-yang/MatAnyone2 vendor/MatAnyone2 && git -C vendor/MatAnyone2 checkout 0079197acd6d16a741f71558809c06c586c579e0; }; fi
# Mirror of the same files on this repo's `models` branch (90 MB parts), used if an original release link ever disappears.
M=https://raw.githubusercontent.com/HyperNoesis/bible/models/weights
mirror() { rm -f "weights/$1"; i=0; while :; do curl -sfL "$M/$1.part$(printf '%03d' $i)" >> "weights/$1" || break; i=$((i+1)); done; [ "$i" -gt 0 ] || { echo "no mirror copy of $1"; return 1; }; echo "restored $1 from the models branch ($i parts)"; }
get() { [ -s "weights/$2" ] || curl -L --fail -C - -o "weights/$2" "$1" || mirror "$2"; }
get https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-matting-epoch_100.pth BiRefNet-matting.pth
get https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-portrait-epoch_150.pth BiRefNet-portrait.pth
get https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-epoch_244.onnx birefnet.onnx
[ "${SKIP_REFERENCE:-0}" = "1" ] || get https://github.com/pq-yang/MatAnyone2/releases/download/v1.0.0/matanyone2.pth matanyone2.pth
# v0.84 optional: SAM 2.1 Tiny (Apache-2.0) for --tracker. Run: WITH_SAM2=1 ./fetch_models.sh   (NOT hash-checked: add its SHA-256 to weights/SHA256SUMS after the first download)
if [ "${WITH_SAM2:-0}" = "1" ]; then
  get https://dl.fbaipublicfiles.com/sam2/sam2.1_hiera_tiny.pt sam2.1_hiera_tiny.pt
  python3 -c "import sam2" 2>/dev/null || echo "also run: pip install git+https://github.com/facebookresearch/sam2.git"
fi
echo "NOTE: MatAnyone 2 (S-Lab licence) is for measuring only. Do not use its output in a paid product without a written commercial licence."
( cd weights && sha256sum -c --ignore-missing SHA256SUMS ) && echo "all weights verified"
