// CI GATE F (v0.62): REAL-PHOTO check. Runs the SHIPPED model files (fp16-packed weights) in the real browser runtime (onnxruntime-web, WASM, worker) on 4 real handheld photos
// (curly hair, busy background) and compares each mask with a REFERENCE mask made from the ORIGINAL float32 models in desktop onnxruntime (tools/e2e/make_real_refs.py).
// It proves: (1) weight packing + the browser runtime did not change the mask (IoU vs reference), (2) RVM and MODNet agree on real faces.
// NOTE: the reference comes from the same models, so this does NOT measure absolute accuracy against a hand-made ground-truth matte (none exists for these photos).
// Photos are CC BY-NC-SA (testing only, never shipped): sh get_real_photos.sh <dir>; python3 make_real_refs.py <dir> <orig modnet.onnx> <orig rvm.onnx>; REAL_PHOTOS=<dir> node t45_real_photo_gate.js
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), FIX = path.join(__dirname, 'fixtures');
const PH = path.resolve(process.env.REAL_PHOTOS || path.join(ROOT, '..', 'real_photos'));
const { chromium } = require(process.env.PW_LIB || 'playwright');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream' };
const MIN_REF_IOU = 0.985, MIN_CROSS_IOU = 0.96;
(async () => {
  if (!fs.existsSync(path.join(PH, 'p0001_ref_rvm.png'))) { console.log('SKIP real photos / reference masks not found in ' + PH + ' (see header of this file)'); process.exit(0); }
  const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); const isPh = p.startsWith('/__photos/'); const f = isPh ? path.join(PH, p.slice(10)) : path.join(ROOT, p); if (!f.startsWith(isPh ? PH : ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' }); fs.createReadStream(f).pipe(r); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const exe = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + path.join(FIX, 'webcam_clip.mjpeg')] });
  const ctx = await browser.newContext({ viewport: { width: 800, height: 700 }, serviceWorkers: 'block', permissions: ['camera'] });
  await ctx.addInitScript(() => { localStorage.setItem('vs_users', JSON.stringify({ 't@t.com': { name: 'T', password: 'x' } })); localStorage.setItem('vs_session', JSON.stringify({ email: 't@t.com' })); localStorage.setItem('vs_autostart', '0'); localStorage.setItem('vs_try_modnet', '0'); });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto(base + '/studio.html'); await page.waitForTimeout(2000);
  let bad = 0; const ok = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
  const ids = ['0001', '0500', '1000', '1500'];
  const r = await page.evaluate(async ({ ids, ph }) => {
    const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('img ' + u)); i.src = u; });
    const W = 448, H = 256, bin = (src) => { const k = document.createElement('canvas'); k.width = W; k.height = H; const x = k.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, W, H); const d = x.getImageData(0, 0, W, H).data, o = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) o[i] = d[i * 4 + 3] > 0 && src.__alphaMode ? d[i * 4 + 3] : d[i * 4]; return o; };
    const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { const p = a[k] > 127, q = b[k] > 127; if (p && q) i++; if (p || q) u++; } return i / Math.max(1, u); };
    const mae = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]); return s / a.length; };
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360; const cx = cv.getContext('2d'); const video = document.createElement('video'); video.muted = true; video.srcObject = cv.captureStream(30); document.body.appendChild(video);
    const feed = async (img) => { cx.drawImage(img, 0, 0, 640, 360); await video.play().catch(() => {}); for (let i = 0; i < 4; i++) await new Promise((r2) => setTimeout(r2, 60)); cx.drawImage(img, 0, 0, 640, 360); await new Promise((r2) => setTimeout(r2, 80)); };
    const out = { photos: {} };
    const imgs = {}; for (const id of ids) { imgs[id] = { photo: await load(ph + 'p' + id + '.jpg'), rvm: await load(ph + 'p' + id + '_ref_rvm.png'), mod: await load(ph + 'p' + id + '_ref_modnet.png') }; }
    const grab = (res) => { const m = res.segmentationMask; const k = document.createElement('canvas'); k.width = W; k.height = H; const x = k.getContext('2d', { willReadFrequently: true }); x.drawImage(m, 0, 0, W, H); const d = x.getImageData(0, 0, W, H).data; const o = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) o[i] = d[i * 4 + 3]; return o; };
    const refMask = (img) => bin(img);
    const engines = { rvm: new window.VS.RVMWorkerProvider(), mod: new window.VS.MODNetWorkerProvider() };
    await engines.rvm.initialize('balanced'); await engines.mod.initialize('balanced');
    out.sizes = { rvm: engines.rvm.longEdge, mod: engines.mod.longEdge };
    for (const id of ids) {
      await feed(imgs[id].photo); const got = {};
      for (const k of ['rvm', 'mod']) { let res; if (k === 'rvm') await engines.rvm.reset(); for (let n = 0; n < (k === 'rvm' ? 6 : 1); n++) res = await engines[k].segment(video); got[k] = grab(res); }
      const refR = refMask(imgs[id].rvm), refM = refMask(imgs[id].mod);
      out.photos[id] = { rvmVsRef: iou(got.rvm, refR), rvmMae: mae(got.rvm, refR), modVsRef: iou(got.mod, refM), modMae: mae(got.mod, refM), rvmVsMod: iou(got.rvm, got.mod) };
    }
    engines.rvm.dispose && engines.rvm.dispose(); engines.mod.dispose && engines.mod.dispose();
    return out;
  }, { ids, ph: base + '/__photos/' });
  console.log('info', JSON.stringify(r));
  for (const id of ids) {
    const p = r.photos[id];
    ok('photo ' + id + ': shipped RVM (browser) vs float32 reference IoU >= ' + MIN_REF_IOU, p.rvmVsRef >= MIN_REF_IOU, +p.rvmVsRef.toFixed(4));
    ok('photo ' + id + ': shipped MODNet (browser) vs float32 reference IoU >= ' + MIN_REF_IOU, p.modVsRef >= MIN_REF_IOU, +p.modVsRef.toFixed(4));
    ok('photo ' + id + ': RVM and MODNet agree on a real face, IoU >= ' + MIN_CROSS_IOU, p.rvmVsMod >= MIN_CROSS_IOU, +p.rvmVsMod.toFixed(4));
  }
  ok('no page errors', errs.filter((e) => !/MediaPipe|net::|ERR_FAILED/.test(e)).length === 0, errs.slice(0, 3));
  await browser.close(); srv.close(); process.exit(bad ? 1 : 0);
})();
