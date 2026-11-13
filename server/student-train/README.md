# Genesis live matting student (v0.85)

A recurrent matting network (MobileNetV3 encoder, ConvGRU memory at 4 scales, full-resolution refinement head, 3.8 M params, 1.6 M with `--backbone small`)
that **learns from the offline teacher** (BiRefNet-matting + flip-TTA + hand crops + temporal fusion, the v0.84 export pipeline) and runs live in the browser.
It is written from scratch; no RVM code or weights. **RVM stays in the app until `promote_gate.py` says PROMOTE** (rules below). Nothing here has been trained on real data yet.

## Why this is the strongest clean option
No licence-clean pretrained live model is stronger than MODNet/BGMv2 today (checked Nov 2026; see docs/MODEL_DECISION_v0_82.md). The strongest thing you can
legally ship is a model you train yourself on labels no live model could make: the teacher is a 1024 px image model plus optical-flow fusion, so the student
is taught steady, hair-accurate masks, with your own footage (dark rooms, cheap phones, your users' lighting and hair, hands). Teachers, not students, carry the licence risk:
MatAnyone 2 / SAM2Matting (non-commercial) are never used to make labels.

## 1. Collect footage (the part that decides quality)
Only footage you own or have written permission for. More variety beats more hours:
- **Cameras:** the cheap phones your users have (front camera, 720p/1080p, 15 and 30 fps), a laptop webcam, one good camera.
- **Light:** daylight window, lamp-lit evening, dark room with only the screen, backlit, mixed colour light, flicker.
- **People:** many different people (skin tones, hair types and styles, glasses, caps/head wraps, beards, loose and patterned clothing), sitting, standing, close and far, leaving and re-entering frame.
- **Motion:** talking, waving, hands in front of the face, holding objects/phone/mug, leaning, turning, quick moves.
- **Rooms:** plain wall, busy shelves, doorways, plants, other people passing behind.
Rule of thumb (mine, not measured): 2 to 3 hours of well-varied raw video is a useful first run, 10+ hours is a good one. Tag the clips: `--tag lowlight`, `--tag hands`, `--tag phone`.
**Split by person and session, never by random frames** (frames from the same take are near-duplicates and make validation look better than it is):
`train/` (most), `val/` (people and rooms never in train), `gt/` (see 3).

## 2. Make teacher labels (GPU)
    python make_teacher_data.py --videos raw/train/*.mp4 --out clips/train --max-size 720 --segment 240 --tag phone
    python make_teacher_data.py --videos raw/val/*.mp4   --out clips/val
Needs ../studio-export set up (weights, `pip install mediapipe` for hand crops). `--tracker on` for single-person clips if you installed SAM 2.1. About 2x slower with TTA (`--no-tta` to skip).
Spot-check 20 clips by eye before training: bad labels teach bad habits. Delete clips where the teacher is wrong.

## 3. Build the independent ground-truth set (do not skip)
Students trained on teacher masks always look good against teacher masks. To know if the student is really better than RVM, you need masks the teacher did not decide:
take 20+ clips (600+ frames, spread over lowlight/hands/phone), export the teacher alpha, then have a person correct the wrong frames by hand (any mask editor), and put them in `gt/` in the same folder format.
Never train on `gt/`. A licensed public matting benchmark can add to it (check its terms first).

## 4. Train
    DATA=clips/train VAL=clips/val ./run_all.sh
Three stages (short low-res, longer sequences, browser-size fine-tune), resumable, writes `runs/genesis_student.onnx` + an fp16-weights copy. Free GPU sessions (Colab, Kaggle) disconnect:
rerun the same command and it continues. Run 200 steps first and time them: I have not timed this on a GPU (on a 2-core CPU, 4x4x96x128 took about 0.4 s/step), so I give no GPU-hour estimate.
Watch `runs/*/log.jsonl`: `val.edge_mad`, `val.flicker` should fall; if flicker rises while mad falls, raise the temporal weight in losses.py. Useful ablations: `--width 0.5` (phone tier), `--backbone small`, `--composite-p 0`, `--low-light-p 0.5`.

## 5. The gate: when may RVM go?
    python promote_gate.py --student runs/genesis_student.onnx --rvm ../../models/rvm_mobilenetv3_fp32.onnx --modnet ../../models/modnet.onnx \
        --gt-root clips/gt --size 288x512 --out gate_report.json
PROMOTE needs all of: >= 20 GT clips and 600 frames; mad, edge_mad, grad and flicker each <= 0.97 x RVM; beats RVM on >= 70% of clips; no tag (lowlight/hands/phone) worse than RVM; median latency <= RVM at the same size.
Defaults are deliberately strict; change them only with a reason. PROMOTE is necessary, not sufficient. Before deleting RVM also: blind test with real people on real recordings (blindtest.html, docs/BLIND_TEST.md),
and the phone runs S1/S5/S6 in docs/RESEARCH_2026-10.md (CPU timing here is a proxy). Then ship the student behind a flag for one release, keep RVM one more, remove it after.

## Browser contract (for the provider, not wired yet)
Same shape as RVM: inputs `src` [1,3,H,W] float 0..1 RGB (H, W multiples of 32), `r1i..r4i` (zeros [1,1,1,1] on frame one; reset when resolution changes), no `downsample_ratio`;
outputs `pha` [1,1,H,W], `r1o..r4o`. A `student-provider.js` mirroring `rvm-provider.js` is the next piece once there is a trained model to test it with.

## Licence notes (for the lawyer list)
- MobileNetV3 code: torchvision, BSD-3. `--pretrained` downloads ImageNet weights (their dataset terms are the usual research-weights question). Training from scratch avoids it, at a quality cost.
- BiRefNet (MIT) was itself trained on public matting datasets with their own terms (see MODEL_DECISION_v0_82.md): same caveat applies to labels it produces.
- Your footage: written permission from everyone in it, covering model training.
