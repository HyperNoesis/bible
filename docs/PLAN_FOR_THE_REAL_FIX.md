# Plan for the real fix: "people think I am really in the background" (written Oct 29 2026)
Written so John is never stuck if the free plan ends. Any AI can pick this up: give it the lite zip, this file and NEXT.md.
Labels: VERIFIED = run/measured, INFERRED = reasoned, UNVERIFIED = needs John's phone.

## 0. The honest core
- Goal (John's words): pick a background, stay in front of it, and have viewers believe he is really there. Smooth FPS, clean hair/shoulder edges, matching light, no flicker.
- Two months of fixes have been BLIND: the sandbox has no phone, no GPU, no browser. Every "fix" is a guess until measured on the Redmi 14C. This, not effort, is why it keeps not working.
- A bigger model (even 1 GB) does NOT fix FPS: a heavier model runs slower on a phone. Quality comes from (1) a clean background plate, (2) temporal stability, (3) good edges, (4) matched light, (5) a fast enough runtime. Model size is the smallest lever. (INFERRED)

## 1. Step zero: measure (blocks everything else)
Open Studio on the Redmi 14C, run 60 s, and send: the diagnostics line (`seg X | bitmaps | render wait | frame total | loop period | inference % | stride | quality | out | video`) plus a 10 s screen recording while moving your arms and head.
Decision from that line: if `seg` is the big number -> runtime/model problem (go to 3A). If `render wait` or `bitmaps` is big -> compositing/copy problem (go to 3B). If `video` native fps is ~10 in a lit room -> camera problem (go to 3C). Without this line, do not change the pipeline.

## 2. Three ways to get "perfect", honest trade-offs
1. NATIVE (best FPS, phone): move segmentation out of the WebView into the Android wrapper (CameraX + TFLite/MediaPipe with the GPU delegate), keep the web compositor/UI. Likely the biggest FPS gain on a Helio G81/Mali phone because WebView WASM/WebGPU is the slow part. INFERRED, UNVERIFIED. Cost: a Capacitor plugin in Kotlin, new APK build, real phone testing each step.
2. PLATE-FIRST (best look for a person who stays in one place): capture the empty room once, then matte against it (Background Matting V2 style, MIT; the app already has plateStrength + auto plate). Cheapest big quality gain for fixed-camera users. Needs a phone-ready model export (UNVERIFIED).
3. PC/CLOUD GPU (best quality, any model size): run RVM or MatAnyone 2 (the 1 GB class) on a PC with a GPU or a rented GPU, send to the call through a virtual camera (OBS). GPL / non-commercial licences are fine for John's OWN personal use; they block SELLING it. Needs a PC with an NVIDIA GPU or a paid server; not phone-only.
Recommendation: do step 1, then 2 (plate-first) in the web app, then 1 (native) if the numbers say runtime is the limit. Offer 3 to John now if he needs perfect video on calls this week, because it does not depend on phone speed.

## 3. Implementation order after the measurement
A. Runtime limited (seg ms high): try fixed 256 input + region-of-interest crop + GPU-resident tensors (S1), LiteRT.js vs ORT (S2), then native (option 1). The v0.50 step-down ladder already protects weak phones (UNVERIFIED on a phone).
B. Compositing limited (bitmaps/render wait high): cut copies per frame, run the matte and composite in one GL pass, avoid readbacks, keep output size at 720p for weak tiers.
C. Camera limited (native fps ~10): turn on the light (S4); Smart light and exposure assist already exist; ask the camera for 30 fps with exposure priority.
D. Look: plate-first matte, edge refine (guided filter; GPU test needed), despill, light/colour match to the scene, soft contact shadow, depth blur from baked scene depth.
E. Presence: the person should not drift or pop: keep the v0.53 Fit me in frame, temporal smoothing, and never swap engines while recording.

## 4. Built so far (see NEXT.md for the exact list)
v0.50 step-down ladder; v0.51 hand/face models vendored; v0.52 hand gestures for slides; v0.53 Fit me in frame; v0.54 Smart light (tone curve). All pass node tests; NONE verified on a phone.

## 5. If the free plan ends: how to carry on with any AI
1. Give it beggining-lite-*.zip, this file and NEXT.md. Chat takes ~30 MB: the lite zip omits models/modnet.onnx and vendor/ort/*.wasm; `sh scripts/restore-big-files.sh` fetches them from GitHub and checks hashes.
2. Tell it: "Follow docs/PLAN_FOR_THE_REAL_FIX.md and the DIRECTIVES in NEXT.md. Measure first."
3. Push to GitHub main to get an APK from the Actions workflow (Releases: android-build-N).
4. Do the step-zero measurement yourself and paste the diagnostics line; it is the single most useful piece of information.
5. Never trust "fast" or "perfect" in any answer unless it cites a number measured on your phone.
