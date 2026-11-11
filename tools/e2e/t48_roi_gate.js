// v0.80 gate: REAL MODNet (worker, offline) with the person crop on vs off. A person ~50% of the frame walks to the right.
// Checks: crop activates; mask keeps the camera's aspect (the app relies on it); crop is not worse than no crop vs the model's own 512 px reference;
// the person stays tracked while moving; vs_roi=0 really turns it off. Needs the server: cd /tmp/srv && python3 -m http.server 8123 (same shell).
const { launch } = require('./pwlib');
(async () => {
  const { browser, ctx } = await launch(); const out = []; const ok = (n, c, x) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + JSON.stringify(x)));
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem('vs_autostart', '0'));
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForTimeout(2500);
  const r = await page.evaluate(async () => {
    const load = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
    const imgs = []; for (let k = 0; k < 6; k++) imgs.push(await load('/fx/small' + k + '.png'));
    const W = 480, H = 270;
    const cv = (img) => { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(img, 0, 0); c.videoWidth = W; c.videoHeight = H; return c; };
    const alphaOf = (mask, w, h) => { const k = document.createElement('canvas'); k.width = w; k.height = h; const x = k.getContext('2d', { willReadFrequently: true }); x.drawImage(mask, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data, a = new Float32Array(w * h); for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3] / 255; return a; };
    const SW = 240, SH = 135;
    // reference = the model's own best: full frame, 512 px, no crop
    const ref = new window.VS.MODNetWorkerProvider(); ref.useRoi = false; await ref.initialize('quality'); ref.longEdge = 512;
    const refA = []; for (const im of imgs) { const m = await ref.segment(cv(im)); refA.push(alphaOf(m.segmentationMask, SW, SH)); }
    ref.dispose();
    const run = async (useRoi) => {
      const p = new window.VS.MODNetWorkerProvider(); p.useRoi = useRoi; await p.initialize('fast'); p.longEdge = 256;   // a weak device's size
      const res = []; let aspectOk = true, actives = 0, ms = [];
      const SEQ = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1];   // walks right then back: no teleports
      for (let rep = 0; rep < 3; rep++) for (const k of SEQ) {
        const c = cv(imgs[k]); const t0 = performance.now(); const m = await p.segment(c); ms.push(performance.now() - t0);
        const mw = m.segmentationMask.width, mh = m.segmentationMask.height; if (Math.abs(mw / mh - W / H) > 0.2) aspectOk = false;   // the app converts crops per axis, so the baseline (multiples of 32) is not exact either
        if (p.roiInfo && p.roiInfo.active) actives++;
        if (rep === 2) { const a = alphaOf(m.segmentationMask, SW, SH); let inter = 0, uni = 0, err = 0, n = 0; for (let i = 0; i < SW * SH; i++) { const x = a[i] > 0.5, y = refA[k][i] > 0.5; if (x && y) inter++; if (x || y) uni++; if (refA[k][i] > 0.02 && refA[k][i] < 0.98 || x !== y) { err += Math.abs(a[i] - refA[k][i]); n++; } } res.push({ iou: inter / Math.max(1, uni), edgeErr: err / Math.max(1, n) }); }
      }
      const info = { active: p.roiInfo && p.roiInfo.active, box: p.roiInfo && p.roiInfo.box };
      p.dispose(); const mean = (f) => res.reduce((s, x) => s + x[f], 0) / res.length;
      return { iou: mean('iou'), edgeErr: mean('edgeErr'), aspectOk, actives, info, msMed: ms.sort((a, b) => a - b)[Math.floor(ms.length / 2)], per: res.map((x) => +x.iou.toFixed(3)) };
    };
    const off = await run(false), on = await run(true);
    localStorage.setItem('vs_roi', '0'); const killed = !window.VS.MODNetSegmentationProvider.roiAllowed(); localStorage.removeItem('vs_roi');
    return { off, on, killed };
  });
  ok('crop is off when switched off (vs_roi=0 kill switch)', r.killed, r);
  ok('no crop: never active', r.off.actives === 0, r.off);
  ok('crop activates for a small person', r.on.actives > 0 && r.on.info.active, r.on);
  ok('mask keeps the camera aspect ratio (app relies on it)', r.on.aspectOk, r.on);
  ok('crop is not worse than no crop (IoU vs 512 px reference)', r.on.iou >= r.off.iou - 0.01, { on: r.on.iou, off: r.off.iou });
  ok('person stays tracked while walking (every frame IoU >= 0.5)', Math.min(...r.on.per) >= 0.5, r.on.per);
  ok('crop does not lose edge accuracy vs no crop', r.on.edgeErr <= r.off.edgeErr + 0.02, { on: r.on.edgeErr, off: r.off.edgeErr });
  ok('no page errors', errs.filter((e) => !/MediaPipeSegmentationProvider|ERR_FAILED/.test(e)).length === 0, errs);
  console.log(out.join('\n')); console.log('info:', JSON.stringify(r)); await browser.close(); process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})();
