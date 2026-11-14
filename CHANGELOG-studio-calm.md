# Studio calm: one message at a time on the preview (no app version bump: v0.89 is on another branch)

## Problem (seen in a real run of studio.html with a camera)
After Start Camera the preview stacked, on top of each other: status chips (Light Good, Mic Too loud, Camera 20 fps), a mic warning bubble, the big "Loading the cutout engine..."
message, the orange "your device is working hard" banner, and a half-hidden footer hint. Five modules wrote to the preview with no knowledge of each other.

## Change (presentation only; no message text and no app logic changed)
1. js/stage-calm.js (new): decides which ONE message is visible. Priority: critical error > loading > performance notice > mic/light advice.
   - performance notice tucks itself away after ~8 s (the "Reduced quality" pill stays as the record). The app's own 'show' class is never removed.
   - advice only shows once it has been the same for ~2.5 s (a mic peak flicker is not advice), for ~7 s, and not again within 90 s.
   - critical errors (crash, camera feed lost, cutout could not start) are never hidden and never time out.
   - off switch: localStorage vs_calm = '0'.
2. css/genesis-system.css: "Studio calm" block. Only chips that need attention are visible (the Good/Measuring ones are hidden); the footer hint steps aside while a message shows.
3. js/app.js: one class name (stage-loading) on the existing loading overlay so it can be recognised. studio.html loads the script. sw.js precaches it; shell cache v114 -> v116
   (v115 is taken by the v0.89 branch: if both merge, resolve that one line to the higher number).
4. tools/e2e/t50_stage_calm_gate.js: Part A drives the coordinator with a fake clock (15 checks: priority, auto-dismiss, debounce, repeat, chips, hint). Part B runs the real studio
   with a fake camera and samples 40 times over 30 s: never more than one message, no Good chips, no page errors.

## Verified (sandbox, headless Chromium, fake camera)
t50 ALL PASS (15 + 4); all 41 unit_*.js pass; Gate A (t40) passes; site build ships js/stage-calm.js and lists it in the service worker.
## NOT verified
A real phone or a real person. The sandbox renders in software and cannot download the cutout engine, so it sits in "loading" and shows the performance banner far more than a normal device would.
Not changed (say so if you want these done next): the top-right pills (Performance / Reduced quality), the "Camera 20 fps" chip, and the many hint paragraphs in the right-hand panels.
