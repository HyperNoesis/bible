#!/bin/sh
# Three-stage distillation. Every number below is a reasoned starting point, NOT tuned: watch val in runs/*/log.jsonl and adjust.
#   DATA=/data/clips/train VAL=/data/clips/val ./run_all.sh
# Stops/resumes safely (last.pt every 500 steps): on a free Colab/Kaggle session that disconnects, rerun the same command; finished stages are skipped.
set -e
cd "$(dirname "$0")"
DATA=${DATA:?set DATA=/path/to/train/clips}; VAL=${VAL:?set VAL=/path/to/val/clips}; OUT=${OUT:-runs}
BG=${BG:+--bg-dir $BG}; EXTRA=${EXTRA:-"--pretrained"}
stage() { # name steps bs seq lr resume shapes...
  n=$1; steps=$2; bs=$3; seq=$4; lr=$5; prev=$6; shift 6
  if [ -f "$OUT/$n/DONE" ]; then echo "stage $n already done"; return; fi
  sh_args=""; for s in "$@"; do sh_args="$sh_args --shape $s"; done
  res=""; [ -n "$prev" ] && res="--resume $OUT/$prev/best.pt --init-only"
  [ -f "$OUT/$n/last.pt" ] && res="--resume $OUT/$n/last.pt"      # continue THIS stage if it was interrupted
  ${PY:-python3} train.py --data "$DATA" --val "$VAL" --out "$OUT/$n" --steps "$steps" --bs "$bs" --seq-len "$seq" --lr "$lr" $sh_args $res $BG $EXTRA \
      --val-shape 288x512 --val-every 1000
  touch "$OUT/$n/DONE"
}
stage s1 30000 16 4  3e-4 ""  256x256 224x384 384x224          # shapes of a person, edges, low-res: fast
stage s2 20000 8  8  1.5e-4 s1 288x512 512x288 384x384         # memory + steadiness on longer sequences
stage s3 15000 4  12 5e-5 s2   320x576 576x320 448x448         # fine-tune at the sizes the browser really runs
${PY:-python3} export_onnx.py --ckpt "$OUT/s3/best.pt" --out "$OUT/genesis_student.onnx" --height 288 --width 512
${PY:-python3} ../../tools/model-pack/pack_fp16.py "$OUT/genesis_student.onnx" "$OUT/genesis_student_fp16w.onnx"
echo "now run promote_gate.py with INDEPENDENT ground truth (see README). RVM stays until it says PROMOTE."
