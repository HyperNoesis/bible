// Edge-quality measurement for the GL matte (js/providers/gl-matte.js), on a SYNTHETIC person with known ground truth.
// The frame is built as C = a*F + (1-a)*B (pale-green wall B, striped skin/shirt F). The "model mask" is the ground truth,
// downsampled and blurred (what a small segmenter roughly gives). Two scenarios:
//   clean  low sensor noise, accurate mask edge
//   hard   heavy sensor noise AND an over-inclusive mask (the model's edge sits a few px outside the real one: the usual halo)
//   lowc   person colour almost the same as the wall, over-inclusive mask: colour tricks must NOT make things worse here
// Metrics, measured in a FIXED band (within 8 px of the true edge, so a softer edge cannot hide). Lower is better.
//   alphaMAE  mean |alpha_out - alpha_true|
//   jagged    mean |step| of the alpha error between neighbouring pixels (blocky staircase edges show up here)
//   bleed     mean |unpremultiplied colour - true foreground colour| where alpha_out > 0.5 (background colour leaking into the edge)
//   compMAE   error of the person composited over a NEW (blue) background, vs the ideal composite
// SYNTHETIC ONLY: it does not replace looking at a real person on a real phone.
// Usage: node tools/e2e/t49_matte_edge_gate.js          prints metrics, asserts matte_edge_gates.json
//        MATTE_JS=/path/other-gl-matte.js node ...   measure another version (e.g. the baseline)
//        MATTE_PARAMS='{"sigmaR":0.1}' node ...      override matte fields (for tuning)
//        node ... --report                           print only, never fail
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PW_LIB || '/home/claude/.npm-global/lib/node_modules/playwright');
const MATTE = process.env.MATTE_JS || path.resolve(__dirname, '..', '..', 'js', 'providers', 'gl-matte.js');
const REPORT_ONLY = process.argv.includes('--report');
const PARAMS = JSON.parse(process.env.MATTE_PARAMS || '{}');
const GATES = JSON.parse(fs.readFileSync(path.join(__dirname, 'matte_edge_gates.json'), 'utf8'));

