# v0.83 — real model weights bundled (all-in-one, 3 parts)
Extract ZIP 1 (core) then ZIP 2 (matting weights) into the SAME folder. Remaining weights: run server/studio-export/fetch_models.sh (see SPLIT_PACKAGE_README.txt).
1. server/studio-export/weights/: BiRefNet-matting.pth, BiRefNet-portrait.pth, birefnet.onnx (general), matanyone2.pth (reference only), SHA256SUMS.
2. server/studio-export/vendor/: BiRefNet (MIT) and MatAnyone2 (S-Lab, non-commercial) source at pinned commits.
3. birefnet_runner.py: torch + matting weights is the default; ONNX only when asked for or torch is missing (the bundled ONNX is the general model, not the matting one).
4. fetch_models.sh: now only a re-download/verify tool.
5. Licence correction: SAM2Matting is CC-BY-NC-SA-4.0 (non-commercial); see docs/MODEL_DECISION_v0_82.md addendum.
Verified: 50/50 Python checks (20+22+8). Weight files: sizes match the GitHub release pages, .pth are valid torch zip archives, ONNX graph loads. NOT verified: any real model run (no GPU/RAM here). First real run: 5 s clip on a GPU, `python studio_export.py -i clip.webm -o out.mp4 --background scene.jpg --max-size 480`, then repeat with `--engine matanyone2` and compare the `flicker` numbers.
