// CI GATE B (Prompt 1): REAL MODNet in its worker, offline, on real camera frames from the fake device.
// Fails if: mask IoU vs ground truth < min, frame-to-frame mask flicker > max, or the page main thread is blocked longer than max.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), FIX = path.join(__dirname, 'fixtures');
const TH = JSON.parse(fs.readFileSync(path.join(__dirname, 'gate_thresholds.json'), 'utf8'));
const { chromium } = require(process.env.PW_LIB || 'playwright');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream' };
(async () => {
  if (!fs.existsSync(path.join(ROOT, 'models/modnet.onnx'))) { console.log('FAIL models/modnet.onnx missing (run scripts/restore-big-files.sh)'); process.exit(1); }
  const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
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
    let worst = 0, last = performance.now(); const tick = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n; }, 10);
    const w = new window.VS.MODNetWorkerProvider(); const t0 = performance.now(); await w.initialize('balanced'); const loadMs = Math.round(performance.now() - t0);
    const SW = 160, SH = 120, rd = (src, a) => { const k = document.createElement('canvas'); k.width = SW; k.height = SH; const x = k.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, SW, SH); const d = x.getImageData(0, 0, SW, SH).data; const o = new Float32Array(SW * SH); for (let i = 0; i < SW * SH; i++) o[i] = d[i * 4 + (a ? 3 : 0)]; return o; };
    const G = rd(gt, false); const masks = []; const segMs = [];
    for (let i = 0; i < N; i++) { const t1 = performance.now(); const res = await w.segment(v); segMs.push(performance.now() - t1); masks.push(rd(res.segmentationMask, true)); await new Promise((r2) => setTimeout(r2, 120)); }
    clearInterval(tick); stream.getTracks().forEach((t) => t.stop());
    let inter = 0, uni = 0; const M = masks[masks.length - 1]; for (let i = 0; i < SW * SH; i++) { const a = M[i] > 127, b = G[i] > 127; if (a && b) inter++; if (a || b) uni++; }
    let fl = 0; for (let k = 1; k < masks.length; k++) { let s = 0; for (let i = 0; i < SW * SH; i++) s += Math.abs(masks[k][i] - masks[k - 1][i]); fl += s / (SW * SH); } fl /= (masks.length - 1);
    return { label: w.label, iou: inter / Math.max(1, uni), maskFlicker: fl, mainGapMs: Math.round(worst), loadMs, segMsMedian: Math.round(segMs.sort((a, b) => a - b)[N >> 1]) };
  }, { N: TH.modnetFrames, gtUrl: base + '/tools/e2e/fixtures/gt_alpha_640x480.png' });
  console.log('info', JSON.stringify(r));
  ok('MODNet runs in a worker, offline', /worker/i.test(r.label), r.label);
  ok('mask IoU vs ground truth >= ' + TH.modnetMinIou, r.iou >= TH.modnetMinIou, +r.iou.toFixed(3));
  ok('raw mask frame-to-frame flicker <= ' + TH.modnetMaxMaskFlicker + ' (of 255)', r.maskFlicker <= TH.modnetMaxMaskFlicker, +r.maskFlicker.toFixed(3));
  ok('page main thread never blocked > ' + TH.modnetMaxMainGapMs + ' ms', r.mainGapMs <= TH.modnetMaxMainGapMs, r.mainGapMs);
  ok('no page errors', errs.filter((e) => !/MediaPipe|net::|ERR_FAILED/.test(e)).length === 0, errs.slice(0, 3));
  await browser.close(); srv.close(); process.exit(bad ? 1 : 0);
})();
