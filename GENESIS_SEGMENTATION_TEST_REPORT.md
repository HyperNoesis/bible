# Genesis Studio — Segmentation Test Report

**Engineering snapshot:** v0.92  
**Date:** 15 November 2026

## Test summary

| Test group | Result | Scope |
|---|---:|---|
| JavaScript unit suites | 44/44 pass | All project `tools/e2e/unit_*.js` suites |
| RVM worker protocol | 10/10 pass | Mocked inference order, state handoff/reset, malformed recurrent outputs, buffer validation, disposal |
| RVM provider | 15/15 pass | Input sizing, analysis profiles, capture-pause reset ordering |
| Export safety | 11/11 pass | Portrait/landscape and odd limits, decoder path, model-output sanitation, missing path |
| Export pipeline logic | 20 pass | `test_pipeline_logic.py` |
| Export scene/temporal logic | 22 pass | `test_scene_logic.py` |
| Export stand-in E2E | 8 pass | `test_export_e2e.py`; uses a stand-in matte model |
| GPU export API | 32 pass | API/auth/job lifecycle, not GPU model inference |
| Actual bundled live ONNX models | Pass | RVM four profiles + MODNet, using bundled ORT-Web/WASM in Node on 12 synthetic frames |
| JavaScript syntax / Python compile | Pass | Project JS and Python files |
| Static site build | Pass | `npm run www` |

## Actual live-model fixture benchmark

The bundled `rvm_mobilenetv3_fp32.onnx` and `modnet.onnx` files were executed using the project's bundled ONNX Runtime Web/WASM runtime in Node.js. Masks were passed through the project's `MaskClean` cleaner and compared against the fixture's supplied ground-truth alpha mask.

| Model/profile | Median | p95 | Mean IoU | Mask flicker (0–255) |
|---|---:|---:|---:|---:|
| RVM 168px | 85.7 ms | 126.0 ms | 0.9926 | 0.112 |
| RVM 224px | 138.4 ms | 148.3 ms | 0.9922 | 0.091 |
| RVM 256px | 165.2 ms | 170.3 ms | 0.9918 | 0.090 |
| RVM 320px | 254.7 ms | 263.3 ms | 0.9915 | 0.093 |
| MODNet 448×352 | 848.0 ms | 869.3 ms | 0.9918 | 0.077 |

This is actual ONNX graph inference, but only on a stylised synthetic 12-frame subject. It is not real-person accuracy, browser camera integration, or Android performance. See `tools/e2e/model_onnx_fixture_bench_results.json` for model hashes and complete measurements.

## Focused hair-cleanup regression

- 935/935 marked high-confidence wisps retained.
- 467/467 tracked soft-fringe pixels retained.
- Nearby square speck removed.
- Distant thin noise line removed.
- Small enclosed-hole behaviour preserved.

These are deterministic synthetic cleaner tests. They do not prove natural hair capture by the model.

## Commands executed

```bash
# JavaScript unit suites
for f in tools/e2e/unit_*.js; do node "$f" || exit 1; done

# Focused protocol and provider checks
node tools/e2e/unit_rvm_worker_protocol.js
node tools/e2e/unit_rvm_lite.js

# Python tests
python server/studio-export/test_pipeline_logic.py
python server/studio-export/test_scene_logic.py
python server/studio-export/test_export_safety.py
python server/studio-export/test_export_e2e.py
python -m unittest gpu.test_export_api -v

# Actual bundled ONNX model fixture
python tools/e2e/model_onnx_fixture_bench.py

# Syntax and site build
find js tools/e2e -name '*.js' -print0 | xargs -0 -n1 node --check
python -m compileall -q server/studio-export gpu
npm run www
```

## Blocked / not run

- Browser model/camera integration and in-browser frame-mask pairing measurement.
- `tools/e2e/t49_matte_edge_gate.js`: Playwright/WebGL2 unavailable in this environment.
- Consent-based natural human footage and hand-labelled ground-truth alpha set.
- Physical Android performance, thermal, battery, memory and long-session stability.
- Real BiRefNet export inference: the supplied source package lacks its vendor folder and model weights; current export E2E uses a stand-in matte.
- Licence/privacy review for commercial release.

## Interpretation

The current build has passed code-level and synthetic fixture validation, including execution of the real bundled live ONNX models. It has not been quality-certified on people or real cameras. Do not mark segmentation production-complete until the blocked tests above pass on supported browsers and target Android devices, and the export model dependencies are restored and verified.
