# Third-party models and licences (engineering summary, NOT legal advice)

Have a lawyer confirm before you charge money. Status below comes from the
projects' own repos/model cards as found in research on 30 Sep 2026.

| Component | Licence | OK for a paid product? |
|---|---|---|
| MODNet (portrait matting model, default quality tier) | Apache-2.0 | Yes, with attribution and the licence text if you redistribute the file |
| MediaPipe Selfie Segmentation (self-hosted in vendor/mediapipe/selfie, light tier) | Apache-2.0 (package @mediapipe/selfie_segmentation) | Yes, with attribution and the licence text. Keep the Apache-2.0 text with the app |
| MediaPipe Hands + Face Mesh (self-hosted in vendor/mediapipe/hands and vendor/mediapipe/face_mesh) | Apache-2.0 (packages @mediapipe/hands 0.4.1675469240, @mediapipe/face_mesh 0.4.1633559619) | Yes, with attribution and the licence text |
| RNNoise noise suppression (js/worklets/rnnoise-worklet.js, built from jitsi/rnnoise-wasm commit cb529a59, core xiph/rnnoise) | jitsi/rnnoise-wasm Apache-2.0 (vendor/rnnoise/LICENSE-...); rnnoise core BSD-3-Clause (xiph, verify text before redistribution) | Yes, with attribution |
| Robust Video Matting (RVM) | GPL-3.0 | Risky. From v0.61 the RVM live tier (js/providers/rvm-lite-provider.js + rvm-worker.js + models/rvm_mobilenetv3_fp32.onnx) runs in Auto mode by the OWNER'S DECISION. To remove it without a rebuild set localStorage vs_live_engine to "modnet"; to remove it from a build delete those three files and the two script/SW entries. Get counsel's read before charging money |
| MatAnyone / MatAnyone 2 | S-Lab licence, non-commercial | No, unless you get written permission from the authors. NOT included in the app. v0.82: only reachable in server/studio-export as `--engine matanyone2` (fetch with WITH_MATANYONE2=1), labelled reference/benchmark only. Beeble (beeble.ai) states it runs MatAnyone under a direct licence agreement, so a commercial licence from the authors exists as a route. Do not use its output in a paid service without that |
| onnxruntime-web | Not checked in this research | Verify before launch |
| AI-generated scene images (Pollinations.ai "Create World") | Not checked | Read their terms for commercial use of generated images before you sell scenes |

## Why this matters
As of v0.61 Auto tries RVM (live tier, GPL-3.0) first, then MODNet (Apache-2.0), then
MediaPipe, each only if this phone runs it within the speed budget. The owner chose
to ship RVM; the licence risk above still stands. Older manual option: js/providers/rvm-provider.js.

## Attribution to ship with the app
- MODNet: Zhanghan Ke et al., "MODNet: Real-Time Trimap-Free Portrait Matting via
  Objective Decomposition", AAAI 2022. Apache-2.0.
- MediaPipe: Google. Apache-2.0.
- Robust Video Matting: Shanchuan Lin et al., "Robust High-Resolution Video Matting with Temporal Guidance", WACV 2022. GPL-3.0.

## MODNet weights (models/modnet.onnx)
modnet_webcam.onnx from https://github.com/yakhyo/modnet/releases/tag/weights (sha256 de03cc16f3c91f25b7c2f0b42ea1a8d34f40a752234f3887572655e744e55306, 25,969,398 bytes). Ported from ZHKKKe/MODNet; code and weights Apache-2.0 per the yakhyo README. Optional engine, fetched only when MODNet is chosen.

## Depth maps (assets/environments/*-depth.png)
Generated with Depth Anything V2 Small (Apache-2.0), ONNX from fabio-sim/Depth-Anything-ONNX v2.0.0 (sha256 d2b11a11c1d4a12b47608fa65a17ee9a4c605b55ee1730c8e3b526304f2562be). Re-check the weights licence before changing to Base/Large (non-commercial).
- Depth Anything V2 Small (offline tool only, Apache-2.0): used to bake scene depth maps; not shipped to phones.

