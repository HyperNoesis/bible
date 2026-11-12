// Genesis service worker: makes the app installable and lets the shell
// (pages, CSS, JS, built-in environment images) load with no network.
// Live features (AI transcription, environment generation, cloud sync)
// genuinely need network and fail through their own providers offline —
// this worker doesn't and can't fake those.

// Bump on every deploy that touches js/*, css/*, or SHELL_ASSETS — this is
// what forces an already-installed client to drop stale cached files.
const SHELL_CACHE = 'genesis-shell-v111';
const RUNTIME_CACHE = 'genesis-runtime-v10';

const SHELL_ASSETS = [
  'assets/environments/brick-podcast-room.jpg', 'assets/environments/broadcast-wall.jpg', 'assets/environments/classroom.jpg', 'assets/environments/color-backdrop-studio.jpg',
  'assets/environments/concrete-studio.jpg', 'assets/environments/corporate-office.jpg', 'assets/environments/gear-room.jpg', 'assets/environments/interview-studio.jpg',
  'assets/environments/moody-blue-backdrop.jpg', 'assets/environments/newsroom.jpg', 'assets/environments/outdoor.jpg', 'assets/environments/podcast-studio.jpg',
  'assets/environments/scene-blue-news-depth.png', 'assets/environments/scene-blue-news.jpg', 'assets/environments/scene-classroom-desk-depth.png', 'assets/environments/scene-classroom-desk.jpg',
  'assets/environments/scene-exec-office-depth.png', 'assets/environments/scene-exec-office.jpg', 'assets/environments/scene-library-warm-depth.png', 'assets/environments/scene-library-warm.jpg',
  'assets/environments/scene-living-room-depth.png', 'assets/environments/scene-living-room-fg.png', 'assets/environments/scene-living-room.jpg', 'assets/environments/scene-lounge-seat-depth.png',
  'assets/environments/scene-lounge-seat-fg.png', 'assets/environments/scene-lounge-seat.jpg', 'assets/environments/scene-minimal-studio-depth.png', 'assets/environments/scene-minimal-studio.jpg',
  'assets/environments/scene-news-desk-depth.png', 'assets/environments/scene-news-desk.jpg', 'assets/environments/scene-office-bright-depth.png', 'assets/environments/scene-office-bright.jpg',
  'assets/environments/scene-podcast-wood-depth.png', 'assets/environments/scene-podcast-wood.jpg', 'assets/environments/scene-premium-classroom-depth.png', 'assets/environments/scene-premium-classroom.jpg',
  'assets/environments/scene-premium-library-depth.png', 'assets/environments/scene-premium-library.jpg', 'assets/environments/scene-premium-living-depth.png', 'assets/environments/scene-premium-living.jpg',
  'assets/environments/scene-premium-minimal-depth.png', 'assets/environments/scene-premium-minimal.jpg', 'assets/environments/scene-premium-podcast-depth.png', 'assets/environments/scene-premium-podcast.jpg',
  'assets/environments/scene-premium-sports-depth.png', 'assets/environments/scene-premium-sports.jpg', 'assets/environments/scene-premium-stage-depth.png', 'assets/environments/scene-premium-stage.jpg',
  'assets/environments/scene-premium-talkshow-depth.png', 'assets/environments/scene-premium-talkshow.jpg', 'assets/environments/scene-premium-tech-depth.png', 'assets/environments/scene-premium-tech.jpg',
  'assets/environments/scene-premium-terrace-depth.png', 'assets/environments/scene-premium-terrace.jpg', 'assets/environments/scene-sports-desk-depth.png', 'assets/environments/scene-sports-desk.jpg',
  'assets/environments/scene-stage-hall-depth.png', 'assets/environments/scene-stage-hall.jpg', 'assets/environments/scene-talk-show-depth.png', 'assets/environments/scene-talk-show.jpg',
  'assets/environments/scene-tech-review-depth.png', 'assets/environments/scene-tech-review.jpg', 'assets/environments/scene-terrace-depth.png', 'assets/environments/scene-terrace.jpg',
  'assets/fonts/OFL-SpaceGrotesk.txt', 'assets/fonts/SpaceGrotesk-Variable.woff2', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'assets/logo-mark.png', 'assets/logo.png', 'assets/scenes/_builtin_order.json', 'assets/scenes/_premium_order.json',
  'assets/scenes/scene-blue-news/LICENCE.txt', 'assets/scenes/scene-blue-news/scene.json', 'assets/scenes/scene-classroom-desk/scene.json', 'assets/scenes/scene-exec-office/LICENCE.txt',
  'assets/scenes/scene-exec-office/scene.json', 'assets/scenes/scene-library-warm/scene.json', 'assets/scenes/scene-living-room/scene.json', 'assets/scenes/scene-lounge-seat/LICENCE.txt',
  'assets/scenes/scene-lounge-seat/scene.json', 'assets/scenes/scene-lounge-seat/source/grok-sofa-original.jpg', 'assets/scenes/scene-minimal-studio/scene.json', 'assets/scenes/scene-news-desk/scene.json',
  'assets/scenes/scene-office-bright/scene.json', 'assets/scenes/scene-podcast-wood/scene.json', 'assets/scenes/scene-premium-classroom/scene.json', 'assets/scenes/scene-premium-library/scene.json',
  'assets/scenes/scene-premium-living/scene.json', 'assets/scenes/scene-premium-minimal/scene.json', 'assets/scenes/scene-premium-podcast/LICENCE.txt', 'assets/scenes/scene-premium-podcast/scene.json',
  'assets/scenes/scene-premium-sports/LICENCE.txt', 'assets/scenes/scene-premium-sports/scene.json', 'assets/scenes/scene-premium-stage/LICENCE.txt', 'assets/scenes/scene-premium-stage/scene.json',
  'assets/scenes/scene-premium-talkshow/scene.json', 'assets/scenes/scene-premium-tech/scene.json', 'assets/scenes/scene-premium-terrace/scene.json', 'assets/scenes/scene-sports-desk/scene.json',
  'assets/scenes/scene-stage-hall/scene.json', 'assets/scenes/scene-talk-show/scene.json', 'assets/scenes/scene-tech-review/scene.json', 'assets/scenes/scene-terrace/scene.json',
  'audio.html', 'auth.html', 'benchmark.html', 'blindtest.html',
  'call.html', 'cam.html', 'components.html', 'css/genesis-system.css',
  'design.html', 'desklabel.html', 'docs/PRIVACY.md', 'docs/TERMS.md',
  'editor.html', 'environments.html', 'home.html', 'index.html',
  'js/app.js', 'js/audio-chain.js', 'js/audio-mix.js', 'js/audio-studio.js',
  'js/audio-ui.js', 'js/auth.js', 'js/ba-capture.js', 'js/benchmark.js',
  'js/blindtest.js', 'js/brand-core.js', 'js/call.js', 'js/cam.js',
  'js/camera-bridge-client.js', 'js/camera-control.js', 'js/config.example.js', 'js/config.js',
  'js/design-system.js', 'js/desklabel.js', 'js/dev-gate.js', 'js/diagnostics.js',
  'js/editor.js', 'js/effects-speed.js', 'js/enhance-core.js', 'js/enhance.js',
  'js/error-boundary.js', 'js/face-fit-core.js', 'js/first-run.js', 'js/genesis-design.js',
  'js/gesture-control.js', 'js/golive-core.js', 'js/golive.js', 'js/grade-core.js',
  'js/grade-ui.js', 'js/graphics.js', 'js/hand-gesture-core.js', 'js/icons.js',
  'js/iris.js', 'js/landing.js', 'js/legal.js', 'js/light-meter.js',
  'js/loader.js', 'js/looks.js', 'js/multisource-core.js', 'js/multisource.js',
  'js/nav.js', 'js/net-status.js', 'js/ort-loader.js', 'js/projects-page.js',
  'js/prompter-core.js', 'js/prompter-remote.js', 'js/providers/auth-provider.js', 'js/providers/captions-provider.js',
  'js/providers/composition-engine.js', 'js/providers/environment-provider.js', 'js/providers/face-provider.js', 'js/providers/gl-matte.js',
  'js/providers/groq-transcription.js', 'js/providers/hands-provider.js', 'js/providers/lufs-meter.js', 'js/providers/mask-clean.js',
  'js/providers/mask-refine.js', 'js/providers/modnet-provider.js', 'js/providers/roi-track.js', 'js/providers/modnet-worker.js', 'js/providers/perf-profile.js',
  'js/providers/pose-gate.js', 'js/providers/realism-engine.js', 'js/providers/render-provider.js', 'js/providers/rvm-lite-provider.js',
  'js/providers/rvm-provider.js', 'js/providers/rvm-worker.js', 'js/providers/scene-engine.js', 'js/providers/scene-library.js',
  'js/providers/scene-meta.js', 'js/providers/segmentation-provider.js', 'js/providers/storage-provider.js', 'js/providers/stream-provider.js',
  'js/qr.js', 'js/rec-extras.js', 'js/remote.js', 'js/render-core.js',
  'js/render-ui.js', 'js/render-worker.js', 'js/scene-wizard.js', 'js/seg-presets.js', 'js/seg-diagnostics.js',
  'js/show-core.js', 'js/show.js', 'js/storage.js', 'js/studio-check.js',
  'js/studio-shell.js', 'js/studio-ux.js', 'js/supabase-loader.js', 'js/teleprompter.js',
  'js/templates.js', 'js/trim.js', 'js/worklets/lufs-worklet.js', 'js/worklets/rnnoise-worklet.js',
  'landing.html', 'manifest.json', 'privacy.html', 'projects.html',
  'remote.html', 'reset-password.html', 'settings.html', 'studio.html',
  'terms.html', 'tests.html', 'vendor/webm-muxer/webm-muxer.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => { console.error('Genesis SW: shell precache failed; install aborted', err); throw err; })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== SHELL_CACHE && n !== RUNTIME_CACHE).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// v0.84: cross-origin isolation WITHOUT server headers. GitHub Pages cannot send the _headers file, and without COOP/COEP the browser
// has no SharedArrayBuffer, so the matting WASM runs on ONE thread (3 s per frame on a phone). The service worker adds the same two
// headers (same values as _headers) to every same-origin response, including worker scripts and wasm. Cross-origin responses are untouched.
const ISO_HEADERS = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' };
function iso(res) {
  try {
    if (!res || res.type === 'opaque' || res.type === 'opaqueredirect' || res.type === 'error' || res.status === 0) return res;
    const h = new Headers(res.headers);
    for (const k in ISO_HEADERS) h.set(k, ISO_HEADERS[k]);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  } catch (e) { return res; }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.origin === self.location.origin && /\/vendor\//.test(url.pathname)) {
    // Self-hosted engine files (MediaPipe wasm + model, ~11 MB): CACHE-FIRST. They are versioned by path and never
    // change in place, so after the first visit Studio starts without downloading anything.
    event.respondWith(
      caches.match(req).then((cached) => (cached ? iso(cached) : fetch(req).then((res) => {
        if (res && res.ok) caches.open(RUNTIME_CACHE).then((c) => c.put(req, res.clone()));
        return iso(res);
      })))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // Network-first, cache as fallback — an actively-developed multi-page
    // app needs correctness over instant offline-boot speed.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) caches.open(SHELL_CACHE).then((c) => c.put(req, res.clone()));
          return iso(res);
        })
        .catch(() => caches.match(req).then(iso))
    );
    return;
  }

  // Cross-origin: only cache known static-library CDNs (jsdelivr/unpkg),
  // so the shell can boot offline after a first load. Live API hosts
  // (Groq, Pollinations, Supabase) are left untouched — a cached
  // "successful" response there would mean serving stale data offline.
  if (!/jsdelivr\.net|unpkg\.com|huggingface\.co|(^|\.)hf\.co$|storage\.googleapis\.com/.test(url.hostname)) return;

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.ok) caches.open(RUNTIME_CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }))
  );
});
