# Genesis Studio v0.92 — Segmentation Engineering Report

**Base:** supplied v0.91 complete source package  
**Date:** 15 November 2026  
**Status:** engineering hardening and synthetic model-runtime validation completed; real-camera, real-person, Android and model-backed export certification remain open.

## Phase 1 — Live segmentation pipeline

- Serialised RVM worker `init`, `run`, `reset` and `dispose` commands through one promise queue. Recurrent RVM frames therefore consume the prior frame's state in order even when messages arrive before an earlier inference finishes.
- Added frame dimension and pixel-budget checks, exact RGBA-buffer length validation, model input/output-name checks, matte shape checks, finite alpha conversion and recurrent-state tensor validation.
- Recurrent output state is committed only after the full matte and all four recurrent tensors pass validation. A malformed model response is rejected without poisoning the next frame's recurrent inputs.
- The live RVM provider resets recurrent memory after a capture pause longer than 1.2 seconds; dimension changes also reset the worker state.
- The app's existing frame-pairing path snapshots the foreground video at the same loop tick in which segmentation is requested and records mask/person frame skew through `VS.pairStats()`. This source-level path was preserved; its real-camera skew distribution still needs device measurement.

**Regression evidence:** mocked RVM worker protocol 10/10; RVM provider profile and capture-gap tests 15/15.

## Phase 2 — Cutout quality, hair and resolution

- Preserved the v0.91 mask-cleaner correction: 8-connectivity plus narrow/elongated nearby component preservation. The synthetic regression retains all 935/935 marked wisps and 467/467 soft-fringe pixels while still removing the nearby square speck and distant noise line.
- Executed the actual shipped RVM and MODNet ONNX models using the project's bundled ONNX Runtime Web/WASM files in Node.js. The 12-frame fixture is a stylised synthetic subject with supplied ground-truth alpha, not real human footage.

### Bundled ONNX runtime fixture benchmark

| Model/profile | Median model+cleanup time | p95 | Mean IoU | Mask flicker (0–255) |
|---|---:|---:|---:|---:|
| RVM 168px | 85.7 ms | 126.0 ms | 0.9926 | 0.112 |
| RVM 224px | 138.4 ms | 148.3 ms | 0.9922 | 0.091 |
| RVM 256px | 165.2 ms | 170.3 ms | 0.9918 | 0.090 |
| RVM 320px | 254.7 ms | 263.3 ms | 0.9915 | 0.093 |
| MODNet 448×352 | 848.0 ms | 869.3 ms | 0.9918 | 0.077 |

RVM's 168px setting was both the fastest tested RVM profile and the best mean-IoU profile on this particular fixture. Higher profiles modestly reduced the fixture's frame-to-frame mask difference, but did not improve IoU and cost substantially more time. The default therefore remains 168px; no higher-resolution default is justified by these data.

The timings are one-thread Node/WASM measurements, not browser, Android, GPU or thermal measurements. The synthetic scene is easy and stylised; its IoU must not be interpreted as a real-person quality score. The benchmark and exact model SHA-256 hashes are saved in `tools/e2e/model_onnx_fixture_bench.py` and `tools/e2e/model_onnx_fixture_bench_results.json`.

**Still required:** consented real hair/hand/low-light/motion clips with labelled alpha, natural backgrounds and representative skin/background colour combinations.

## Phase 3 — Matte edges and compositing

- Kept the existing GL guided-upsample and edge-colour correction pipeline rather than changing shader constants without a working WebGL2 gate.
- Hardened BiRefNet export alpha validation: checks input RGB shape and inference-size bounds, output structure, finite values and probability range. Explicitly requested missing ONNX weights now fail immediately with an actionable path-specific error.
- Export matte handling's synthetic NaN/range validation passes. This does not validate shader quality or prove real hair/fringe improvement.

**Still required:** run `tools/e2e/t49_matte_edge_gate.js` in a browser with WebGL2, then compare raw/cleaned/final alpha edges on real hair, fingers, soft fabrics, fast motion, low light and similar-colour backgrounds. No shader tuning was made because the gate could not run here.

## Phase 4 — Model and runtime architecture