(async () => {
  const exe = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: MATTE });
  const res = await page.evaluate(async (PARAMS) => {
    const W = 1280, H = 720;
    let F0 = [205, 150, 125]; const B0 = [115, 185, 125], BN = [40, 40, 170];
    const gtC = document.createElement('canvas'); gtC.width = W; gtC.height = H;
    const g = gtC.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(640, 270, 150, 190, 0, 0, Math.PI * 2); g.fill();                 // head
    g.beginPath(); g.ellipse(640, 760, 400, 270, 0, 0, Math.PI * 2); g.fill();                 // shoulders
    g.save(); g.translate(1010, 420); g.rotate(0.55); g.fillRect(-45, -170, 90, 340); g.restore(); // diagonal arm
    const gd = g.getImageData(0, 0, W, H).data;
    const gtA = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) gtA[i] = gd[i * 4] / 255;
    const Fat = (x, y) => { const s = (((x + y) >> 5) & 1) ? 12 : -12; return [F0[0] + s, F0[1] + s * 0.7, F0[2] + s * 0.5]; };
    const Bat = (x, y) => { const k = (x / W - 0.5) * 16; return [B0[0] + k, B0[1] - k * 0.5, B0[2] + k * 0.3]; };
    const makeFrame = (noise) => {
      let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.7;
      const frame = document.createElement('canvas'); frame.width = W; frame.height = H;
      const fx = frame.getContext('2d'); const fim = fx.createImageData(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, a = gtA[i], F = Fat(x, y), B = Bat(x, y);
        for (let c = 0; c < 3; c++) fim.data[i * 4 + c] = Math.max(0, Math.min(255, a * F[c] + (1 - a) * B[c] + gauss() * noise));
        fim.data[i * 4 + 3] = 255;
      }
      fx.putImageData(fim, 0, 0);
      return frame;
    };
    // fixed band: every pixel within RB px of the true edge
    const RB = 8, e0 = new Uint8Array(W * H), tmp = new Uint8Array(W * H), band = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) if (gtA[i] > 0.01 && gtA[i] < 0.99) e0[i] = 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let f = 0; for (let k = -RB; k <= RB && !f; k++) { const xx = x + k; if (xx >= 0 && xx < W && e0[y * W + xx]) f = 1; } tmp[y * W + x] = f; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let f = 0; for (let k = -RB; k <= RB && !f; k++) { const yy = y + k; if (yy >= 0 && yy < H && tmp[yy * W + x]) f = 1; } band[y * W + x] = f; }

    const out = {};
    const scenarios = [{ name: 'clean', noise: 1.2, halo: false }, { name: 'hard', noise: 6, halo: true }, { name: 'lowc', noise: 3, halo: true, f0: [100, 170, 120] }];   // lowc: person colour almost equal to the wall
    for (const sc of scenarios) {
      F0 = sc.f0 || [205, 150, 125];
      const frame = makeFrame(sc.noise);
      for (const MW of [256, 160]) {
        const MH = Math.round(MW * H / W);
        const mc = document.createElement('canvas'); mc.width = MW; mc.height = MH;
        const mt = mc.getContext('2d', { willReadFrequently: true });
        mt.imageSmoothingQuality = 'high'; mt.filter = 'blur(1.2px)'; mt.drawImage(gtC, 0, 0, MW, MH); mt.filter = 'none';
        const md = mt.getImageData(0, 0, MW, MH); const mo = mt.createImageData(MW, MH);
        for (let i = 0; i < MW * MH; i++) {
          let v = md.data[i * 4] / 255;
          if (sc.halo) v = Math.min(1, v * 3);      // model edge sits outside the real one
          mo.data[i * 4] = 255; mo.data[i * 4 + 1] = 255; mo.data[i * 4 + 2] = 255; mo.data[i * 4 + 3] = Math.round(v * 255);
        }
        mt.putImageData(mo, 0, 0);
        const m = new VS.GLMatte();
        if (!m.ok) return { error: m.error };
        Object.assign(m, PARAMS);
        for (let k = 0; k < 4; k++) m.process(frame, mc, W, H);   // static scene: temporal state settles
        const gl = m.gl, px = new Uint8Array(W * H * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        // readPixels row 0 is the bottom: flip to image order. Output is premultiplied.
        const A = new Float32Array(W * H), R = new Float32Array(W * H * 3);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const s = ((H - 1 - y) * W + x) * 4, i = y * W + x;
          R[i * 3] = px[s]; R[i * 3 + 1] = px[s + 1]; R[i * 3 + 2] = px[s + 2]; A[i] = px[s + 3] / 255;
        }
        let n = 0, aSum = 0, cSum = 0, bN = 0, bSum = 0, jN = 0, jSum = 0;
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const i = y * W + x; if (!band[i]) continue;
          n++; aSum += Math.abs(A[i] - gtA[i]);
          const F = Fat(x, y);
          let ce = 0; for (let c = 0; c < 3; c++) { const comp = R[i * 3 + c] + (1 - A[i]) * BN[c], ideal = gtA[i] * F[c] + (1 - gtA[i]) * BN[c]; ce += Math.abs(comp - ideal); }
          cSum += ce / 3;
          if (A[i] > 0.5) { let be = 0; for (let c = 0; c < 3; c++) be += Math.abs(R[i * 3 + c] / A[i] - F[c]); bSum += be / 3; bN++; }
          const e = A[i] - gtA[i], ex = A[i + 1] - gtA[i + 1], ey = A[i + W] - gtA[i + W];
          jSum += Math.abs(ex - e) + Math.abs(ey - e); jN += 2;
        }
        out[sc.name + '-' + MW] = { alphaMAE: aSum / n, jagged: jSum / jN, bleed: bN ? bSum / bN : 0, compMAE: cSum / n };
      }
    }
    return out;
  }, PARAMS);
  await browser.close();
  if (res.error) { console.log('FAIL GLMatte did not start: ' + res.error); process.exit(1); }
  let bad = 0;
  for (const key of Object.keys(res)) {
    const r = res[key], G = GATES[key] || {};
    console.log(`${key.padEnd(10)} alphaMAE=${r.alphaMAE.toFixed(4)}  jagged=${r.jagged.toFixed(4)}  bleed=${r.bleed.toFixed(2)}  compMAE=${r.compMAE.toFixed(2)}`);
    for (const k of Object.keys(G)) { const pass = r[k] <= G[k]; if (!pass) bad++; if (!pass || process.env.VERBOSE) console.log(`  ${pass ? 'PASS' : 'FAIL'} ${key} ${k} ${r[k].toFixed(4)} <= ${G[k]}`); }
  }
  if (!REPORT_ONLY) console.log(bad ? `FAIL ${bad} gate(s)` : 'PASS all matte edge gates');
  if (errs.length) console.log('page errors:', errs.slice(0, 3));
  process.exit(REPORT_ONLY || !bad ? 0 : 1);
})();
