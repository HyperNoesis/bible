// CI GATE A (Prompt 1): real camera path (Chromium fake device fed by fixtures/webcam_clip.mjpeg) + real default engine (MediaPipe legacy, offline) + full compositor.
// MODNet is gated in t41 (a slow CI CPU cannot hold MODNet at a steady FPS, so mixing them would make this gate meaningless).
// Fails on: low FPS, alpha/edge flicker, composite differs from reference, blank or frozen preview.
// Usage: node tools/e2e/t40_pipeline_gate.js   (UPDATE_REF=1 rewrites fixtures/ref_composite.png after you have looked at it)
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), FIX = path.join(__dirname, 'fixtures');
const TH = JSON.parse(fs.readFileSync(path.join(__dirname, 'gate_thresholds.json'), 'utf8'));
const { chromium } = require(process.env.PW_LIB || 'playwright');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
(async () => {
  const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(r); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const exe = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + path.join(FIX, 'webcam_clip.mjpeg'), '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 }, serviceWorkers: 'block', permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(() => { localStorage.setItem('vs_users', JSON.stringify({ 't@t.com': { name: 'Tester', password: 'x' } })); localStorage.setItem('vs_session', JSON.stringify({ email: 't@t.com' })); localStorage.setItem('vs_autostart', '0'); localStorage.setItem('vs_try_modnet', '0'); });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message)); await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto(base + '/studio.html'); await page.waitForSelector('#startBtn'); await page.click('#startBtn');
  const R = { checks: [], info: {} }; const ok = (n, c, x) => { R.checks.push({ n, pass: !!c, x }); console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
  // 1) real camera + default engine must be live
  await page.waitForFunction(() => /Provider: /.test((document.getElementById('stats')||{}).textContent||''), null, { timeout: 120000 });
  const stats = await page.evaluate(() => (document.getElementById('stats') || {}).textContent || ''); R.info.stats = stats;
  ok('default engine live (MediaPipe legacy, offline)', /Provider: [^|]*MediaPipe/i.test(stats), stats);
  // 2) pick a background (real environment photo), let it settle
  await page.evaluate(() => { const s = document.getElementById('envSelect'); const id = [...s.options].map((o) => o.value).find((v) => v === 'concrete-studio') || s.options[0].value; s.value = id; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(3000);
  // 3) sample the composited preview for sampleMs
  const refUrl = base + '/tools/e2e/fixtures/ref_composite.png', haveRef = fs.existsSync(path.join(FIX, 'ref_composite.png'));
  const m = await page.evaluate(async ({ ms, refUrl, haveRef }) => {
    const c = document.getElementById('canvas'); const v = document.createElement('video'); v.muted = true; v.srcObject = c.captureStream(); await v.play();
    const W = 160, H = 120, o = document.createElement('canvas'); o.width = W; o.height = H; const x = o.getContext('2d', { willReadFrequently: true });
    const frames = []; let n = 0; const start = performance.now();
    await new Promise((done) => { const cb = () => { n++; x.drawImage(v, 0, 0, W, H); const d = x.getImageData(0, 0, W, H).data; const l = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) l[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8; frames.push({ l, rgb: d.slice() });
      if (performance.now() - start >= ms) return done(); v.requestVideoFrameCallback(cb); }; v.requestVideoFrameCallback(cb); });
    const secs = (performance.now() - start) / 1000, fps = n / secs;
    let mad = [], frac = [], changing = 0;
    for (let k = 1; k < frames.length; k++) { let s = 0, f = 0; const a = frames[k].l, b = frames[k - 1].l; for (let i = 0; i < a.length; i++) { const dd = Math.abs(a[i] - b[i]); s += dd; if (dd > 20) f++; } mad.push(s / a.length); frac.push(f / a.length); if (s / a.length > 0.05) changing++; }
    const pct = (arr, p) => { const s = [...arr].sort((u, w) => u - w); return s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0; };
    const mid = frames[Math.floor(frames.length / 2)].l; let mean = 0; for (const q of mid) mean += q; mean /= mid.length; let sd = 0; for (const q of mid) sd += (q - mean) ** 2; sd = Math.sqrt(sd / mid.length);
    // reference: best match over all sampled frames (the clip loops, so phase differs run to run)
    let refMad = null, refPng = null; const bestIdx = Math.floor(frames.length / 2); o.getContext('2d'); { const im = new ImageData(frames[bestIdx].rgb, W, H); x.putImageData(im, 0, 0); refPng = o.toDataURL('image/png'); }
    if (haveRef) { const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = refUrl; }); x.drawImage(img, 0, 0, W, H); const rd = x.getImageData(0, 0, W, H).data; refMad = 1e9;
      for (const f of frames) { let s = 0; for (let i = 0; i < W * H; i++) s += Math.abs(f.rgb[i * 4] - rd[i * 4]) + Math.abs(f.rgb[i * 4 + 1] - rd[i * 4 + 1]) + Math.abs(f.rgb[i * 4 + 2] - rd[i * 4 + 2]); refMad = Math.min(refMad, s / (W * H * 3)); } }
    v.srcObject.getTracks().forEach((t) => t.stop());
    return { frames: frames.length, secs, fps, madMedian: pct(mad, 0.5), madP95: pct(mad, 0.95), fracMedian: pct(frac, 0.5), fracP95: pct(frac, 0.95), changing, lumaStd: sd, refMad, refPng };
  }, { ms: TH.sampleMs, refUrl, haveRef });
  const appFps = await page.evaluate(() => (document.getElementById('stats') || {}).textContent || '');
  R.info.sample = { ...m, refPng: undefined }; R.info.appStats = appFps; fs.writeFileSync(path.join(__dirname, '..', '..', 'gate_last_frame.png'), Buffer.from(m.refPng.split(',')[1], 'base64'));
  if (process.env.UPDATE_REF === '1' || !haveRef) { fs.writeFileSync(path.join(FIX, 'ref_composite.png'), Buffer.from(m.refPng.split(',')[1], 'base64')); console.log('NOTE reference written: ' + path.join(FIX, 'ref_composite.png') + ' (look at it once, then commit)'); }
  ok('average FPS >= ' + TH.minFps, m.fps >= TH.minFps, +m.fps.toFixed(2));
  ok('edge/alpha flicker (p95 frame-to-frame MAD) <= ' + TH.maxFlickerMad, m.madP95 <= TH.maxFlickerMad, +m.madP95.toFixed(3));
  ok('flicker pixels (p95 fraction changing > 20/255) <= ' + TH.maxFlickerFrac, m.fracP95 <= TH.maxFlickerFrac, +m.fracP95.toFixed(4));
  if (haveRef) ok('composite matches reference (MAD <= ' + TH.maxRefMad + ')', m.refMad <= TH.maxRefMad, +m.refMad.toFixed(2));
  ok('preview is not blank (luma std >= ' + TH.minLumaStd + ')', m.lumaStd >= TH.minLumaStd, +m.lumaStd.toFixed(1));
  ok('preview is not frozen (>= ' + TH.minChangingFrames + ' frame pairs differ)', m.changing >= TH.minChangingFrames, m.changing);
  ok('no page errors', errs.filter((e) => !/MediaPipeSegmentationProvider|ERR_FAILED|net::/.test(e)).length === 0, errs.slice(0, 3));
  fs.writeFileSync(path.join(__dirname, '..', '..', 'gate_report.json'), JSON.stringify(R, null, 1));
  await browser.close(); srv.close(); process.exit(R.checks.some((c) => !c.pass) ? 1 : 0);
})();
