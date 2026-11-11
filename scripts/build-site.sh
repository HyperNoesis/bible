#!/bin/sh
# Builds the deployable website into www/ (only what the browser needs: no server, docs, tests, tools, android).
# Used by .github/workflows/pages.yml (GitHub Pages) and by Cloudflare Pages / Netlify (build command: sh scripts/build-site.sh, output folder: www).
set -e
cd "$(dirname "$0")/.."
for f in models/modnet.onnx models/rvm_mobilenetv3_fp32.onnx vendor/ort/ort-wasm-simd-threaded.wasm vendor/ort/ort-wasm-simd-threaded.jsep.wasm; do
  [ -f "$f" ] || { echo "missing $f, restoring big files"; sh scripts/restore-big-files.sh; break; }
done
node scripts/make-www.js
cp _headers www/_headers            # read by Cloudflare Pages and Netlify (GitHub Pages ignores it, which is fine)
rm -f www/*.txt                   # internal notes at the repo root are not part of the website
touch www/.nojekyll                 # GitHub Pages: serve every file as is
echo "site ready: $(find www -type f | wc -l) files, $(du -sh www | cut -f1)"
