# v0.80 — segmentation: stop dropping good models, keep the fallback person-shaped
Apply on top of v0.79 (copy these files over the project, same paths). SW cache v108.

## Root cause found in code (not a guess about your laptop)
The step-down ladder compared the OUTPUT frame rate with a fixed 18 fps. A webcam in a normal room often delivers 10-15 fps (auto exposure),
so the ladder blamed the model for the camera and walked down: RVM -> smaller -> MediaPipe light model (the blob in your recording).
## Changes
1. perf-profile.js: camera-aware ladder. Steps down only when the model is the bottleneck (output well below camera rate AND a mask takes about
   a camera frame). Waits 8 s. Never leaves matting for the light model unless even the smallest size needs >= 150 ms per mask.
2. app.js: ladder uses the camera rate; model time budget is camera-relative; WebGPU gets 8 warm-up frames; only a clearly slow (1.4x) speed verdict
   is remembered; the "your device is slow" banner is skipped when the camera is the limit; decision log VS.segLog.
3. roi-track.js + modnet-provider.js: person crop. MODNet looks at a tight crop of the person at the SAME pixel cost. Off for RVM. Kill switch: localStorage vs_roi=0.
4. seg-diagnostics.js: rows "Camera delivers" and "Why the engine changed" (with the numbers).
## Verified (sandbox)
unit tests 40/40 (new: unit_roi 18, unit_ladder_cam 17); real Chromium + real MODNet: t48_roi_gate, t35, t32, t41, t46, t33 pass.
Offline (MODNet, equal cost): edge error vs the model's best 0.235->0.190 (person 60% of frame), 0.471->0.305 (40%); no gain when you fill the frame.
## NOT verified
Your camera, your laptop's GPU, any phone. Whether the camera rate was really your cause: the new log will say. Licence: RVM is GPL-3.0 (see LICENSES.md).
