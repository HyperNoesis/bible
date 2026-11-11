// CI GATE C (Prompt 2): Enhance on a short raw clip, real MODNet worker, real compositor, real WebCodecs encode. Offline.
// Asserts: completes; output duration/resolution; audio kept; frames match references; Enhance masks beat live-style masks
// (edge error + flicker vs ground truth); cancel + resume; model download verified, cached, works offline; corrupt download rejected.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), FIX = path.join(__dirname, 'fixtures');
const { chromium } = require(process.env.PW_LIB || 'playwright');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.webm': 'video/webm' };
const FPS = 8, N_EXPECT = 16;
(async () => {
  const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const exe = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { localStorage.setItem('vs_users', JSON.stringify({ 't@t.com': { name: 'T', password: 'x' } })); localStorage.setItem('vs_session', JSON.stringify({ email: 't@t.com' })); localStorage.setItem('vs_autostart', '0'); localStorage.setItem('vs_try_modnet', '0'); });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto(base + '/studio.html'); await page.waitForFunction(() => window.VS && window.VS.Enhance && window.VS.EnhanceCore, null, { timeout: 60000 });
  let bad = 0; const ok = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
  const upd = process.env.UPDATE_REF === '1'; const refs = [1, 6, 12].map((i) => 'ref_enh_' + i + '.png'); const haveRefs = refs.every((r) => fs.existsSync(path.join(FIX, r)));
  const R = await page.evaluate(async ({ clipUrl, gtUrl, base, FPS, refs, haveRefs }) => {
    const VS = window.VS, C = VS.EnhanceCore, out = {};
    const raw = await (await fetch(clipUrl)).blob(); const prog = [];
    const t0 = performance.now();
    const r = await VS.Enhance.run({ blob: raw, envId: 'concrete-studio', fps: FPS, jobId: 'gate-job', keepJob: true, onProgress: (p) => prog.push(p.phase + ':' + p.done) });
    out.runSec = Math.round((performance.now() - t0) / 100) / 10; out.frames = r.frames; out.w = r.width; out.h = r.height; out.audio = r.audio; out.size = r.blob.size; out.resumedFirstRun = r.resumedFrames;
    // decode output
    const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(r.blob); await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('output not playable')); });
    if (!isFinite(v.duration)) { v.currentTime = 1e101; await new Promise((x) => v.addEventListener('timeupdate', x, { once: true })); v.currentTime = 0; await new Promise((x) => v.addEventListener('seeked', x, { once: true })); }
    out.durSec = v.duration; out.vw = v.videoWidth; out.vh = v.videoHeight;
    try { const ab = await (new AudioContext()).decodeAudioData(await r.blob.arrayBuffer()); out.audioSec = ab.duration; } catch (e) { out.audioSec = 0; }
    // frames vs references (tolerance on mean abs diff, 160x120)
    const c = document.createElement('canvas'); c.width = 160; c.height = 120; const x = c.getContext('2d', { willReadFrequently: true }); out.shots = []; out.refMad = [];
    for (let k = 0; k < refs.length; k++) { const idx = [1, 6, 12][k]; v.currentTime = (idx + 0.5) / FPS; await new Promise((y) => v.addEventListener('seeked', y, { once: true })); x.drawImage(v, 0, 0, 160, 120); out.shots.push(c.toDataURL('image/png'));
      if (haveRefs) { const ref = await new Promise((y) => { const i = new Image(); i.onload = () => y(i); i.src = base + '/tools/e2e/fixtures/' + refs[k]; }); const a = x.getImageData(0, 0, 160, 120).data; x.drawImage(ref, 0, 0, 160, 120); const b = x.getImageData(0, 0, 160, 120).data; let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); out.refMad.push(s / (160 * 120 * 3)); } }
    // quality vs live-style: live = MODNet 256 px + causal EMA(0.55) at the same frames; enhance = r.masks.raw/smooth (512 px, zero-phase)
    const gtImg = await new Promise((y) => { const i = new Image(); i.onload = () => y(i); i.src = gtUrl; });
    const mw = Math.round(Math.sqrt(r.masks.raw[0].length * 4 / 3)), mh = r.masks.raw[0].length / mw; // 4:3 mask
    const g = document.createElement('canvas'); g.width = mw; g.height = mh; const gx = g.getContext('2d', { willReadFrequently: true }); gx.drawImage(gtImg, 0, 0, mw, mh); const gd = gx.getImageData(0, 0, mw, mh).data; const GT = new Uint8Array(mw * mh); for (let i = 0; i < GT.length; i++) GT[i] = gd[i * 4];
    const seg = new VS.MODNetWorkerProvider(); await seg.initialize('balanced'); seg.longEdge = 256; const lv = document.createElement('video'); lv.muted = true; lv.src = URL.createObjectURL(raw); await new Promise((y) => { lv.onloadedmetadata = y; });
    const live = []; const lc = document.createElement('canvas'), lx = lc.getContext('2d', { willReadFrequently: true });
    for (let i = 0; i < r.frames; i++) { lv.currentTime = (i + 0.5) / FPS; await new Promise((y) => lv.addEventListener('seeked', y, { once: true })); const res = await seg.segment(lv); const m = res.segmentationMask; lc.width = mw; lc.height = mh; lx.clearRect(0, 0, mw, mh); lx.drawImage(m, 0, 0, mw, mh); const d = lx.getImageData(0, 0, mw, mh).data; const a = new Uint8Array(mw * mh); for (let k = 0; k < a.length; k++) a[k] = d[k * 4 + 3];
      if (live.length) { const p = live[live.length - 1]; for (let k = 0; k < a.length; k++) a[k] = Math.round(0.55 * a[k] + 0.45 * p[k]); } live.push(a); }
    seg.dispose && seg.dispose();
    const avg = (arr) => arr.reduce((s, m) => s + C.edgeBandError(m, GT, mw, mh, 4), 0) / arr.length;
    out.q = { liveEdge: avg(live), enhEdge: avg(r.masks.smooth), rawEdge: avg(r.masks.raw), liveFlicker: C.flicker(live), enhFlicker: C.flicker(r.masks.smooth), mw, mh };
    // cancel + resume: abort after 5 matting frames, then rerun the same job id
    const ac = new AbortController(); let cancelled = false; try { await VS.Enhance.run({ blob: raw, envId: 'concrete-studio', fps: FPS, jobId: 'gate-resume', keepJob: true, signal: ac.signal, onProgress: (p) => { if (p.phase === 'matting' && p.done >= 5) ac.abort(); } }); } catch (e) { cancelled = e.name === 'AbortError'; }
    out.cancelled = cancelled; const r2 = await VS.Enhance.run({ blob: raw, envId: 'concrete-studio', fps: FPS, jobId: 'gate-resume' }); out.resumed = r2.resumedFrames; out.resumedFrames2 = r2.frames;
    // model store: corrupt download rejected -> real download verified+cached -> offline reuse
    await caches.delete('genesis-models-v1'); const bad = new Response(new Uint8Array(1000)); let rejected = false; try { await VS.Enhance.ModelStore.ensure('modnet-hq', { fetchFn: async () => bad }); } catch (e) { rejected = /corrupt|checksum/.test(e.message); } out.corruptRejected = rejected; out.cachedAfterCorrupt = await VS.Enhance.ModelStore.has('modnet-hq');
    let pg = 0; const first = await VS.Enhance.ModelStore.ensure('modnet-hq', { onProgress: (f) => { pg = Math.max(pg, f); } }); out.dl = { fromCache: first.fromCache, bytes: first.bytes, progressMax: pg };
    const off = await VS.Enhance.ModelStore.ensure('modnet-hq', { fetchFn: async () => { throw new Error('offline'); } }); out.offlineFromCache = off.fromCache;
    return out;
  }, { clipUrl: base + '/tools/e2e/fixtures/raw_clip.webm', gtUrl: base + '/tools/e2e/fixtures/gt_alpha_640x480.png', base, FPS, refs, haveRefs });
  if (upd || !haveRefs) { R.shots.forEach((d, i) => fs.writeFileSync(path.join(FIX, refs[i]), Buffer.from(d.split(',')[1], 'base64'))); console.log('NOTE references written: ' + refs.join(', ') + ' (look once, then commit)'); }
  console.log('info', JSON.stringify({ ...R, shots: undefined }));
  ok('Enhance completes (' + N_EXPECT + ' frames at ' + FPS + ' fps)', R.frames === N_EXPECT, R.frames);
  ok('output resolution = source 640x480', R.vw === 640 && R.vh === 480, [R.vw, R.vh]);
  ok('output duration = frames / fps (+-0.2 s)', Math.abs(R.durSec - N_EXPECT / FPS) <= 0.2, R.durSec);
  ok('audio kept (decodes, ~2 s)', R.audio === true && Math.abs(R.audioSec - 2) <= 0.3, [R.audio, R.audioSec]);
  if (haveRefs) ok('3 frames match references (MAD <= 8)', R.refMad.every((m) => m <= 8), R.refMad.map((m) => +m.toFixed(2)));
  ok('Enhance edge error < live-style edge error', R.q.enhEdge < R.q.liveEdge, [+R.q.enhEdge.toFixed(2), +R.q.liveEdge.toFixed(2)]);
  ok('Enhance flicker < live-style flicker', R.q.enhFlicker < R.q.liveFlicker, [+R.q.enhFlicker.toFixed(3), +R.q.liveFlicker.toFixed(3)]);
  ok('cancel stops the job', R.cancelled === true);
  ok('resume reuses finished frames (>= 4)', R.resumed >= 4, R.resumed);
  ok('corrupt model download rejected and not cached', R.corruptRejected && !R.cachedAfterCorrupt, [R.corruptRejected, R.cachedAfterCorrupt]);
  ok('model downloads with progress, verified', !R.dl.fromCache && R.dl.progressMax >= 0.99 && R.dl.bytes === 13066403, R.dl);
  ok('model reused offline from cache', R.offlineFromCache === true);
  ok('no page errors', errs.filter((e) => !/MediaPipe|net::|ERR_FAILED/.test(e)).length === 0, errs.slice(0, 3));
  await browser.close(); srv.close(); process.exit(bad ? 1 : 0);
})();