- Added local opt-in RVM internal analysis profiles 168/224/256/320 while keeping the baseline at 168px. Set `localStorage.setItem('vs_rvm_analysis_edge', '224')` (or 256/320) before reload for controlled testing; clear the key to return to baseline.
- The synthetic ONNX fixture evidence supports the existing 168px default. MODNet was especially slow in this one-thread Node/WASM benchmark; this should inform testing, not be generalized to all devices.
- RVM remains on WASM. No WebGPU route was enabled for its recurrent graph without a verified browser implementation and parity tests.
- No new paid dependency, paid API, hosted GPU or new model download was introduced.

## Phase 5 — Recorded-video export

- Fixed `max_size` so it constrains the longest video edge (portrait and landscape) instead of the shorter edge. The requested positive limit is rounded down to an even value before scaling, ensuring video dimensions never exceed an odd `max_size` request after even-dimension rounding.
- Added decoder-path resize tests, invalid-dimension tests and explicit missing-model-path diagnostics.
- The BiRefNet runner sanitises non-finite or out-of-range outputs and rejects malformed RGB input and invalid matte tensors.
- Existing export logic/scene tests and stand-in video-to-video E2E pass. **Real BiRefNet export remains blocked:** this source package does not contain the BiRefNet vendor implementation or model weights. Stand-in E2E is not a substitute for a real model run.

## Phase 6 — Validation, safety and production readiness

- Added regression tests for worker ordering, recurrent-state integrity, long-pause resets, export limits, malformed matte results, and model-output sanitation.
- Updated CI to run export-safety tests and bumped the service-worker shell cache to `genesis-shell-v121`; diagnostics now identify v0.92.
- Source and static-site build checks pass. The available environment does not provide a runnable Playwright+WebGL2 path or a physical Android device.
- RVM is GPL-3.0 according to the supplied licence inventory. Review redistribution obligations, and audit all models/datasets before any commercial release. Privacy review and consented test-data handling remain release requirements.

## Test evidence

| Test | Result | Scope |
|---|---:|---|
| JavaScript unit suites | 44/44 pass | Project `unit_*.js` regressions |
| RVM worker protocol | 10/10 pass | Mocked serial execution, recurrent state, malformed outputs, reset and disposal |
| RVM provider tests | 15/15 pass | Input sizes, profiles and >1.2s capture-gap reset |
| Export safety | 11/11 pass | Long-edge/even sizing, decoder resize, missing weights, output validation |
| Export pipeline logic | 20 pass | Export helper logic |
| Export scene/temporal logic | 22 pass | Synthetic compositing and temporal checks |
| Stand-in export E2E | 8 pass | Video export route with stand-in matte model |
| GPU export API | 32 pass | Auth/job/API lifecycle, not actual GPU inference |
| ONNX WASM fixture benchmark | RVM 4 profiles + MODNet | Actual bundled live model graphs; synthetic 12-frame fixture only |
| JavaScript syntax / Python compile | Pass | Project JS/Python syntax |
| `npm run www` | Pass | Static deployment build |

The exact console output is reproducible using the commands in `GENESIS_SEGMENTATION_TEST_REPORT.md` and `python tools/e2e/model_onnx_fixture_bench.py`.

## What must still happen before “segmentation complete”

1. Browser-run RVM/MODNet inference: camera input, output masks, frame pairing, rendering and recovery on the supported browsers.
2. WebGL2 matte-edge gate with working Playwright/browser, followed by comparison on consented real-person footage.
3. Physical Android profile testing at 168/224/256/320, measuring FPS, inference latency, frame skew, memory, battery and thermal stability over extended sessions.
4. Build a representative consented human validation set and measure alpha error, boundary accuracy, hair recall, hand/finger separation, temporal flicker and background leakage.
5. Restore the separately distributed BiRefNet vendor code and weights; verify checksums and run actual real-model export, audio preservation and long-clip memory tests.
6. Verify camera restart/background/resume, orientation changes, device/browser fallbacks, privacy behaviour and model licences.

**Verdict:** v0.92 materially strengthens live recurrent execution and export safety, retains the proven hair-cleanup correction, and verifies the bundled live ONNX graphs on a synthetic fixture. It is not yet a real-person quality-certified segmentation system, and its recorded-video BiRefNet export is not model-complete.
