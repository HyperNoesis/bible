GENESIS v0.83 — FULL INTEGRATED PACKAGE (2 zips)
ZIP 1 "CORE": the complete app (v0.79+v0.80+v0.81+v0.82), docs, tools, server code, vendored BiRefNet + MatAnyone2 code, fetch_models.sh, SHA256SUMS.
ZIP 2 "MATTING": the BiRefNet matting weights (the default export engine). Extract into the SAME folder as ZIP 1.
Other weights (portrait, general ONNX, MatAnyone 2 reference) were too big to deliver reliably as downloads. They come from GitHub with one command on your GPU machine:
   cd server/studio-export && ./fetch_models.sh      (resumes, then verifies SHA256SUMS)
Read first: docs/MODEL_DECISION_v0_82.md (addendum at the bottom), CHANGELOG-v0_83-models-bundled.md