## onnxruntime-web 1.25.1 (vendor/ort/)
Microsoft onnxruntime-web, MIT licence (npm package onnxruntime-web@1.25.1). Shipped inside the app so the matting engine works offline. Files: ort.min.js, ort.webgpu.min.js, ort-wasm-simd-threaded(.jsep).wasm, and the two helper modules renamed from .mjs to .js (same content; Android WebViews may not know the .mjs MIME type). Loaded by js/ort-loader.js, CDN only as fallback.
## MODNet weights now ship in models/modnet.onnx
Same file and sha256 as above (modnet_webcam.onnx, Apache-2.0), committed so the APK always has it.


## Space Grotesk (self-hosted, v0.58)
assets/fonts/SpaceGrotesk-Variable.woff2, from github.com/floriankarsten/space-grotesk. SIL Open Font License 1.1 (assets/fonts/OFL-SpaceGrotesk.txt). Replaces the Google Fonts request.

## Added 30 Oct 2026 (Prompt 1 + 2)
- webm-muxer 5.1.0 (Vanilagy), MIT: vendor/webm-muxer/ (licence file kept). Used by Enhance export.
- BiRefNet (ZhengPeng7), MIT: https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE. Registry entry only; NOT shipped, NOT enabled.
- BEN2 (PramaLLC), MIT: https://github.com/PramaLLC/BEN2/blob/main/LICENSE. Registry entry only; NOT shipped, NOT enabled.


## Model files are modified copies (v0.62)
models/modnet.onnx (Apache-2.0) and models/rvm_mobilenetv3_fp32.onnx (GPL-3.0) are the upstream models with their weights re-stored as float16 (tools/model-pack/pack_fp16.py). Mark them as modified when you redistribute; originals' hashes are in BIG_FILES_ORIGINAL.sha256.


## Added v0.82 (Studio Export clean engine)
- BiRefNet (ZhengPeng7) code + BiRefNet-matting / portrait weights: MIT per the repo and model cards (checked 10 Nov 2026). Used ONLY by server/studio-export (not shipped to browsers). CAVEAT for counsel: the matting weights were trained on public research matting datasets (P3M-10k, AM-2k, AIM-500, HIM2K, PPM-100, TR-humans...). Their dataset terms can be research-only; an MIT label on the weights does not settle that. Same question applies to MODNet and every other research model. Ask before charging money.
- temporal.py (OpenCV DIS optical flow, Apache-2.0 / BSD) and scene_integrate.py (numpy, scipy, OpenCV; blur-fusion foreground estimation per Forte & Pitie 2021, re-implemented, not copied): original code, no model weights.
- onnxruntime (optional, MIT) for the ONNX route.
- BEN2: only the BASE model is MIT; the full/commercial BEN2 is sold by Prama (sales contact on its model card). Registry entry only, not used.
- SAM 3 (SAM License, 2025): the text grants a royalty-free licence not limited to non-commercial use, but adds conditions (no ITAR / military / weapons uses, ship the licence with redistributions, termination if you sue Meta, indemnity). Not used. Counsel should read it before any use.

| SAM2Matting | CC-BY-NC-SA-4.0 (HF card + demo Space) | No. Non-commercial research only. NOT included, not wired. Reference reading only |
| BiRefNet weights bundled in server/studio-export/weights (v0.83) | MIT code; weights MIT per model cards; trained on public research matting datasets, put those on the lawyer's list | Yes for the code/weights label; dataset terms unresolved |
| MatAnyone 2 weights bundled in server/studio-export/weights (v0.83) | S-Lab non-commercial | **Reference/benchmark only. Delete weights/matanyone2.pth and vendor/MatAnyone2 from any commercial deployment** |

## Deployment notes (v0.83)
- **Public repo:** everything committed here is public if the repo is public. No keys are committed (`js/config.js` ships blank; scan done 10 Nov 2026). Never put real secrets in `js/config.js`: every visitor can read it.
- **GPU image:** `modal-deploy.yml` builds an image that contains BiRefNet (MIT) and, unless `GENESIS_INCLUDE_REFERENCE=0`, MatAnyone 2 (non-commercial). The reference engine is refused by the API unless `ALLOW_REFERENCE=1`.
- **Website models:** `models/rvm_mobilenetv3_fp32.onnx` is RVM (GPL-3.0) and is served publicly with the site. Replace it before commercial use.
