# Prompt 2 report: "Enhance quality" export (30 Oct 2026)
Labels: VERIFIED = run/measured here. UNVERIFIED = needs a real phone.

## 1. Ground truth that changed the brief
- A saved recording is the **composited canvas only** (person already baked onto the background). It cannot be re-matted. (VERIFIED, app.js recorder)
- So Enhance needs the raw camera footage. New opt-in Studio toggle "Keep original for Enhance" records the untouched camera in a second MediaRecorder (default OFF: a second encoder costs power).

## 2. Model decision (measured, not guessed)
| Model | Licence (checked on the official repo) | Size | Result |
|---|---|---|---|
| MODNet at 512 px (offline) | Apache-2.0 | 25.9 MB, already in app | Works. Edge error 12.2 vs 18.1 for the live-style path (-33%), IoU ok. **Chosen.** |
| BiRefNet swin-tiny 1024 | MIT, https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE | 224 MB (sha256 5600024376f5...3333) | One 1024x1024 pass was **killed by the OS on a 4 GB machine** (onnxruntime CPU, even with memory-lean options). Not enabled. |
| BiRefNet general (full) | MIT | 973 MB | Not run (larger than the tiny that already failed). |
| BEN v2 base | MIT, https://github.com/PramaLLC/BEN2/blob/main/LICENSE | n/a | Not measured: ONNX is on Hugging Face, unreachable from the build sandbox. |
BiRefNet/BEN2 stay in the registry with `runner:null` and a plain reason; they are never offered. Revisit on a WebGPU desktop.

## 3. What was built
- `js/enhance-core.js` (pure, 12 unit tests): model registry, plan/frame math, **forward+backward motion-gated alpha filter** (non-causal, no ghost), error/flicker metrics, resume bookkeeping.
- `js/enhance.js`: ModelStore (download only on demand, progress, SHA-256 verify, Cache Storage, offline reuse, corrupt file rejected); Enhancer (seek raw clip, MODNet worker at 512 px, resumable via own IndexedDB `genesis-enhance`, cancel, re-use of the live compositor `createRenderCore` with the live look states, WebCodecs VP8 encode + `vendor/webm-muxer` (MIT) for exact timing, Opus audio re-encode); "Enhance quality" button on a recording row.
- `studio.html`, `sw.js` (cache v088), `app.js` (raw recorder, state hook), `grade-ui.js` (exposes last grade state). LICENSES.md updated.
- `tools/e2e/t42_enhance.js` + fixtures `raw_clip.webm`, `ref_enh_*.png`; wired into CI as gate C.

## 4. Numbers (VERIFIED, 1-CPU sandbox)
16 frames at 8 fps, 640x480: output 2.0 s, 640x480, audio kept (2.01 s), 3 frames vs reference MAD 0.7-1.2 (tolerance 8), 22.8 s total. Edge error vs ground truth 12.18 (Enhance) vs 18.07 (live-style 256 px + causal filter). Flicker 0.098 vs 0.107 (small on this nearly static clip). Cancel PASS, resume reused 5 frames PASS, corrupt download rejected PASS, 26 MB model downloaded with progress then reused offline PASS.

## 5. Limits
- Gain here comes from the bigger matting size + zero-phase filter, NOT a bigger model. "Visibly cleaner" is proven only on a synthetic clip with ground truth; on a real face (hair) it is UNVERIFIED.
- Output ignores live zoom/pan/aspect and overlays/graphics (full raw frame, source resolution). Video-only fallback if audio decode fails.
- Not tested on a real phone: memory, heat and time for a 1-minute clip (30 fps x 60 s = 1800 frames; plan caps at 1800 frames). Raw recording is held in memory like the main one: keep takes short on weak phones.
- WebM only (no MP4). Transparent export not built.

## 6. Exact next step
Record one real take on the Redmi with "Keep original for Enhance" on, press Enhance, note minutes taken and whether it finishes; send the output next to the live recording.
