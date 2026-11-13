#!/bin/sh
# Builds the deployable website into www/ (only what the browser needs: no server, docs, tests, tools, android).
# Used by .github/workflows/pages.yml (GitHub Pages) and by Cloudflare Pages / Netlify (build command: sh scripts/build-site.sh, output folder: www).
set -e
cd "$(dirname "$0")/.."
for f in models/modnet.onnx models/rvm_mobilenetv3_fp32.onnx vendor/ort/ort-wasm-simd-threaded.wasm vendor/ort/ort-wasm-simd-threaded.jsep.wasm; do
  [ -f "$f" ] || { echo "missing $f, restoring big files"; sh scripts/restore-big-files.sh; break; }
done
# Bundle the MediaPipe Tasks engine (wasm + loader + selfie models) INTO the site. Without it every cold start downloads about 10 MB from a CDN,
# which on a slow phone connection means minutes of black screen. npm pack fetches only that one package (no full npm install).
if [ ! -d node_modules/@mediapipe/tasks-vision/wasm ]; then
  mkdir -p node_modules/@mediapipe && ( cd "$(mktemp -d)" && npm pack --silent @mediapipe/tasks-vision@0.10.21 >/dev/null 2>&1 && tar -xzf mediapipe-tasks-vision-*.tgz && rm -rf "$OLDPWD/node_modules/@mediapipe/tasks-vision" && mv package "$OLDPWD/node_modules/@mediapipe/tasks-vision" ) || echo "could not fetch @mediapipe/tasks-vision (the site will use the CDN fallback)"
fi
node scripts/vendor-tasks.js
node scripts/make-www.js
# The service worker (sw.js) precaches a list of files; if ANY is missing the worker fails to install and the site loses offline mode and
# cross-origin isolation. make-www.js leaves some of them out (it is built for the Android app), so copy every listed file in and fail if one cannot be found.
node -e "
const fs=require('fs'),path=require('path');
const sw=fs.readFileSync('sw.js','utf8');
const list=(sw.match(/const SHELL_ASSETS = \\[([\\s\\S]*?)\\];/)||[])[1];
if(!list){console.error('could not read SHELL_ASSETS from sw.js');process.exit(1);}
const files=[...list.matchAll(/'([^']+)'/g)].map(m=>m[1]).filter(f=>f!=='./'&&!/^https?:/.test(f));
let copied=0,missing=[];
for(const f of files){const dst=path.join('www',f); if(fs.existsSync(dst))continue; if(fs.existsSync(f)){fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(f,dst);copied++;}else missing.push(f);}
console.log('service-worker precache: '+files.length+' files, copied '+copied+' that make-www left out');
if(missing.length){console.error('MISSING for the service worker: '+missing.join(', '));process.exit(1);}
"
cp _headers www/_headers            # read by Cloudflare Pages and Netlify (GitHub Pages ignores it, which is fine)
rm -f www/*.txt                   # internal notes at the repo root are not part of the website
touch www/.nojekyll                 # GitHub Pages: serve every file as is
[ -f www/vendor/mediapipe/tasks/wasm/vision_wasm_internal.wasm ] && echo "cutout engine bundled locally" || echo "WARNING: cutout engine NOT bundled (CDN fallback)"
[ -n "$GITHUB_ACTIONS" ] && echo "::notice title=Cutout engine bundling::wasm=$([ -f www/vendor/mediapipe/tasks/wasm/vision_wasm_internal.wasm ] && echo yes || echo NO) model=$([ -f www/vendor/mediapipe/tasks/selfie_segmenter.tflite ] && echo yes || echo NO)"
echo "site ready: $(find www -type f | wc -l) files, $(du -sh www | cut -f1)"
