// CI GATE E (v0.61): cross-origin isolation + multi-thread WASM. Serves the app with the SAME headers as _headers, then checks the page is isolated and that
// RVM and MODNet started with 3 threads still give correct masks (IoU vs ground truth). Speed-up itself needs a multi-core phone (this check box has 1 core).
// Fails if: mask IoU vs ground truth < min, frame-to-frame mask flicker > max, or the page main thread is blocked longer than max.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), FIX = path.join(__dirname, 'fixtures');
const TH = JSON.parse(fs.readFileSync(path.join(__dirname, 'gate_thresholds.json'), 'utf8'));
const { chromium } = require(process.env.PW_LIB || 'playwright');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream' };
(async () => {
  if (!fs.existsSync(path.join(ROOT, 'models/rvm_mobilenetv3_fp32.onnx'))) { console.log('FAIL models/rvm_mobilenetv3_fp32.onnx missing (run scripts/restore-big-files.sh)'); process.exit(1); }
  const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' }); fs.createReadStream(f).pipe(r); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const exe = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + path.join(FIX, 'webcam_clip.mjpeg')] });
  const ctx = await browser.newContext({ viewport: { width: 800, height: 700 }, serviceWorkers: 'block', permissions: ['camera'] });
  await ctx.addInitScript(() => { localStorage.setItem('vs_users', JSON.stringify({ 't@t.com': { name: 'T', password: 'x' } })); localStorage.setItem('vs_session', JSON.stringify({ email: 't@t.com' })); localStorage.setItem('vs_autostart', '0'); localStorage.setItem('vs_try_modnet', '0'); });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto(base + '/studio.html'); await page.waitForTimeout(2500);
  const out = []; let bad = 0; const ok = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
  const r = await page.evaluate(async ({ N, gtUrl }) => {
    const gt = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = gtUrl; });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } }); const v = document.createElement('video'); v.muted = true; v.srcObject = stream; await v.play(); await new Promise((r2) => setTimeout(r2, 500));
    { const wk = document.createElement('canvas'); wk.width = 448; wk.height = 336; const wx = wk.getContext('2d', { willReadFrequently: true }); wx.drawImage(v, 0, 0, 448, 336); wx.getImageData(0, 0, 448, 336); }   // warm the video->canvas readback (the real app has drawn many frames before the upgrade starts; a software-GL first readback alone stalls ~2 s)
    let worst = 0, worstAt = 0, last = performance.now(); const T0 = last; const tick = setInterval(() => { const n = performance.now(); if (n - last > worst) { worst = n - last; worstAt = Math.round(n - T0); } last = n; }, 10);
    const iso = { isolated: self.crossOriginIsolated === true, sab: typeof SharedArrayBuffer !== 'undefined' };
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });   // pretend a 4-core phone so threadsFor() asks for 3
    const wantThreads = window.VS.MODNetWorkerProvider.threadsFor();
    const runOne = async (w, init) => {
      const t0 = performance.now(); await init(w); const loadMs = Math.round(performance.now() - t0);
    const SW = 160, SH = 120, rd = (src, a) => { const k = document.createElement('canvas'); k.width = SW; k.height = SH; const x = k.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, SW, SH); const d = x.getImageData(0, 0, SW, SH).data; const o = new Float32Array(SW * SH); for (let i = 0; i < SW * SH; i++) o[i] = d[i * 4 + (a ? 3 : 0)]; return o; };
      const G = rd(gt, false); const masks = []; const segMs = [];
      for (let i = 0; i < N; i++) { const t1 = performance.now(); const res = await w.segment(v); segMs.push(performance.now() - t1); masks.push(rd(res.segmentationMask, true)); await new Promise((r2) => setTimeout(r2, 120)); }
      w.dispose && w.dispose();
      let inter = 0, uni = 0; const M = masks[masks.length - 1]; for (let i = 0; i < SW * SH; i++) { const a = M[i] > 127, b = G[i] > 127; if (a && b) inter++; if (a || b) uni++; }
      let fl = 0; for (let k = 1; k < masks.length; k++) { let s = 0; for (let i = 0; i < SW * SH; i++) s += Math.abs(masks[k][i] - masks[k - 1][i]); fl += s / (SW * SH); } fl /= (masks.length - 1);
      return { label: w.label, threads: w.threads, iou: inter / Math.max(1, uni), maskFlicker: fl, loadMs, segMsMedian: Math.round(segMs.sort((a, b) => a - b)[N >> 1]) };
    };
    const rvm = await runOne(new window.VS.RVMWorkerProvider(), (w) => w.initialize('fast'));
    const mod = await runOne(new window.VS.MODNetWorkerProvider(), (w) => w.initialize('fast'));
    clearInterval(tick); stream.getTracks().forEach((t) => t.stop());
    return { iso, wantThreads, rvm, mod, mainGapMs: Math.round(worst) };
  }, { N: 8, gtUrl: base + '/tools/e2e/fixtures/gt_alpha_640x480.png' });
  console.log('info', JSON.stringify(r));
  ok('page is cross-origin isolated with SharedArrayBuffer', r.iso.isolated && r.iso.sab, r.iso);
  ok('threadsFor() asks for 3 threads on a 4-core phone', r.wantThreads === 3, r.wantThreads);
  ok('RVM started with 3 threads', r.rvm.threads === 3 && /x3/.test(r.rvm.label), r.rvm.label);
  ok('RVM threaded mask IoU >= ' + TH.rvmMinIou, r.rvm.iou >= TH.rvmMinIou, +r.rvm.iou.toFixed(3));
  ok('MODNet started with 3 threads', r.mod.threads === 3 && /x3/.test(r.mod.label), r.mod.label);
  ok('MODNet threaded mask IoU >= ' + TH.modnetMinIou, r.mod.iou >= TH.modnetMinIou, +r.mod.iou.toFixed(3));
  ok('no page errors', errs.filter((e) => !/MediaPipe|net::|ERR_FAILED/.test(e)).length === 0, errs.slice(0, 3));
  await browser.close(); srv.close(); process.exit(bad ? 1 : 0);
})();
