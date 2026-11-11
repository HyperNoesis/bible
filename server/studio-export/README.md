# Studio Export (v0.82)
Best-quality person matting for a recorded clip, made to look like the person is **in** the scene. Runs on a GPU machine (your own box, Colab, Kaggle, a rented GPU), not in the browser or on a phone.

Default engine (`--engine clean`, every part is MIT / Apache / BSD, safe to sell):
BiRefNet-matting alpha on every frame -> optical-flow temporal fusion (forward + backward, `temporal.py`) -> scene integration (`scene_integrate.py`: foreground colour estimation, colour-cast match, light wrap from the scene, cast shadow, grain match) -> video.

Reference engine (`--engine matanyone2`): the v0.81 pipeline, kept so you can **measure** the clean engine against it (compare the flicker numbers on the same clip). MatAnyone 2 is under the NTU S-Lab non-commercial licence: do not use its output in a paid service without written permission. See docs/MODEL_DECISION_v0_82.md.

## Run
```
pip install -r requirements.txt
# v0.83: weights/ and vendor/ are already bundled. ./fetch_models.sh only re-downloads or verifies them.
python test_pipeline_logic.py; python test_scene_logic.py; python test_export_e2e.py   # no GPU, no weights
python studio_export.py -i clip.webm -o out.mp4 --background scene.jpg
python studio_export.py -i clip.webm -o alpha.mp4 --out-mode alpha        # grey alpha video
python studio_export.py -i clip.webm -o out.mp4 --background scene.jpg --look plain   # old straight blend
python studio_export.py -i clip.webm -o out.mp4 --background scene.jpg --engine matanyone2   # reference only
```
Progress is printed as JSON lines. The finished line has the clip's flicker score (lower = steadier).

## Use it from Genesis
`server/render-worker.js` runs any command on a clip:
```
RENDER_CMD='python studio_export.py -i {in} -o {out} --background /path/scene.jpg' WORKER_TOKEN=... node server/render-worker.js
```
then set `renderRelayUrl` in js/config.js as described in docs/LIVE_RELAY_SETUP.md. The recording is only sent when the person taps the re-render button (existing confirm step).

## Status (v0.82)
- VERIFIED here: test_pipeline_logic.py (20), test_scene_logic.py (22: foreground estimation, light wrap direction, shadow direction, noise estimate, harmonise cap, temporal fusion cuts flicker and keeps a newly appearing hand), test_export_e2e.py (video in -> alpha -> fusion -> scene look -> video out, with a STAND-IN matte model).
- NOT RUN: BiRefNet / MatAnyone 2 on real weights. The sandbox has 8 GB RAM; BiRefNet at 1024 px was killed by the OOM killer on CPU (ONNX general, memory options tried). Run on a GPU box first with a 5 s clip and `--max-size 480`, then send me the console output (the finished line prints `flicker_before_fusion` and `flicker`).
- NOT MEASURED: how close `clean` gets to MatAnyone 2 on your footage. Run both engines on the same clip and compare `flicker`; look at hands and hair by eye.
- Scene look was checked by eye on one real public-domain portrait with a crude stand-in matte; real-room footage is still unseen.
- Memory: use `--max-size 720` for clips over a minute on a 16 GB GPU.

## v0.83
Bundled: BiRefNet matting + portrait (.pth), BiRefNet general (.onnx), MatAnyone 2 (reference only, non-commercial). Default = matting weights through torch at 1024 px. No real-model run has been done yet (see CHANGELOG-v0_83-models-bundled.md).
