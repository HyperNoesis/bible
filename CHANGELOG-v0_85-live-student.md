# v0.85 — live student (distillation pipeline) + teacher flip-TTA. RVM STAYS until the gate says PROMOTE.
Apply on top of v0.84 (copy over the project, same paths). Export server and training only: the browser app is untouched, RVM is untouched.

## New: server/student-train/
1. student_model.py: recurrent matting net written from scratch (MobileNetV3 encoder, context block, ConvGRU memory at 4 scales, full-res refinement head),
   3.8 M params (`--backbone small`: 1.6 M), RVM-shaped ONNX contract (src + r1i..r4i -> pha + r1o..r4o). Not RVM code (GPL).
2. make_teacher_data.py: videos -> labelled clips using the clean teacher (BiRefNet + flip-TTA + hand crops + fusion). Segments long videos. Never uses MatAnyone 2 / SAM2Matting labels.
3. data.py, losses.py: temporally-consistent augmentation (zoom, flip, colour, low-light + sensor noise, background swap, frame skipping); L1 (edge-weighted) + Laplacian-pyramid +
   gradient + temporal-change + coarse-alpha losses.
4. train.py + run_all.sh: AMP, EMA, cosine LR, mixed aspect ratios, validation with metrics each N steps, best/last checkpoints, resumable (free-GPU-session friendly),
   3-stage schedule (starting points, untuned).
5. export_onnx.py: ONNX export + parity check over 3 recurrent frames and a second resolution. pack_fp16.py (existing) shrinks it.
6. promote_gate.py: scores student vs RVM vs MODNet (same clips, same size, CPU latency). PROMOTE only with INDEPENDENT ground truth, margins, per-clip win-rate, per-tag no-regression, speed.
   Teacher-label scores are shown but can never promote (they are biased toward the student). No ground truth = INCONCLUSIVE.
7. metrics.py (MAD, MSE, gradient, edge-band MAD, reference-free flicker, temporal error). test_student.py: 35 checks. README.md: data plan, training, gate, licence notes.
## Changed: server/studio-export/studio_export.py: new `--tta` (flip test-time augmentation for the BiRefNet pass).

## Verified (sandbox, CPU, no GPU)
test_student.py 35/35; the v0.84 export tests still pass; a CPU training run learns the synthetic clips (val MAD 0.50 -> 0.23 in 160 steps); ONNX matches PyTorch to 7e-7;
the gate runs end-to-end against the real models/rvm_mobilenetv3_fp32.onnx and models/modnet.onnx and correctly answers KEEP_RVM for the barely-trained model; run_all.sh stage/resume flow dry-run.
A real bug was found and fixed in this pass: resuming an interrupted stage re-ran the full step count (now runs only what is left; regression test added).
## NOT verified
Anything on real footage or a GPU: label quality, training stability at real resolution, bf16 AMP, the stage hyper-parameters, whether the student ever beats RVM (that is what the gate is for),
phone speed (CPU timing at 192x256 on this sandbox is not a phone). make_teacher_data.py was not run (needs BiRefNet weights + a GPU box). The `--pretrained` download was not exercised.
The browser provider for the student (student-provider.js) is NOT written: the I/O contract is fixed in README, and it should be built against a real trained model.
