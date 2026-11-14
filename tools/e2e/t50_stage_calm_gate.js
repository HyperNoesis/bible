// Studio calm gate (js/stage-calm.js + the "Studio calm" CSS block): the preview shows ONE message at a time.
// Part A: the coordinator on a stub frame with a fake clock (deterministic): priority, auto-dismiss, advice debounce/repeat, chips, hint.
// Part B: the real studio.html with Chromium's fake camera: count the message elements visible over time (must never stack > 1 of
//         loading / performance banner / advice). Software-rendered headless Chromium is slow, so the performance banner usually appears: good, it is the stress case.
// Usage: node tools/e2e/t50_stage_calm_gate.js   (serves the repo itself on a free port; PW_LIB / CHROME_PATH override the browser)
const fs = require('fs'), path = require('path'), http = require('http');
let chromium; try { ({ chromium } = require(process.env.PW_LIB || 'playwright')); } catch (e) { ({ chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright')); }
const ROOT = path.resolve(__dirname, '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.onnx': 'application/octet-stream', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
let bad = 0;
const t = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); };

(async () => {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, r)); const base = 'http://localhost:' + srv.address().port;
  const exe = process.env.CHROME_PATH || undefined;
  const browser = await chromium.launch({ executablePath: exe, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

  // ------------------------------------------------------------------ Part A: coordinator with a fake clock
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
    const p = await ctx.newPage();
    await p.clock.install();
    await p.setContent('<!doctype html><html><body></body></html>');
    await p.addStyleTag({ url: base + '/css/genesis-system.css' }).catch(() => {});
    await p.evaluate(() => {
      document.body.innerHTML = '<div id="previewFrame" class="preview-frame" style="position:relative;width:800px;height:500px">' +
        '<div class="ux-ready"><div class="ux-chips"><span class="ux-chip" data-k="light" data-tone="good"><b>Light</b><em>Good</em></span><span class="ux-chip" data-k="mic" data-tone="warn"><b>Mic</b><em>Too loud</em></span></div><p class="ux-advice" hidden></p></div>' +
        '<p class="preview-hint" id="previewHint">Live preview</p><div class="degrade-toast" id="degradeBanner"></div></div>';
    });
    await p.addScriptTag({ url: base + '/js/stage-calm.js' });
    const S = () => p.evaluate(() => {
      const d = (el) => !!el && getComputedStyle(el).display !== 'none';
      const adv = document.querySelector('.ux-advice'), b = document.getElementById('degradeBanner');
      return { state: document.getElementById('previewFrame').getAttribute('data-stage-msg'), advice: d(adv) && !adv.hidden, banner: d(b) && b.classList.contains('show'), loading: !!document.querySelector('.stage-loading'),
               goodChip: d(document.querySelector('.ux-chip[data-tone="good"]')), warnChip: d(document.querySelector('.ux-chip[data-tone="warn"]')), hint: +getComputedStyle(document.getElementById('previewHint')).opacity };
    });
    const adviceOn = (txt) => p.evaluate((x) => { const a = document.querySelector('.ux-advice'); a.textContent = x; a.hidden = !x; }, txt);
    const bannerOn = (txt) => p.evaluate((x) => { const b = document.getElementById('degradeBanner'); b.textContent = x; b.classList.toggle('show', !!x); }, txt);
    const loadingOn = (on) => p.evaluate((x) => { const f = document.getElementById('previewFrame'); const e = f.querySelector('.stage-loading'); if (x && !e) { const n = document.createElement('div'); n.className = 'stage-loading'; n.textContent = 'Loading the cutout engine...'; f.appendChild(n); } if (!x && e) e.remove(); }, on);
    const wait = async (ms) => { await p.clock.fastForward(ms); await p.waitForTimeout(30); };

    let s = await S();
    t('A1 chips: a good chip is hidden, a warning chip is shown', !s.goodChip && s.warnChip, JSON.stringify({ good: s.goodChip, warn: s.warnChip }));
    t('A2 nothing showing -> state none, hint visible', s.state === 'none' && s.hint === 1, s.state + ' hint=' + s.hint);

    // stack everything at once: loading + perf banner + advice
    await adviceOn('Your voice is peaking. Move back from the mic or speak a little softer.');
    await bannerOn('Your device is working hard, so Genesis lowered its frame rate.');
    await loadingOn(true);
    await wait(3000);
    await p.waitForTimeout(400);                       // CSS transitions run in real time, not on the fake clock
    s = await S();
    t('A3 loading outranks the banner and the advice (only loading is left)', s.state === 'loading' && !s.banner && !s.advice && s.loading, JSON.stringify(s));
    t('A4 the footer hint steps aside while a message shows', s.hint === 0, 'hint=' + s.hint);

    await loadingOn(false); await wait(700);
    s = await S();
    t('A5 loading gone -> the performance banner shows, advice stays hidden', s.state === 'perf' && s.banner && !s.advice, JSON.stringify(s));
    await wait(8500);
    s = await S();
    t('A6 the performance banner tucks itself away after ~8 s', !s.banner && s.state !== 'perf', JSON.stringify(s));
    t('A7 the app still thinks its banner is shown (we never remove the show class)', await p.evaluate(() => document.getElementById('degradeBanner').classList.contains('show')));

    await bannerOn('Camera feed lost. Reconnect your camera, then Stop Camera and start again.');
    await loadingOn(true); await wait(600);
    s = await S();
    t('A8 a critical error outranks even loading and is visible', s.state === 'critical' && s.banner, JSON.stringify(s));
    await loadingOn(false); await wait(30000);
    s = await S();
    t('A9 a critical error never times out', s.state === 'critical' && s.banner, JSON.stringify(s));
    await bannerOn(''); await wait(700);

    // advice debounce: flickering text never shows; stable text shows after ~2.5 s, hides after ~7 s, does not repeat within 90 s
    for (let i = 0; i < 8; i++) { await adviceOn('Advice ' + i); await wait(500); }
    s = await S();
    t('A10 advice that keeps changing (a mic peak flicker) never shows', !s.advice, JSON.stringify(s));
    await adviceOn('Your mic is a little quiet. Move closer.'); await wait(1200);
    s = await S(); t('A11 new advice waits until it is stable (not yet at 1.2 s)', !s.advice);
    await wait(2000); s = await S(); t('A12 stable advice shows (at ~3 s) and is the only message', s.advice && s.state === 'advice', JSON.stringify(s));
    await wait(8000); s = await S(); t('A13 advice hides itself after ~7 s', !s.advice && s.state === 'none', JSON.stringify(s));
    await adviceOn(''); await wait(700); await adviceOn('Your mic is a little quiet. Move closer.'); await wait(4000);
    s = await S(); t('A14 the same advice is not repeated within 90 s', !s.advice, JSON.stringify(s));
    await adviceOn(''); await wait(700); await wait(95000); await adviceOn('Your mic is a little quiet. Move closer.'); await wait(4000);
    s = await S(); t('A15 ...but is allowed again after 90 s', s.advice, JSON.stringify(s));
    await ctx.close();
  }

  // ------------------------------------------------------------------ Part B: the real studio
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, permissions: ['camera', 'microphone'] });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
    await p.goto(base + '/studio.html'); await p.waitForTimeout(1200);
    await p.getByText('Continue without an account').click().catch(() => {}); await p.waitForTimeout(2500);
    let has = false;                                   // the guest sign-in can reload the page: retry until it settles
    for (let k = 0; k < 8 && !has; k++) { try { await p.waitForLoadState('load'); has = await p.evaluate(() => !!(window.VS && window.VS.stageCalm)); } catch (e) { await p.waitForTimeout(800); } }
    t('B0 studio opens (guest) and has the coordinator', has, p.url());
    await p.click('#startBtn'); await p.waitForTimeout(1500);
    const sample = () => p.evaluate(() => {
      const d = (el) => { if (!el) return false; const r = el.getBoundingClientRect(), c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05; };
      const f = document.getElementById('previewFrame');
      const adv = f.querySelector('.ux-advice');
      const ban = document.getElementById('degradeBanner');
      return { loading: d(f.querySelector('.stage-loading')), banner: d(ban) && ban.classList.contains('show'), advice: d(adv) && !adv.hidden && !!adv.textContent.trim(),
               goodChips: [...f.querySelectorAll('.ux-chip')].filter((c) => c.dataset.tone === 'good' && d(c)).length, state: f.getAttribute('data-stage-msg') };
    });
    let maxStack = 0, goodShown = 0, seen = new Set(); const rows = [];
    for (let i = 0; i < 40; i++) {
      const s = await sample(); const n = [s.loading, s.banner, s.advice].filter(Boolean).length;
      maxStack = Math.max(maxStack, n); goodShown += s.goodChips; seen.add(s.state); rows.push(s.state + ':' + n);
      await p.waitForTimeout(750);
    }
    t('B1 never more than ONE of loading / performance banner / advice visible at once (40 samples, 30 s)', maxStack <= 1, 'max=' + maxStack + ' states seen=' + [...seen].join(','));
    t('B2 no "Good" chip is ever shown', goodShown === 0, 'good chips seen=' + goodShown);
    t('B3 no page errors', errs.length === 0, errs.join(' ; '));
    if (process.env.SHOT) { const c = await ctx.newCDPSession(p); const r = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(process.env.SHOT, Buffer.from(r.data, 'base64')); console.log('screenshot ->', process.env.SHOT); }
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log(bad ? ('FAILED: ' + bad) : 'ALL PASS');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
