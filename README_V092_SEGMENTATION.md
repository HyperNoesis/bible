# Genesis Studio v0.92 segmentation update

This build continues the supplied v0.91 source and includes the earlier fine-hair-wisp cleanup fix. The v0.92 work hardens the recurrent live RVM worker, adds capture-pause reset protection, validates recurrent outputs before committing state, introduces safe opt-in RVM resolution profiles, corrects recorded-export size limits, and hardens BiRefNet runner input/output handling.

The bundled RVM and MODNet ONNX graphs were executed through the project's ONNX Runtime Web/WASM distribution in Node.js on a 12-frame stylised synthetic fixture. The RVM 168px profile was fastest and had the best mean IoU on that fixture; this is not real-person or Android certification.

**Do not describe segmentation as production-complete yet.** Browser camera/WebGL2 tests, natural human footage with labelled alpha, physical Android timing/thermal tests, and real BiRefNet export inference remain outstanding. BiRefNet vendor code and weights are not present in the supplied package.

Start with:

- `GENESIS_SEGMENTATION_V0_92_REPORT.md` — work by phase and remaining blockers.
- `GENESIS_SEGMENTATION_TEST_REPORT.md` — commands, test outcomes and limitations.
- `GENESIS_SEGMENTATION_ROOT_CAUSE_REPORT.md` — confirmed hair-cleanup defect and analysis.
- `GENESIS_V0_92_DEPLOYMENT.md` — build/deployment notes.
- `CHANGELOG-v0_92-segmentation-hardening.md` — implementation changes.
- `tools/e2e/model_onnx_fixture_bench_results.json` — exact synthetic ONNX benchmark data/model hashes.

Build the website with `npm run www`; deploy the contents of `www/`.
