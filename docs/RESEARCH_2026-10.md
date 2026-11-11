# Research decisions, Oct 2026 (from John's research summary)
Labels: VERIFIED = read/run; INFERRED = reasoned; UNVERIFIED = needs a phone test.

## Matting: no sellable top-tier video model exists (INFERRED from licence pages)
RVM GPL-3.0 (do not ship), MatAnyone 2 non-commercial, SAM 3.1 too heavy, EdgeTAM hard masks only.
Stack = MODNet (Apache-2.0) + own temporal/plate work; MediaPipe = low tier; Background Matting V2 (MIT) = laptop tier (phone export UNVERIFIED).
Edge refine: fast guided filter (NOT built yet: needs a GPU test). Light: software only, no diffusion relight. Depth: baked Depth Anything V2 Small.
Next ideas: MediaPipe face + gestures, RNNoise (in repo), optional local Whisper captions, WebCodecs then native RTMP for go-live.

## Positioning
Phone-first, cheap-phone tiers, direct go-live, naira/local payments, data-light/offline.
Version 1 = recording + sharing. Go-live = 1.5 after the native RTMP test passes (assumed unless John says otherwise).

## Pass/fail experiments (all need John's phones)
S1 24 fps for 10 min (Redmi 14C) | S2 LiteRT.js vs ORT, need >=25% faster | S3 WebCodecs to native RTMP 5 min 720p
S4 camera fps lights on/off | S5 weak phone fallback (Tecno/itel, Android 11) | S6 iPhone iOS 26 | S7 licence emails (MatAnyone 2, RVM)

## Built so far (v0.50, Phase 6 start)
PerfProfile.decideLadderStep / startRung: pure step-down ladder modnet-320 -> 256 -> MediaPipe -> lean effects. Never changes engine while recording/live. tools/e2e/unit_ladder.js PASS.
Wired in js/app.js runLadder() (called first in checkGracefulDegrade). Browser/phone behaviour UNVERIFIED: watch the note under the preview for 'matting now runs smaller' and the MediaPipe swap.
NOT built (blocked in sandbox: Google/Hugging Face hosts): gesture + face models, Whisper weights.

## Models pulled (v0.51, Oct 29 2026)
- Reachable from the sandbox: GitHub + npm + PyPI only. Hugging Face and Google storage are BLOCKED, so the .task bundles are not available.
- Pulled from npm and vendored: @mediapipe/hands (lite model, SIMD wasm) -> vendor/mediapipe/hands (13 MB); @mediapipe/face_mesh (landmark model is inside the packed .data) -> vendor/mediapipe/face_mesh (11 MB). Apache-2.0. SHA-256 list: vendor/mediapipe/MODELS.sha256. SIMD-only: a WebView without WASM SIMD (very old) will fail to load them (UNVERIFIED on Tecno/itel).
- Gestures: the legacy Hands solution has no gesture head, so js/hand-gesture-core.js classifies from landmarks by rules (open palm, fist, thumbs up, peace, point). Tested on synthetic hands only (unit_gesture PASS). js/providers/hands-provider.js loads Hands locally; NOT wired into the UI and NOT run in a browser.
- Face Mesh is vendored but has NO provider yet (framing/teleprompter placement not built).
- Whisper NOT bundled: the only GitHub copy found (k2-fsa/sherpa-onnx release asr-models, sherpa-onnx-whisper-tiny.en) is 118 MB (int8 encoder 13 MB + int8 decoder 90 MB). Too big for a data-light APK. Needs a smaller source or on-demand download; and a decoding loop on ORT-web is not written.
