# >>> v0.82 (10 Nov 2026): READ docs/MODEL_DECISION_v0_82.md + CHANGELOG-v0_82-presence-and-export.md <<<
Owner asked to use the best matting models "and forget licences". Decision taken: the PRODUCT path uses only models that can be sold (BiRefNet MIT + own temporal fusion + own scene integration). MatAnyone 2 (S-Lab, non-commercial) is reference-only in server/studio-export (`--engine matanyone2`, opt-in download); a commercial licence has to come from the authors (Beeble has one). RVM (GPL-3.0) is still in the live Auto tier from v0.61: next job is a student model trained from BiRefNet to replace it. Found+fixed: old Light wrap tinted the whole frame. NOT run: BiRefNet/MatAnyone on real weights (OOM on 8 GB), anything on a real room or phone. Tests: server/studio-export/test_*.py (no GPU needed).

v0.62: models are fp16-weight packs (same names; originals in BIG_FILES_ORIGINAL.sha256; see CHANGELOG-v0_62-lean-models.md). FULL zip ships all binaries, no restore step. New real-photo gate t45 (photos are NON-COMMERCIAL, never ship them). Gates now demand IoU >= 0.98. Still unmeasured: real phones, hand-made-matte accuracy.

# >>> v0.60 (Oct 30 2026): READ docs/PROMPT1_REPORT.md + docs/PROMPT2_REPORT.md <<<
CI gates exist (tools/e2e/t40/t41/t42, workflow tests.yml, APK needs tests). Run locally: python3 tools/e2e/mkfx.py; node tools/e2e/unit_*.js; PW_LIB=<playwright path> node tools/e2e/t40_pipeline_gate.js (t41, t42 likewise). UPDATE_REF=1 rewrites reference frames. Enhance = js/enhance*.js (needs raw footage: Studio toggle). Nothing measured on a phone yet. Never claim a phone result without the Redmi numbers.

# >>> READ FIRST: v0.55 PREMIUM UI PASS — STATUS (written mid-task so a new AI does NOT restart) <<<
Brief: "Genesis Studio Premium UI/UX Upgrade Prompt" (PDF). Owner John/Usen: FREE plan, be fast, keep working features, honest VERIFIED/INFERRED/UNVERIFIED reporting.
DESIGN SYSTEM = css/premium.css (loaded AFTER css/style.css on every page; overrides tokens). Roles: ember(coral)=make/Record/primary, indigo=selection/nav/focus, lagoon=live, orchid=generated. Serif-italic <em class="serif"> = one accent word per headline. DO NOT repaint or rewrite; extend premium.css only. Legacy generic `button:not(...)` rule in style.css is high-specificity: use `!important` guards at the bottom of premium.css when a button looks wrong.
DONE + screenshot-verified (headless Chromium 1360x860 and 390x800, local http.server, sign up via local auth): shell/sidebar/mobile tabbar+More sheet (js/nav.js), Home stage hero (home.html), Studio chrome (rail labels/icons, preview frame, dock), Environments (search, catalogue cards), Auth, Projects, Settings.
DONE v0.55 package: genesis-v0_55-premium-ui.zip. See CHANGELOG-v0_55-premium-ui.md.
PASS 4 DONE (v0.58, cache v085): self-hosted Space Grotesk (assets/fonts, OFL), contrast fixed (text-faint >=5:1, skip-link), landing redesigned with icons/steps/honest-limits cards, cam/remote restyled, spacing tokens, hidden-attr fix. Automated contrast audit on all pages = 0 failures. PASS 3 DONE too (v0.57, cache v084, see CHANGELOG). PASS 2 DONE in v0.56 (sw cache v083). Verified by screenshot incl. fake-camera recording. Left: cam.html/remote.html utility pages unstyled, real-phone test, tests.html (sandbox cannot run), before/after screenshots not made:
 [x] Editor / Audio / Call: distinct page hierarchy + screenshot check (never looked at them after the change)
 [x] Loading/locked/unavailable states (.env-card.is-loading CSS exists but is unused); level/mode selectors (.seg-btn) review
 [x] Icon audit (stray emoji / mismatched icons across pages)
 [x] landing.html + reset-password/cam/remote pages: link premium.css or restyle
 [x] Recording + live states seen on screen with a fake camera (chromium --use-fake-device-for-media-stream)
 [x] Toasts/dialogs check; before/after screenshots
 [ ] Bump sw.js SHELL_CACHE (now v082) if any cached file changes again; rezip as genesis-v0_56-...; update CHANGELOG with VERIFIED/INFERRED/UNVERIFIED
