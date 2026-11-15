# v0.92 — Segmentation hardening and export safety

## Implemented

- **RVM recurrent-frame ordering:** serialised worker `init`, `run`, `reset`, and `dispose` commands through one queue. This prevents overlapping ONNX calls from reading/writing the recurrent tensors out of order.
- **RVM protocol validation:** validates dimensions, total pixel budget, exact RGBA buffer length, model input/output names, matte shape, and non-finite alpha values. Unsupported messages fail with a readable worker error.
- **Temporal discontinuity reset:** the live RVM provider resets recurrent memory after a capture gap longer than 1.2 seconds. Explicit `reset()` also clears the local gap timer.
- **RVM resolution experiments:** default remains the previous 168-pixel internal analysis edge. Local opt-in profiles of 224, 256, and 320 pixels are available through `localStorage.setItem('vs_rvm_analysis_edge', '224')` (or `256` / `320`) followed by a reload. These are test profiles, not automatic defaults; target-device FPS and quality must be compared before selecting one.
- **Export max-size correction:** `read_frames()` now applies `max_size` to the longest edge, not the shorter edge. Landscape and portrait clips therefore retain the intended scale and aspect ratio. Dimensions remain even for video encoding.
- **BiRefNet runner hardening:** validates RGB frame shape and inference-size bounds, gives actionable missing-code/weights errors, rejects malformed model outputs, and sanitises NaN/infinite/out-of-range alpha values.
- **Regression tests:** added a mocked RVM worker protocol test and export safety tests. Added the export safety suite to the Python CI workflow.
- **Malformed recurrent outputs:** validate all four recurrent-state tensors before committing them; a malformed output cannot poison the next frame's temporal state.
- **Odd export limits:** round positive `max_size` down to an even bound before aspect-ratio scaling, so the encoded output never exceeds an odd requested limit.
- **Actual bundled-model smoke benchmark:** ran the shipped RVM and MODNet ONNX graphs using bundled ORT-Web/WASM in Node on a 12-frame stylised synthetic clip. RVM 168px measured 85.7ms median / 0.9926 mean IoU; higher RVM profiles were slower. Full profile results and model hashes are stored in `tools/e2e/model_onnx_fixture_bench_results.json`.
- **Deployment identity:** bumped the shell cache to `genesis-shell-v121` and diagnostics build label to v0.92.

## Not claimed complete

- RVM/MODNet ONNX model inference ran in Node/WASM on the synthetic fixture; browser camera/model integration remains unverified.
- No physical Android timing, heat, memory, battery, or long-session test was performed.
- No real-person consented validation set with hand-labelled alpha mattes was available.
- BiRefNet/MatAnyone export weights and the BiRefNet vendor implementation remain absent from the supplied archive. The live RVM/MODNet models are present; export model inference remains blocked until its separately distributed dependencies are restored and verified.
- WebGL2 matte-edge quality gate could not be run here because Playwright/WebGL2 were unavailable.

Synthetic/unit verification is not a substitute for these end-to-end checks.

## Shader tuning sweep (15 Nov 2026, WebGL2 gate run in a sandbox with software GL)
Swept sigmaR, colourSnap, radius, edgeLo/edgeHi and despill with `MATTE_PARAMS` against all six Gate F scenes (mean alphaMAE over both mask sizes).
Baseline 0.1661. Best combination (radius 2 + sigmaR 0.08) 0.1624, i.e. under 3% better, and radius 2 costs more GPU time. colourSnap 0.5 is worse on `hard` (0.028 -> 0.054). Weak scenes do not move: lowc 0.345 -> 0.341, dark 0.340 -> 0.330, motion 0.204 -> 0.202.
Conclusion (VERIFIED on synthetic scenes only): the edge shader is not the lever for low-contrast, dark or lagging-mask cases; no defaults were changed. The remaining error comes from the mask itself, so improvement needs a better live mask model (distilled from BiRefNet on real consented footage), not more shader tuning.
