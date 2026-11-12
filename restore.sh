#!/bin/sh
set -e; cd "$(dirname "$0")"; mkdir -p weights-restored
for n in BiRefNet-matting.pth BiRefNet-portrait.pth birefnet.onnx matanyone2.pth; do cat weights/$n.part* > weights-restored/$n; done
cp weights/SHA256SUMS weights-restored/; cd weights-restored && sha256sum -c SHA256SUMS
