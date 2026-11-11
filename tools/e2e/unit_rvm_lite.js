// Unit: RVMWorkerProvider pure maths (input size multiples of 16, downsample rule) and that the worker uses the same rule.
const fs = require('fs'), path = require('path'); const R = path.resolve(__dirname, '..', '..');
global.window = { VS: { MODNetWorkerProvider: class {} } };
const src = fs.readFileSync(path.join(R, 'js/providers/rvm-lite-provider.js'), 'utf8').replace('const RVM_LITE', 'var RVM_LITE').replace('class RVMWorkerProvider', 'var RVMWorkerProvider = class RVMWorkerProvider');
(0, eval)(src); const P = window.VS.RVMWorkerProvider; let bad = 0;
const t = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
t('640x480 @448 -> 448x336', JSON.stringify(P.sizeFor(640, 480, 448)) === '[448,336]', P.sizeFor(640, 480, 448));
t('portrait 480x640 @256 -> 192x256', JSON.stringify(P.sizeFor(480, 640, 256)) === '[192,256]', P.sizeFor(480, 640, 256));
t('never upscales (320x240 @448 stays 320x240)', JSON.stringify(P.sizeFor(320, 240, 448)) === '[320,240]');
t('all sizes are multiples of 16', [[1280, 720, 320], [1920, 1080, 448], [640, 360, 256], [500, 700, 320]].every(([w, h, e]) => P.sizeFor(w, h, e).every((v) => v % 16 === 0)));
t('downsample 448 -> 0.375, small inputs -> 1', P.downsampleFor(448, 336) === 0.375 && P.downsampleFor(160, 120) === 1);
const wk = fs.readFileSync(path.join(R, 'js/providers/rvm-worker.js'), 'utf8');
t('worker uses the same downsample rule (168 / long edge)', /Math\.min\(1, 168 \/ Math\.max\(w, h\)\)/.test(wk));
t('worker checks the model has the RVM inputs', /'src', 'downsample_ratio'/.test(wk));
t('worker is WASM-only', /executionProviders: \['wasm'\]/.test(wk));
process.exit(bad ? 1 : 0);
