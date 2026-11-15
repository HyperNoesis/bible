// Regression: high-confidence, thin hair wisps near the person must not be deleted as isolated specks.
// The old cleaner removed every detached wisp in this controlled model-mask test.
const fs = require('fs'), path = require('path');
global.self = global; global.VS = {};
require(path.join(__dirname, '..', '..', 'js', 'providers', 'mask-clean.js'));
const clean = global.VS.MaskClean.clean;
let bad = 0;
const t = (name, pass, detail) => { if (!pass) bad++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : ' ' + JSON.stringify(detail))); };
const W = 448, H = 256, N = W * H;
const alpha = new Uint8Array(N), hair = new Uint8Array(N), softHair = new Uint8Array(N), body = new Uint8Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const dx = (x - 224) / 78, dy = (y - 112) / 88;
  if (dx * dx + dy * dy <= 1) { alpha[y * W + x] = 255; body[y * W + x] = 1; }
}
let seed = 777;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function line(x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1, err = dx + dy;
  for (;;) {
    if (x0 >= 0 && x0 < W && y0 >= 0 && y0 < H && !body[y0 * W + x0]) {
      alpha[y0 * W + x0] = 230; hair[y0 * W + x0] = 1;
      // A neighbouring soft-alpha pixel simulates antialiased fringe around a fine strand.
      const qx = x0 + (Math.abs(dy) > Math.abs(dx) ? 1 : 0), qy = y0;
      if (qx < W && !body[qy * W + qx] && alpha[qy * W + qx] < 80) { alpha[qy * W + qx] = 80; softHair[qy * W + qx] = 1; }
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
for (let k = 0; k < 70; k++) {
  const ang = Math.PI * (1.12 + 0.76 * rnd()), len = 8 + 18 * rnd();
  const x0 = Math.round(224 + 80 * Math.cos(ang)), y0 = Math.round(112 + 90 * Math.sin(ang));
  const gx = Math.round(x0 + Math.cos(ang) * 3), gy = Math.round(y0 + Math.sin(ang) * 3);
  const ex = Math.round(x0 + Math.cos(ang) * len), ey = Math.round(y0 + Math.sin(ang) * len);
  line(gx, gy, ex, ey);
}
// A nearby square speck and a distant thin line are noise, not hair.
for (let y = 205; y < 209; y++) for (let x = 220; x < 224; x++) alpha[y * W + x] = 255;
for (let x = 12; x < 30; x++) alpha[12 * W + x] = 255;
const countHair = () => { let n = 0; for (let i = 0; i < N; i++) if (hair[i] && alpha[i] >= 128) n++; return n; };
// Count only fringe samples that remain soft after all strands have been drawn; later strands can overlap them.
for (let i = 0; i < N; i++) if (softHair[i] && alpha[i] !== 80) softHair[i] = 0;
const hairBefore = countHair();
const softBefore = softHair.reduce((n, v) => n + v, 0);
const stats = clean(alpha, W, H);
const hairAfter = countHair();
const softAfter = softHair.reduce((n, v, i) => n + (v && alpha[i] === 80 ? 1 : 0), 0);
t('preserves at least 95% of 70 thin detached hair wisps', hairAfter >= hairBefore * 0.95, { before: hairBefore, after: hairAfter, retention: +(hairAfter / hairBefore).toFixed(4), wispsKept: stats.wispsKept });
t('preserves at least 95% of soft anti-aliased hair fringe', softAfter >= softBefore * 0.95, { before: softBefore, after: softAfter, retention: softBefore ? +(softAfter / softBefore).toFixed(4) : 1 });
let squareEmpty = true; for (let y = 205; y < 209; y++) for (let x = 220; x < 224; x++) if (alpha[y * W + x] !== 0) squareEmpty = false;
t('keeps nearby hair-like pieces but still removes the nearby square speck', squareEmpty, stats);
t('removes a distant thin noise line', Array.from(alpha.slice(12 * W + 12, 12 * W + 30)).every(v => v === 0));
// Existing cleaner behaviours must remain: keep the solid body and fill small enclosed holes.
let hole = Uint8Array.from(body, v => v ? 255 : 0);
for (let y = 105; y < 109; y++) for (let x = 220; x < 224; x++) hole[y * W + x] = 0;
const holeStats = clean(hole, W, H);
t('still fills a small enclosed hole', holeStats.holes === 1 && hole[106 * W + 221] === 255, holeStats);
process.exit(bad ? 1 : 0);
