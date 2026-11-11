# Matting model decision (v0.82) — what to build with, what to leave, and why
Written 10 Nov 2026 for John. Engineering summary, NOT legal advice. Every claim is tagged VERIFIED (read on the source page this session), REPORTED (said by a secondary page or by the model's own authors, not independently checked) or UNVERIFIED.

## The short answer
1. **Build with BiRefNet (MIT) + temporal fusion + scene integration.** This is `studio_export.py --engine clean` (new, default). Nothing in it carries a non-commercial term, so it can sit in the paid product.
2. **Use MatAnyone 2 as a measuring stick, not as a part.** Run both engines on the same clip and compare. If `clean` gets close, you never need the licence. If it does not, ask the authors for a commercial licence (draft below). A route exists: Beeble states it runs MatAnyone under "a direct license agreement" ([beeble.ai](https://beeble.ai/models/matanyone)).
3. **The live tier's real exposure is RVM, which is already in the shipped app (GPL-3.0).** Replace it with a small student model you train yourself from BiRefNet outputs (plan below). MODNet (Apache-2.0) stays as the clean fallback.

"We will make it commercial" cannot be done by us. The licence belongs to NTU S-Lab, and only they can change it for you. What we can control is which weights ship, so the build is arranged to keep the best-looking result *and* stay sellable. This is also the version of the product that survives a customer's or investor's due diligence.

## Model by model
| Model | Licence | Fit for Genesis | Evidence |
|---|---|---|---|
| **BiRefNet** (matting, portrait, general, lite 44.4M params) | MIT (VERIFIED on the [lite](https://huggingface.co/ZhengPeng7/BiRefNet_lite) and [matting](https://huggingface.co/ZhengPeng7/BiRefNet-matting/blob/main/README.md) cards) | Best edges of the clean options. **Offline/export: yes. Live in a browser: no.** One community WebGPU build reports about 3.4 s per frame at 1024 and 0.85 s at 512 ([card](https://huggingface.co/jiabins0303/birefnet-lite-1024-webgpu)), REPORTED, single device | HR-matting ONNX works at 2048 px but is 450 MB fp16 ([card](https://huggingface.co/PinkPixel/birefnet-hr-matting-onnx)) |
| **MatAnyone 2** | NTU S-Lab, non-commercial (your own LICENSES.md and your note; the project page and the HF mirror do not state a licence, VERIFIED absence) | Strongest published temporal matting; **cannot ship**. CVPR 2026 Highlight; training set VMReal (28K clips) "soon" | [project page](https://pq-yang.github.io/projects/MatAnyone2) |
| **SAM2Matting** (Jun 2026) | Not stated in the paper | Promising: frozen SAM 2.1-Tiny tracker + trained matting heads, about 40 FPS on an A6000, and it beats MatAnyone 2 on temporal stability (dtSSD) on V-HIM60 and on the paper's tables. Authors' own numbers, REPORTED. **Check the repo licence before anything else** | [paper](https://arxiv.org/html/2606.27339v1) |
| **SAM 2.1** | Apache-2.0 (HF metadata, VERIFIED on the [tiny-hf card](https://huggingface.co/facebook/sam2-hiera-tiny-hf/blob/main/README.md)) | A clean tracker for stable masks. Not a matter of licence, of how heavy it is on a phone | |
| **SAM 3 / 3.1** | Meta "SAM License". **Your note said "too restricted"; the text I read does not limit it to non-commercial use** (royalty-free licence), but adds ITAR/military bans, ship-the-licence-with-copies, termination if you sue Meta, and indemnity ([text](https://huggingface.co/facebook/sam3/blob/main/LICENSE)). VERIFIED text, read by me, not by a lawyer | Heavy (about 9 FPS on an A6000 inside SAM2Matting). Fine as an offline helper; not live | |
| **EdgeTAM** | Not verified | 16 FPS on iPhone 15 Pro Max, reported by its authors ([docs](https://huggingface.co/docs/transformers/model_doc/edgetam_video)). Worth a licence check as a live tracker | |
| **BEN2** | **Base model MIT; the full/commercial BEN2 is sold** (sales contact on the [model card](https://huggingface.co/PramaLLC/BEN2/raw/main/README.md), VERIFIED) | Your "MIT per one article" holds for Base only. Not used | |
| **RVM** | GPL-3.0 (your LICENSES.md) | Good temporal behaviour, and **already in your live Auto tier**. Shipping GPL code and weights to browsers brings source-offer obligations. Replace, do not extend | |
| **PP-MattingV2, Bria** | Apache-2.0 / CC-BY-NC (your notes, not re-checked) | You measured PP-MattingV2 slower with no better edges. Bria needs a deal: skip | |
| **VideoMaMa** | Not stated | Built on Stable Video Diffusion; heavy; reported far better than MatAnyone on hard clips ([paper](https://arxiv.org/pdf/2601.14255)). Research reference only | |
| **MODNet** | Apache-2.0 | The clean live fallback you already ship; weak on hands, flickers | |

**One honest caveat that applies to the "clean" list too:** BiRefNet-matting was trained on public research matting datasets (P3M-10k, AM-2k, AIM-500, HIM2K, PPM-100, TR-humans and others, VERIFIED on its card). An MIT label on weights does not settle those datasets' own terms (some are research-only). MODNet has the same question. Put it on the lawyer's list before you charge money; it is a smaller and more common risk than shipping weights that are explicitly non-commercial.

## What was built (all in this patch)
**Export server** (`server/studio-export/`): `temporal.py` (optical-flow fusion, forward + backward), `scene_integrate.py` (see below), `birefnet_runner.py` (ONNX or torch), engine switch in `studio_export.py`, MatAnyone 2 now opt-in (`WITH_MATANYONE2=1`).
**Browser** (`realism-engine.js`, `render-core.js`): light wrap rewritten and added to the premium-studio path; directional silhouette shadow on the plain path.
**A bug found and fixed:** the old Light wrap painted a translucent tint over the *whole frame*, not the silhouette. Measured in Chromium on a bright-left / dark-right scene: far-left background 234,187,109 → 206,165,100 and far-right 22,28,49 → 49,48,55 (contrast washed), and the person's centre 106 → 138. After the rewrite the same three points are unchanged and only the edge band moves (left edge +19/+15/+9, right edge +11/+8/+7).

## "Make the person part of the scene": the six cues and what handles each
| Cue a viewer reads as "pasted on" | What now handles it | Where |
|---|---|---|
| Fringe from the real room (green/white halo) | Blur-fusion foreground colour estimation | export |
| Lit by a different light | Colour-cast match (copies the room's cast, not its average, because averaging washed faces out in testing), capped | export |
| No light from the scene on the edges | Light wrap: the scene's own colours on a thin inner band, different on each side | export + browser |
| No shadow in the scene | Cast shadow pushed away from the scene's brighter side (weaker in even light so it never reads as a halo) | export + browser (plain path; premium path already had one) |
| Person grainier than the picture | Scene gets the camera's measured noise | export |
| Edge shimmer | Flow-guided temporal fusion; a hand that suddenly appears is kept (tested) | export |

Still **not** done and worth doing next: occlusion by scene props for the export (browser already has depth occlusion), real relighting of the face from a new direction (needs a model; none with a clean licence was found fast enough), hands (see below).

## How to get from here to "better than MatAnyone 2" without its licence
1. **Measure first.** On a GPU box run both engines on 3 of your own clips and compare the `flicker` and `flicker_before_fusion` numbers printed on the last line, then look at hair and fingers by eye. This single step tells you how much is left to gain.
2. **Hands.** MediaPipe Hands (Apache-2.0) is already in the app. Next patch: run BiRefNet on a tight crop around each detected hand at higher resolution and union the alphas, in the export first.
3. **Live student (replaces RVM).** Teacher = BiRefNet-matting + the fusion above on your own recordings (with the people's permission) and on licensed or synthetic data. Student = a MODNet-sized network with a temporal-consistency loss, exported to ONNX. You own the weights. Needs a GPU for a few days; I cannot run it here.
4. **Optional.** If SAM2Matting's licence turns out to be permissive, it is the strongest candidate to replace step 3's teacher.

## Draft message to the MatAnyone 2 authors (only if step 1 shows you need it)
> Subject: Commercial licence enquiry for MatAnyone 2
> Hello, I am building Genesis (a browser-based virtual studio for streamers, brand: Rejuvini). MatAnyone 2 gives the temporal stability we want for recorded-clip export. The released licence is non-commercial. Could you tell me whether NTU S-Lab offers a commercial licence for the code and weights, and on what terms? Use: server-side re-rendering of a user's own recorded clip, no redistribution of the weights. Thank you, John (usendaniel2011@gmail.com)

## What I could NOT verify
- BiRefNet on real weights: the 8 GB sandbox killed the process at 1024 px (CPU ONNX, memory options tried). Run on a GPU first and send me the console.
- GitHub pages (MatAnyone 2 repo, LICENSE file) were not reachable from the research tool; licence statements come from your files and the pages cited.
- Nothing here has been looked at on a real room recording or on a phone.

---
## Addendum v0.83 (10 Nov 2026): models now bundled, and one correction
- **Bundled, pulled from GitHub, sizes match the release pages exactly:** BiRefNet-matting (.pth, 885 MB), BiRefNet-portrait (.pth, 885 MB), BiRefNet general (.onnx, 973 MB; loads in onnxruntime, input 1x3x1024x1024), MatAnyone 2 (.pth, 141 MB, REFERENCE ONLY). Code at pinned commits in `server/studio-export/vendor/`. SHA256 in `weights/SHA256SUMS`.
- **No downgrade path by default:** `--engine clean` uses the BiRefNet **matting** weights at 1024 px through torch (fp16 on CUDA). The general ONNX is used only if you pass `--birefnet-onnx` or torch is not installed.
- **CORRECTION, SAM2Matting is NOT a licence-clean option.** Its Hugging Face card and demo Space both state CC-BY-NC-SA-4.0 (non-commercial). The "licence not found" line above is superseded: it is a measuring stick like MatAnyone 2, not a part. Its checkpoints (about 4 GB) sit on Hugging Face, which this build environment could not reach, so they are not bundled or wired.
- **Not run:** this sandbox had 1 CPU, 3 GB RAM and no GPU, so no real model has been executed here. Only file integrity (size, zip structure, ONNX graph loads) and the 50 Python checks were verified.
