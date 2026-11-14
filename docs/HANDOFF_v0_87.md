# Genesis v0.87 handoff note (13 Nov 2026)

## Where everything is
- Live site: https://hypernoesis.github.io/bible/  (GitHub Pages, deployed by .github/workflows/pages.yml on every push to main)
- Repo: github.com/HyperNoesis/bible. `main` = the whole project. `models` branch = the four heavy models in 90 MB parts (BiRefNet matting, BiRefNet portrait, BiRefNet general ONNX, MatAnyone 2 reference). Restore with `sh restore.sh` on that branch.

## What was fixed in this stretch
1. Slow cutout on phones (v0.84): GitHub Pages cannot send COOP/COEP headers, so the browser was single-threaded. sw.js now adds them (cross-origin isolation). The site build also now ships the four files sw.js precaches (without them the service worker never installed).
2. Slideshow trap (v0.85/0.86): the speed policy never stepped down at 0 fps or while recording. It now drops straight to the light model when one mask takes over 0.7 s for 2 seconds, remembers the verdict for a week, and resets a saved "MODNet" dropdown choice to Auto.
3. Black stage on slow data (v0.87): the GitHub build skipped scripts/vendor-tasks.js, so the cutout engine (about 19 MB of wasm) was downloaded from a CDN on every cold start. build-site.sh now bundles it into the site. The first visit still downloads it once; after that it is cached.

## Known problems, not fixed
- Live cutout on a mid-range phone (Mali-G52, 4 GB) is about 6 updates per second with blocky edges and a pale-green edge fringe. The best models cannot run on that phone.
- GPU Studio Export (BiRefNet matting, flicker removal, scene lighting) is built (gpu/, 32 API checks, real adapter test) but NOT deployed: it needs a Modal account. Steps: docs/DEPLOY_FROM_PHONE.md section 2.
- Browser test "Gate C" (Enhance export) fails on GitHub Actions; reason unknown (logs unreachable from my sandbox). It blocks only the Android APK workflow.
- RVM (models/rvm_mobilenetv3_fp32.onnx) is GPL-3.0: replace before charging users. MatAnyone 2 is non-commercial: reference only, off by default.
- Not verified on a real device: the v0.87 start-up fix. Not verified anywhere: Modal image build, GitHub workflows for Modal, the bundled selfie model (the sandbox cannot reach Google's model server; GitHub's build can).

## Security housekeeping
Three GitHub tokens and no Modal token were pasted in chat. Delete all GitHub tokens (Settings, Developer settings). Never paste a token into js/config.js: visitors can read it.

## Next steps, in order
1. Open the site on the phone, wait for the first load, reopen: the stage should show the scene within seconds. Send Diagnostics.
2. Create a Modal token and deploy Studio Export; then set renderRelayUrl, renderRelayToken and renderRelayLabel in js/config.js.
3. Find why Gate C fails (open the red run in the Actions tab, copy the last 15 lines of the Gate C step).
4. Smooth the jagged edges and the green fringe; replace RVM.

## Update v0.88 (13 Nov 2026)
- Gate C root cause found and fixed: the v0.80 person-crop returns masks of varying size, which broke the offline Enhance export (edge error 100 vs 18, NaN flicker, resume reusing 1 frame). js/enhance.js now sets `seg.useRoi = false`. Bisected: v0.79 passes 13/13, v0.80 fails 3, fixed build passes 13/13 locally.
- The stage now shows "Loading the cutout engine..." with elapsed seconds and a slow-connection hint instead of a black rectangle.