Test notes: tests.html cannot run in the sandbox (needs vendor/mediapipe + network, not in lite zip). Screenshot script pattern: playwright, http://localhost:8123, sign up at auth.html (#tabSignUp,#suName,#suEmail,#suPassword) then visit pages. Google Fonts requests fail in sandbox (harmless).
NEVER touch: camera/segmentation/render/recording/auth/storage logic, DOM ids, URLs.

---
# SHORT NOTE FOR THE NEXT AI (v0.24). Read this, then HANDOFF_FOR_NEXT_AI.md, NEXT.md, docs/PRESENCE_PLAN.md.
Owner John: free Claude plan, tokens scarce: be FAST, honest, no long explanations. Always diff his zips against yours (other tools edit them).
DONE (M4 code complete): 12 premium scenes (first in picker; 12 procedural kept under the wizard's 'Classic' chip), depth maps for all, depth of field + layered parallax, depth-based desk detector, depth occlusion (ON for podcast + exec-office only), statistical colour match, wall colour tool (wizard step 4), effects speed test (Diagnostics), importer (tools/scenes/import_scene.js), desk labeller.
VERIFIED only with a SYNTHETIC presenter in headless Chromium. Tests: unit_* + t16/t17/t18/t19 pass. t14_m4 was still running when I stopped: its last full run before the final edits passed 24 checks, no failures seen; re-run it in the background (nohup, poll the log; takes ~5 min).
NOT DONE / needs John: real-person check of all 12 scenes on his phone, Redmi 'Test effects speed' report, blind test (blindtest.html, 10+ viewers), generator licence (Grok Imagine terms unrecorded), 30 labelled real desk photos (extend tools/e2e/eval_desk.js to the depth detector).
NEXT CODE: verify/enable occlusion on the other 10 scenes; test wall colour + colour match on every scene; better stage scene (prompt in docs/PHOTOREAL_SCENES.md); retire Classic scenes only after the real-person check.
FACTS: only GitHub/npm/pypi reachable (models via GitHub release assets, pip onnxruntime works); models/modnet.onnx is NOT in the zip (30 MiB upload cap): John must drop the separately sent file into models/. Desk lines for premium scenes are hand estimates. After adding any file: update studio.html + sw.js SHELL_ASSETS and bump SHELL_CACHE (now v052).


## v0.61 (RVM live tier) - what changed and what is NOT proven
- Auto now tries RVM MobileNetV3 first (js/providers/rvm-lite-provider.js, rvm-worker.js, models/rvm_mobilenetv3_fp32.onnx, WASM only), then MODNet, then stays on MediaPipe. Same <=70 ms/mask gate and 320/256 ladder for both. vs_live_engine = auto | rvm | modnet | light. Bench record is v3 (rvmMs / modnetMs).
- Measured here (1 CPU, same stack): RVM 448x336 about 167-180 ms/mask in the browser worker vs MODNet 448 about 1257 ms; IoU 0.991 vs 0.975 and mask flicker 0.51 vs 1.03 on the SYNTHETIC clip. Real-face quality and real-phone speed are still UNMEASURED.
- RVM is GPL-3.0 (LICENSES.md). Owner decided to ship it.
- t43_rvm_gate.js warms the video->canvas readback first: the software-GL first readback alone stalls the main thread about 2 s here (not the model).
- t41 (MODNet) main-thread gap is 412 ms vs 400 limit on this sandbox; untouched by this change.

## v0.61 part 2 (threads + report) - done
- _headers adds COOP same-origin + COEP credentialless on /*. MODNetWorkerProvider.threadsFor(): >1 thread only if crossOriginIsolated && SharedArrayBuffer, min(4, cores-1); localStorage vs_threads=1 forces 1. _boot() retries with 1 thread if a multi-thread start errors (unit_thread_boot.js). Label shows "WASM xN". t44_threads_gate.js (CI Gate E) proves isolation + 3-thread RVM and MODNet masks are correct; it cannot prove speed-up (1-core box).
- diagnostics.js: new "LIVE MATTING:" line (engine setting, isolation, threads, saved speed test, banner text). build string v0.61.
- Regression after refactor: 36 unit suites, t40, t41, t42, t43, t44 all PASS here.
- NOT built: native Android (Capacitor) LiteRT GPU plugin. Android SDK/Gradle/Maven are not reachable from the sandbox (network allowlist), so it cannot be compiled or tested. HF card numbers: MODNet 512 on Pixel 8a CPU 4 threads ~419 ms vs GPU ~60-79 ms.
