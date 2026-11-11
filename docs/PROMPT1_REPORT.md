# Prompt 1 report: live pipeline + automated gates (30 Oct 2026)
Labels: VERIFIED = run/measured here. INFERRED = read from code. UNVERIFIED = needs the Redmi 14C.

## 1. Ground truth (what really runs)
- Default live engine = MediaPipe Selfie (legacy, vendored). MODNet was OPT-IN (`vs_try_modnet=1`), so the brief's "MODNet live" was not what shipped. (VERIFIED, app.js)
- MODNet runs in a background worker, WASM, **1 thread** (worker forces `numThreads=1`; the page is not cross-origin isolated). Input = camera frame scaled to a multiple of 32 on a 320 long edge (balanced), ladder 320 -> 256. (INFERRED from modnet-provider/worker)
- Engine start: MediaPipe first, then `backgroundUpgrade` benchmarks MODNet; it goes live only if <= 70 ms/mask. (VERIFIED, t33 run)
- Temporal smoothing (motion-gated, at mask size), joint-bilateral upsample to the full-res frame (this IS the edge-guided refine; not a literal guided filter), spill decontamination: `providers/gl-matte.js`. Colour match, soft contact shadow, depth cues: `realism-engine.js` / `scene-engine.js`. (INFERRED; not changed)
- Watchdog: step-down ladder 320 -> 256 -> MediaPipe -> lean. It had NO step-back-up. (VERIFIED)
- Doc/code mismatches: NEXT.md lists "guided-filter edge refine" as TODO (a bilateral equivalent exists); docs assumed MODNet live.
- No CI tests existed; `android.yml` built and released the APK with no test gate.

## 2. What changed (file by file)
- `js/app.js`: MODNet background upgrade now ON by default (opt out: `vs_try_modnet=0`); step-up counters wired into `runLadder`.
- `js/providers/perf-profile.js`: `decideLadderStepUp` (256 -> 320 only, >= 27 fps for 30 s, never while recording/live, max 2 ups per session so it cannot flap).
- `tools/e2e/unit_ladder.js`: +8 cases (20 PASS). `tools/e2e/pwlib.js`, `t33_ladder_smoke.js`: legacy tests keep the old default explicitly.
- NEW `tools/e2e/mkclip.py`, `fixtures/webcam_clip.mjpeg` (0.7 MB), `gt_alpha_640x480.png`, `ref_composite.png`, `gate_thresholds.json`.
- NEW `t40_pipeline_gate.js` (gate A: fake camera, full pipeline: FPS, flicker, reference frame, blank/frozen). NEW `t41_modnet_gate.js` (gate B: real MODNet worker: IoU, mask flicker, main thread free).
- NEW `.github/workflows/tests.yml`; `android.yml` now has `apk: needs: tests`, so no APK/Release unless all gates pass.
- `sw.js`: cache bumped.

## 3. Numbers (VERIFIED, sandbox: 1 CPU, software GL; NOT a phone)
- Gate A: 1.3-1.7 fps (software GL; liveness floor set at 1.0), flicker p95 MAD 0.62-0.65, flicker pixels 1.0%, reference frame MAD 0.2. Negative test: an impossible FPS threshold makes it exit 1.
- Gate B: MODNet IoU 0.97-0.99 vs ground truth, mask flicker 1.2-1.3/255, main-thread worst gap 226-265 ms, 737-1212 ms per mask on this 1-CPU box.
- 33/33 unit suites pass. t33 (default-on upgrade path) PASS: bench said "too slow" here, stayed on MediaPipe, as designed.

## 4. Limits (read these)
- The clip is SYNTHETIC (drawn person, noise, 1-2 px sway). No real consented webcam clip exists in the repo; drop one in as `fixtures/webcam_clip.mjpeg` and run `UPDATE_REF=1`.
- Thresholds prove "did not regress", not "looks premium" and not phone FPS. Tighten `minFps` after the first real CI run.
- CI itself was not run here (no GitHub access): the workflow is YAML-valid and each step ran locally.
- Real-device (Firebase/BrowserStack) job NOT added: not covered. Redmi 14C: nothing measured. Default-on MODNet is UNVERIFIED on a phone; the bench + ladder are the safety net.
- Flicker is measured on the composite, not the alpha channel.

## 5. Exact next step
Push the branch, read the first CI run (`gate-report` artifact), tighten thresholds, then do the Step-zero measurement on the Redmi (diagnostics line + 10 s screen recording).
