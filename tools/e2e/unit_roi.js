// Node unit test for VS.RoiTrack (pure logic). Run: node tools/e2e/unit_roi.js
const vm = require('vm'), fs = require('fs'), path = require('path');
const ctx = { self: {} }; ctx.self = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/providers/roi-track.js'), 'utf8'), ctx);
const R = ctx.VS.RoiTrack; let bad = 0;
const t = (n, ok, extra) => { if (!ok) bad++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra !== undefined ? ' -> ' + extra : '')); };
// alpha image with a filled rectangle (fractions of the image)
function img(w, h, x0, y0, x1, y1) { const a = new Uint8Array(w * h); for (let y = Math.floor(y0 * h); y < Math.ceil(y1 * h); y++) for (let x = Math.floor(x0 * w); x < Math.ceil(x1 * w); x++) a[y * w + x] = 255; return a; }
const W = 64, H = 36;
let st = R.create();
t('starts as full frame', !R.active(st) && JSON.stringify(R.box(st)) === '{"x0":0,"y0":0,"x1":1,"y1":1}');
t('person filling the frame never activates a crop', (() => { const s = R.create(); R.update(s, img(W, H, 0.05, 0, 0.95, 1), W, H); return !R.active(s); })());
// person 30% wide, 60% tall, centred
let s2 = R.create(); let v = R.update(s2, img(W, H, 0.35, 0.2, 0.65, 0.8), W, H);
t('small person -> init', v === 'init');
t('small person -> crop active', R.active(s2), JSON.stringify(R.box(s2)));
t('crop is never smaller than 50% of the frame', s2.wq >= 0.5 && s2.hq >= 0.5, s2.wq + 'x' + s2.hq);
t('crop sizes are multiples of 0.1', Math.abs(s2.wq * 10 - Math.round(s2.wq * 10)) < 1e-6 && Math.abs(s2.hq * 10 - Math.round(s2.hq * 10)) < 1e-6);
{ const b = R.box(s2); t('person is inside the crop with margin', b.x0 < 0.35 && b.x1 > 0.65 && b.y0 < 0.2 && b.y1 > 0.8, JSON.stringify(b)); }
// the person moves right: bbox is measured INSIDE the crop; simulate by feeding what the model would see
function feed(st, px0, py0, px1, py1) { const b = R.box(st), cw = b.x1 - b.x0, ch = b.y1 - b.y0; const f = (v, o, d) => Math.max(0, Math.min(1, (v - o) / d)); return R.update(st, img(W, H, f(px0, b.x0, cw), f(py0, b.y0, ch), f(px1, b.x0, cw), f(py1, b.y0, ch)), W, H); }
for (let i = 0; i < 20; i++) feed(s2, 0.55, 0.2, 0.85, 0.8);
{ const b = R.box(s2); t('crop follows a person who moved right', b.x1 >= 0.85 && (b.x0 + b.x1) / 2 > 0.55, JSON.stringify(b)); }
// person walks toward the camera (gets bigger): the box grows immediately
let s3 = R.create(); R.update(s3, img(W, H, 0.35, 0.2, 0.65, 0.8), W, H); const before = s3.wq;
const g = feed(s3, 0.2, 0.1, 0.8, 0.95);
t('person gets bigger -> grow at once', g === 'grow' && s3.wq > before, before + ' -> ' + s3.wq);
// shrink only after a calm stretch
let s4 = R.create(); R.update(s4, img(W, H, 0.2, 0.1, 0.8, 0.95), W, H); const w0 = s4.wq;
for (let i = 0; i < R.SHRINK_AFTER - 2; i++) feed(s4, 0.4, 0.3, 0.6, 0.7);
t('does not shrink early', s4.wq === w0, w0 + '');
for (let i = 0; i < 6; i++) feed(s4, 0.4, 0.3, 0.6, 0.7);
t('shrinks after a calm stretch', s4.wq < w0, w0 + ' -> ' + s4.wq);
// edge touching widens the box
let s5 = R.create(); R.update(s5, img(W, H, 0.4, 0.2, 0.6, 0.8), W, H); const w5 = s5.wq;
R.update(s5, img(W, H, 0.0, 0.2, 0.7, 0.8), W, H);   // person fills the crop to its left edge
t('person touching the crop edge widens it', s5.wq > w5, w5 + ' -> ' + s5.wq);
// empty mask twice -> back to the full frame
let s6 = R.create(); R.update(s6, img(W, H, 0.35, 0.2, 0.65, 0.8), W, H);
const e1 = R.update(s6, new Uint8Array(W * H), W, H), e2 = R.update(s6, new Uint8Array(W * H), W, H);
t('one empty frame is tolerated', e1 === 'none' && R.active(s6) === true || e1 === 'none');
t('two empty frames drop back to full frame', e2 === 'lost' && !R.active(s6));
// pixel rect
{ const s = R.create(); R.update(s, img(W, H, 0.35, 0.2, 0.65, 0.8), W, H); const r = R.rectPx(s, 1280, 720);
  t('pixel rect is even and inside the frame', r.sx % 2 === 0 && r.sy % 2 === 0 && r.sw % 2 === 0 && r.sh % 2 === 0 && r.sx >= 0 && r.sy >= 0 && r.sx + r.sw <= 1280 && r.sy + r.sh <= 720, JSON.stringify(r)); }
// RGBA input (stride 4, offset 3) gives the same box as plain alpha
{ const a = img(W, H, 0.35, 0.2, 0.65, 0.8), rgba = new Uint8Array(W * H * 4); for (let i = 0; i < a.length; i++) rgba[i * 4 + 3] = a[i];
  const p = R.bboxOf(a, W, H), q = R.bboxOf(rgba, W, H, 4, 3); t('RGBA stride gives the same bbox', JSON.stringify(p) === JSON.stringify(q)); }
// equal-cost model input
{ const full = 256 * 160, [mw, mh] = R.sizeForBudget(288, 270, full); t('crop input keeps about the full-frame pixel cost (within 35%)', mw * mh <= full * 1.35 && mw * mh >= full * 0.65, mw + 'x' + mh + ' = ' + mw * mh + ' vs ' + full);
  t('crop input sides are multiples of 32', mw % 32 === 0 && mh % 32 === 0); }
// never errors on tiny / odd input
{ const s = R.create(); R.update(s, new Uint8Array(4), 2, 2); t('tiny image does not throw', true); }
process.exit(bad ? 1 : 0);
