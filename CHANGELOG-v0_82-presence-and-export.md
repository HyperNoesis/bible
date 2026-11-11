# v0.82 — model decision, clean export engine, "part of the scene" look
Apply on top of v0.79 + v0.80 + v0.81 (copy these files over the project, same paths). SW cache v109.
Read first: docs/MODEL_DECISION_v0_82.md (licences, what to build with, what to measure next).

## Changes
1. server/studio-export: new default engine `clean` = BiRefNet-matting per frame -> flow-guided temporal fusion (temporal.py, forward+backward) -> scene integration (scene_integrate.py). MatAnyone 2 stays as `--engine matanyone2`, reference only (non-commercial licence), fetched only with WITH_MATANYONE2=1. New: birefnet_runner.py (ONNX or torch), --look scene|plain, --harmonise/--wrap/--shadow/--grain, --no-temporal, --causal. The finished line prints flicker and flicker_before_fusion.
2. Scene look (export): foreground colour estimation (blur-fusion), colour-CAST match (not average-chroma: that washed faces out in testing), light wrap from the scene's own colours, cast shadow away from the brighter side, grain match.
3. js/providers/realism-engine.js: BUG FIX. The old drawLightWrap tinted the whole frame (measured: far background 234,187,109 -> 206,165,100; 22,28,49 -> 49,48,55; person centre 106 -> 138). Rewritten: thin inner band only, coloured from the scene itself (snapshot taken before the person is drawn), screened on. Quarter-resolution layers, so cheaper than the old full-frame blur. Skipped in FAST mode as before. Plus a directional silhouette shadow on the plain-environment path.
4. js/render-core.js: drawShadow gets personCanvas; premium-studio path now calls drawLightWrap with sceneEngine.personRect() so the wrap lines up with the placed presenter. Both follow the existing Light wrap / Contact shadow toggles.
5. LICENSES.md: BiRefNet, BEN2 (base only), SAM 3 text, MatAnyone 2 status, dataset caveat.

## Verified (sandbox: 2 CPUs, 8 GB, headless Chromium, numpy/OpenCV)
- test_pipeline_logic 20/20, test_scene_logic 22/22, test_export_e2e 8/8 (video in -> alpha -> fusion -> scene look -> video out, STAND-IN matte model).
- Browser: light wrap measured before/after on a bright-left/dark-right scene (see item 3). 40/40 node unit suites, t40 (composite MAD 1 vs reference), t18, t19 pass on the merged v0.79+v0.80+v0.82 tree; t14_m4: 32 pass, 2 fail (scene wizard shows != 12 cards; a 328x42 'Hold to see BEFORE' button at 360px). The first fails identically on the unpatched tree (baseline run was cut short before the second); neither touches code changed here, but the 42px button was not confirmed pre-existing.
- Scene look checked by eye on one public-domain portrait with a crude GrabCut matte (not shipped).
## NOT verified
- BiRefNet / MatAnyone 2 on real weights (BiRefNet 1024 px was OOM-killed on 8 GB). First real run: 5 s clip, --max-size 480, send the console.
- Any real room, real phone, real person. Whether `clean` matches MatAnyone 2 on your footage (run both and compare flicker).
- The light wrap strength on real scenes (0.9 x intensity) is a first guess; tune with the Realism intensity slider.
