// Node unit test for js/enhance-core.js. Run: node tools/e2e/unit_enhance.js
const vm = require('vm'), fs = require('fs'), path = require('path');
const ctx = { self: {} }; ctx.self = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/enhance-core.js'), 'utf8'), ctx);
const C = ctx.VS.EnhanceCore; let bad = 0; const t = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
t('default engine ships today (runner set, no WebGPU, no extra RAM)', C.availableModels({}).join() === 'modnet-hq');
t('BiRefNet / BEN2 are NOT offered even on a big WebGPU desktop (not measured/enabled)', C.availableModels({ webgpu: true, deviceMemory: 8 }).join() === 'modnet-hq');
t('every model records a licence + link', Object.values(C.MODELS).every((m) => m.licence && /^https:\/\/github\.com/.test(m.licenceUrl)));
t('licences are permissive (MIT/Apache only)', Object.values(C.MODELS).every((m) => /^(MIT|Apache-2\.0)$/.test(m.licence)));
t('plan: 10 s at 15 fps = 150 frames', C.plan(10, 15).frames === 150);
t('plan caps long clips', C.plan(600, 30).frames === 1800 && C.plan(600, 30).truncated === true);
t('plan never returns 0 frames', C.plan(0.01, 15).frames === 1);
t('resume finds first missing frame', C.nextFrameToDo([1, 1, 1, 0, 1], 5) === 3 && C.nextFrameToDo([1, 1], 2) === 2);
// smoothing: noisy static edge must flicker less; a real step (movement) must not be smeared
const W = 40, H = 20, N = 12, gt = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) gt[y * W + x] = x < 20 ? 255 : 0;
let seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const noisy = Array.from({ length: N }, () => { const m = new Uint8Array(W * H); for (let i = 0; i < m.length; i++) m[i] = Math.max(0, Math.min(255, gt[i] + (rnd() - 0.5) * 36)); return m; });
const sm = C.smoothBidirectional(noisy);
t('smoothing cuts flicker by > 40%', C.flicker(sm) < C.flicker(noisy) * 0.6, [+C.flicker(noisy).toFixed(2), +C.flicker(sm).toFixed(2)]);
t('smoothing keeps the edge location (error not worse)', C.edgeBandError(sm[5], gt, W, H, 2) <= C.edgeBandError(noisy[5], gt, W, H, 2) + 0.01);
const step = Array.from({ length: 8 }, (_, k) => { const m = new Uint8Array(W * H); for (let i = 0; i < m.length; i++) m[i] = (i % W) < (8 + k * 3) ? 255 : 0; return m; });
const ss = C.smoothBidirectional(step); let worst = 0; for (let k = 0; k < 8; k++) for (let i = 0; i < ss[k].length; i++) worst = Math.max(worst, Math.abs(ss[k][i] - step[k][i]));
t('real motion passes through (no ghost trail, max pixel change <= 40)', worst <= 40, worst);
t('single frame returns a copy', C.smoothBidirectional([noisy[0]])[0] !== noisy[0]);
process.exit(bad ? 1 : 0);
