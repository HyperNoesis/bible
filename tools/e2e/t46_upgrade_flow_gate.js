// CI GATE G (v0.62): app-level speed-test flow with a simulated "hitch". Starts the studio camera, makes the first model runs artificially slow (like contention on a phone),
// and checks the app still ends on high-quality matting instead of falling back to the light model. Also checks a saved "slow" verdict expires.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), FIX = path.join(__dirname, 'fixtures');
const { chromium } = require(process.env.PW_LIB || 'playwright');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream' };
(async () => {
  const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' }); fs.createReadStream(f).pipe(r); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const exe = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + path.join(FIX, 'webcam_clip.mjpeg')] });
  const ctx = await browser.newContext({ viewport: { width: 800, height: 700 }, serviceWorkers: 'block', permissions: ['camera'] });
  await ctx.addInitScript(() => { localStorage.setItem('vs_users', JSON.stringify({ 't@t.com': { name: 'T', password: 'x' } })); localStorage.setItem('vs_session', JSON.stringify({ email: 't@t.com' })); localStorage.setItem('vs_autostart', '0'); localStorage.setItem('vs_max_ms', '300');   /* this 1-2 core box is far slower than a phone: relax the limit, the FLOW is what is tested */ localStorage.setItem('vs_try_modnet', '0'); });
  let bad = 0; const ok = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
  async function session(hitchRuns, preBench) {
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.addInitScript(({ hitchRuns, preBench }) => {
      localStorage.setItem('vs_autostart', '0'); localStorage.removeItem('vs_try_modnet'); localStorage.removeItem('vs_live_engine');
      if (preBench) localStorage.setItem('vs_model_bench', JSON.stringify(preBench(navigator.userAgent, !!navigator.gpu)));
      let n = 0; const orig = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (m, t) { if (m && m.type === 'run' && n++ < hitchRuns) { const w = this; return setTimeout(() => orig.call(w, m, t), 700); } return orig.call(this, m, t); };
    }, { hitchRuns, preBench: preBench ? undefined : undefined });
    if (preBench) await page.addInitScript((b) => { localStorage.setItem('vs_model_bench', b.replace('__UA__', navigator.userAgent).replace('__GPU__', navigator.gpu ? 'gpu' : 'nogpu')); }, preBench);
    await page.goto(base + '/studio.html'); await page.waitForSelector('#startBtn'); await page.click('#startBtn');
    let last = '', t0 = Date.now(), notes = [];
    while (Date.now() - t0 < 150000) {
      const n = await page.evaluate(() => (document.getElementById('modelBenchNote') || {}).textContent || ''); if (n && n !== last) { last = n; notes.push(n); }
      if (/High-quality matting is active|Staying on the light model|This device runs best/.test(n)) { await page.waitForTimeout(500); break; } await page.waitForTimeout(500);
    }
    await page.close(); return { last, notes, errs };
  }
  const clean = await session(0);
  console.log('info clean:', clean.last);
  ok('clean run reaches high-quality matting', /High-quality matting is active/.test(clean.last), clean.last);
  const hitch = await session(4);
  console.log('info hitch:', hitch.last);
  ok('4 slow runs (simulated hitch) still end on high-quality matting', hitch.notes.some((n) => /High-quality matting is active/.test(n)), hitch.notes.slice(-3));
  const stale = await session(0, JSON.stringify({ v: 3, key: '__UA__|__GPU__', at: Date.now() - 8 * 3600e3, rvmMs: 810, modnetMs: 2867, edge: 256 }));
  ok('an 8-hour-old "slow" verdict is ignored and the model is tested again', stale.notes.some((n) => /High-quality matting is active/.test(n)), stale.notes.slice(-3));
  const fresh = await session(0, JSON.stringify({ v: 3, key: '__UA__|__GPU__', at: Date.now() - 600e3, rvmMs: 810, modnetMs: 2867, edge: 256 }));
  ok('a fresh "slow" verdict (10 min) is still respected (no re-download)', /runs best on the light model/.test(fresh.last), fresh.last);
  ok('no page errors', [...clean.errs, ...hitch.errs].filter((e) => !/MediaPipe|net::|ERR_FAILED/.test(e)).length === 0, [...clean.errs, ...hitch.errs].slice(0, 3));
  await browser.close(); srv.close(); process.exit(bad ? 1 : 0);
})();
