# Genesis Studio v0.92 deployment notes

1. Build from the project root with `npm run www`.
2. Deploy the contents of the generated `www/` directory to the existing static host. Preserve the generated directory structure, especially `models/`, `vendor/ort/`, `vendor/mediapipe/`, `js/` and `sw.js`.
3. The service-worker shell cache is `genesis-shell-v121`. Reload the installed client after deployment so it refreshes the worker/provider changes.
4. Use the existing diagnostics panel (`#diag` or the app's diagnostics gesture) to record engine, browser, device, frame rate, inference timing and mask/person pairing skew.
5. The experimental RVM analysis edge remains 168px by default. For controlled testing only, set `localStorage.setItem('vs_rvm_analysis_edge', '224')` (or `256` / `320`) and reload. Clear the key to restore the default. Do not change the production default based only on the synthetic Node benchmark.

## Release limitations

- v0.92 is an engineering hardening build, not real-person quality certification.
- The supplied package includes live RVM/MODNet models and their inference runtime, but the available verification was Node/WASM on a synthetic fixture. Browser camera and physical Android validation remain required.
- The WebGL2 matte-edge gate could not run in this environment.
- The separate BiRefNet export vendor implementation and weights are absent; current export E2E uses a stand-in matte and must not be described as real BiRefNet export.
- Review GPL-3.0 RVM obligations and all model/dataset licences before commercial distribution.
