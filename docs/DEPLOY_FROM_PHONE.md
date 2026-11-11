# Deploy Genesis from a phone (GitHub + Modal)

Nothing here needs a laptop. Use the browser on your phone (desktop-site mode helps on GitHub's settings pages).

## 0. What you get
- **Website** on GitHub Pages, free for a public repo (a private repo needs a paid GitHub plan; the alternative is Cloudflare Pages, below).
- **GPU export service** on Modal: scales to zero, bills per second only while exporting, no server to keep alive.

## 1. Website (GitHub Pages)
1. Repo, Settings, Pages, Source: **GitHub Actions**.
2. Repo, Actions tab, "Deploy website (GitHub Pages)", Run workflow (or just push to `main`).
3. Your site is at `https://<owner>.github.io/<repo>/`. Open it and use "Add to Home Screen".

GitHub Pages cannot set headers, so `_headers` is ignored there (the service worker versions itself, so this is fine). Cloudflare Pages and Netlify do read it.

**Alternative, Cloudflare Pages:** Workers & Pages, Create, Pages, Connect to Git, pick the repo, build command `sh scripts/build-site.sh`, output directory `www`. Largest file is 24.7 MB, under Cloudflare's 25 MiB limit.

## 2. GPU service (Modal)
1. Create a Modal account (modal.com). Settings, API Tokens, New token. Copy the **Token ID** and **Token Secret**. If Modal asks for a payment card, check first that yours is accepted; I could not verify this.
2. Invent a long random access token (24+ characters). This is `GENESIS_EXPORT_TOKEN`.
3. Repo, Settings, Secrets and variables, Actions, **New repository secret**, three times: `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `GENESIS_EXPORT_TOKEN`.
4. Optional, same page, **Variables** tab:
   - `ALLOW_ORIGIN` = your site's origin only, e.g. `https://hypernoesis.github.io` (no path). Strongly recommended.
   - `DAILY_CAP` = max exports per day (default 30).
   - `GENESIS_GPU` = `L4` (default) or `L40S` for longer or bigger clips.
   - `GENESIS_INCLUDE_REFERENCE` = `0` to leave MatAnyone 2 out of the image completely (do this for any commercial deployment).
   - `ALLOW_REFERENCE` = `1` only to benchmark MatAnyone 2 (non-commercial).
5. Actions tab, "Deploy GPU export (Modal)", Run workflow. The first build downloads about 3 GB of models and takes 10 to 20 minutes. The run summary then shows the URL.
6. Open `<URL>/health`. You should see `"ok": true` and `"token_configured": true`.

## 3. Connect the website to the GPU service
Edit `js/config.js` on GitHub (pencil icon) and set:
```
renderRelayUrl: 'https://<the URL from step 2.5>',
renderRelayToken: '<your GENESIS_EXPORT_TOKEN>',
renderRelayLabel: 'Studio Export: clean cutout on scene',
```
Commit. Pages redeploys in about a minute. A button now appears under saved recordings. The token is visible to every visitor of a static site, so it is only a speed bump: the real protection is `DAILY_CAP`, `ALLOW_ORIGIN`, the 2-GPU ceiling, the 60 MB and 30 s limits, and a spending limit you set in Modal's billing settings.

## Cost and safety limits built in
- Max 2 GPUs at once (`GENESIS_MAX_GPUS`), 30 exports a day, 60 MB per clip, 30 s per clip, 2 hours before results and clips are deleted, the uploaded original is deleted the moment the render ends.
- My estimate (not measured): a 5 to 10 s clip is under a minute of L4 time, so cents per export. Modal's free monthly credit should cover many exports; check their pricing page.

## What the first real run should check (nothing below has been run yet)
1. Workflow "Deploy GPU export (Modal)" goes green and prints a URL.
2. `<URL>/health` answers.
3. A 5-second clip exports and plays. Look at hair edges, fingers and the room colour at the silhouette.
4. In Modal's app page, check the render time and GPU cost of that one job.
5. For the MatAnyone 2 comparison, use `gpu/colab_benchmark.ipynb` (free Colab GPU), run both engines on the same clip and compare the `flicker` numbers.

## If something fails
- Modal build error about `add_local_dir`, `scaledown_window` or an import: send me the red line from the Actions log; these API calls were checked against the installed SDK, not against Modal's live service.
- Browser shows "refused the request": the two tokens differ, or `ALLOW_ORIGIN` does not match the site's origin exactly.
- "daily render limit reached": raise `DAILY_CAP` and redeploy.
