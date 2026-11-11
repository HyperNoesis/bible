// Unit: VS.MaskClean (v0.64). Run: node tools/e2e/unit_maskclean.js
const path = require('path'); global.self = global; global.VS = {};
require(path.join(__dirname, '..', '..', 'js', 'providers', 'mask-clean.js'));
const C = global.VS.MaskClean; let bad = 0;
const ok = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
const W = 200, H = 120;
function person() { const a = new Uint8Array(W * H); for (let y = 20; y < 110; y++) for (let x = 60; x < 140; x++) { const dx = (x - 100) / 40, dy = (y - 60) / 45; if (dx * dx + dy * dy < 1 || y > 90) a[y * W + x] = 255; } return a; }
const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] > 127 ? 1 : 0; return s; };
let a = person(); const before = sum(a); const copy = Uint8Array.from(a);
let st = C.clean(a, W, H); ok('a clean person is left exactly unchanged', a.every((v, i) => v === copy[i]), st);
a = person(); for (let y = 5; y < 9; y++) for (let x = 10; x < 14; x++) a[y * W + x] = 255; for (let y = 100; y < 103; y++) for (let x = 170; x < 175; x++) a[y * W + x] = 255;
st = C.clean(a, W, H); ok('two small detached specks are removed', sum(a) === before && st.specks === 2, st);
a = person(); for (let y = 50; y < 54; y++) for (let x = 95; x < 99; x++) a[y * W + x] = 0; const hole0 = sum(a);
st = C.clean(a, W, H); ok('a small enclosed hole in the body is filled', sum(a) === before && st.holes === 1, { holes: st.holes, was: hole0, now: sum(a), want: before });
a = person(); for (let y = 30; y < 90; y++) for (let x = 150; x < 190; x++) a[y * W + x] = 255; const two = sum(a);
st = C.clean(a, W, H); ok('a second person (large piece) is kept', sum(a) === two, st);
a = person(); for (let y = 40; y < 80; y++) for (let x = 90; x < 112; x++) a[y * W + x] = 0; const big = sum(a);
st = C.clean(a, W, H); ok('a big gap (e.g. a hand in front of the face) is NOT filled', sum(a) === big, st);
a = new Uint8Array(W * H); st = C.clean(a, W, H); ok('empty mask is fine', sum(a) === 0);
a = person(); for (let x = 60; x < 140; x++) a[19 * W + x] = 90; copy.set(a);
C.clean(a, W, H); ok('soft edge values of the kept body are untouched', a.every((v, i) => v === copy[i]));
const t0 = Date.now(); const big2 = new Uint8Array(448 * 256).fill(255); for (let i = 0; i < 20; i++) C.clean(big2, 448, 256); ok('fast enough (< 15 ms per 448x256 mask)', (Date.now() - t0) / 20 < 15, (Date.now() - t0) / 20);
process.exit(bad ? 1 : 0);
