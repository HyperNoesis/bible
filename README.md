# Genesis Studio

Browser virtual studio (cutout, scenes, broadcast tools) plus an optional GPU service for clean, flicker-free exports. This repository is the single source of truth: pushing to `main` redeploys the website and, if configured, the GPU service.

## What is where
| Path | What |
|---|---|
| `index.html`, `js/`, `css/`, `assets/`, `models/`, `vendor/`, `sw.js`, `manifest.json`, `_headers` | The website (a static PWA). `sh scripts/build-site.sh` puts the deployable copy in `www/`. |
| `gpu/` | **Studio Export on Modal** (serverless GPU, scales to zero): `modal_app.py`, `export_api.py`, tests, Colab benchmark notebook. |
| `server/studio-export/` | The export engine (BiRefNet matting, optical-flow temporal fusion, scene integration) and its tests. `fetch_models.sh` downloads the models from GitHub. |
| `server/` (other) | Signaling server, render relay and worker (older, optional). |
| `.github/workflows/` | `pages.yml` website, `modal-deploy.yml` GPU service, `python-tests.yml` export tests, `tests.yml` browser gates, `android.yml` APK. |
| `docs/` | Architecture, handoffs, licences, **`DEPLOY_FROM_PHONE.md`** (start here to deploy). |
| `android/`, `supabase/`, `tools/`, `scripts/` | Android wrapper, optional accounts backend, test tools, build scripts. |

## Deploy in three steps (all doable from a phone browser)
1. **Website:** repo Settings, Pages, Source = GitHub Actions. Push to `main` and it publishes at `https://<owner>.github.io/<repo>/`.
2. **GPU service:** add three Actions secrets (`MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `GENESIS_EXPORT_TOKEN`) and run the "Deploy GPU export (Modal)" workflow.
3. **Connect them:** put the printed URL and the token in `js/config.js` (`renderRelayUrl`, `renderRelayToken`, `renderRelayLabel`).

Full click-by-click guide, costs and safety limits: [`docs/DEPLOY_FROM_PHONE.md`](docs/DEPLOY_FROM_PHONE.md).

## Models
Nothing over 100 MB is committed (GitHub blocks it). The export models (BiRefNet matting and portrait, BiRefNet general ONNX, MatAnyone 2 reference) are pulled from their GitHub releases at pinned versions and SHA-256-checked by `server/studio-export/fetch_models.sh`; the Modal image build runs it, so cold starts download nothing. The browser models (MODNet, RVM) are small and are in `models/`.

## Licences, read before selling anything
See `LICENSES.md`. In short: BiRefNet is MIT. **MatAnyone 2 is non-commercial** (reference only, off by default; set repo variable `GENESIS_INCLUDE_REFERENCE=0` to leave it out of the image). **RVM in the browser live tier is GPL-3.0**: fine for testing, replace before you charge anyone (plan in `docs/MODEL_DECISION_v0_82.md`). SAM2Matting is non-commercial and is not used.

## Tests
`tools/e2e/unit_*.js` (40 browser-logic suites), `server/studio-export/test_*.py` (50 checks), `gpu/test_export_api.py` (32 checks), `gpu/test_adapter_compat.js` (the app's real render adapter against the API). CI runs them on push.

## Status
Verified here: the website builds; 40/40 unit suites; 50/50 export checks; 32/32 API checks; the real adapter completes a job against the API. **Not yet run anywhere:** a real GPU export, the Modal image build, the GitHub Actions workflows, GitHub Pages. First real-clip checklist is at the end of `docs/DEPLOY_FROM_PHONE.md`.
