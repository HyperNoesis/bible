// Node unit test for the camera-aware ladder (v0.80). Run: node tools/e2e/unit_ladder_cam.js
const vm = require('vm'), fs = require('fs'), path = require('path');
const ctx = { self: {} }; ctx.self = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/providers/perf-profile.js'), 'utf8'), ctx);
const P = ctx.VS.PerfProfile; let bad = 0;
const t = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log((ok ? 'PASS ' : 'FAIL ') + n + ' -> ' + got); };
// THE BUG: dim room, webcam delivers 12 fps, model takes 30 ms. Output is 12 fps (the camera's rate). Old rule: step down. New rule: hold.
t('camera-bound (12 fps cam, 12 fps out, fast model) holds', P.decideLadderStep({ rung: 0, fps: 12, camFps: 12, segMs: 30, lowSeconds: 20 }).action, 'hold');
t('camera dips to 9 fps but the model takes 30 ms: still camera-bound, says why', P.decideLadderStep({ rung: 0, fps: 9, camFps: 12, segMs: 30, lowSeconds: 20 }).reason, 'camera-bound');
t('camera-bound at 8 fps cam holds', P.decideLadderStep({ rung: 1, fps: 8, camFps: 8, segMs: 60, lowSeconds: 30 }).action, 'hold');
t('old rule (no camFps) would still step down', P.decideLadderStep({ rung: 0, fps: 12, lowSeconds: 20 }).action, 'step-down');
// model-bound: 30 fps camera, we output 9 fps, one mask takes 105 ms
t('model-bound steps down', P.decideLadderStep({ rung: 0, fps: 9, camFps: 30, segMs: 105, lowSeconds: 8 }).action, 'step-down');
t('model-bound needs 8 s, not 4', P.decideLadderStep({ rung: 0, fps: 9, camFps: 30, segMs: 105, lowSeconds: 5 }).action, 'hold');
t('model fast but output slow (render/tab) holds', P.decideLadderStep({ rung: 0, fps: 9, camFps: 30, segMs: 12, lowSeconds: 20 }).action, 'hold');
t('  ...reason', P.decideLadderStep({ rung: 0, fps: 9, camFps: 30, segMs: 12, lowSeconds: 20 }).reason, 'camera-bound');
// never leave matting for the blocky model while the smallest matting size is fine
t('256 -> light model refused when a mask takes 90 ms', P.decideLadderStep({ rung: 1, fps: 9, camFps: 30, segMs: 90, lowSeconds: 20 }).action, 'hold');
t('  ...reason', P.decideLadderStep({ rung: 1, fps: 9, camFps: 30, segMs: 90, lowSeconds: 20 }).reason, 'smallest-matting-ok');
t('256 -> light model allowed only when a mask needs >= 150 ms', P.decideLadderStep({ rung: 1, fps: 5, camFps: 30, segMs: 170, lowSeconds: 20 }).action, 'step-down');
t('256 -> light model refused when segMs unknown', P.decideLadderStep({ rung: 1, fps: 5, camFps: 30, lowSeconds: 20 }).action, 'hold');
t('still never changes engine while recording', P.decideLadderStep({ rung: 1, fps: 5, camFps: 30, segMs: 170, lowSeconds: 20, busy: true }).action, 'wait-busy');
// modelIsBottleneck
t('bottleneck: out near cam rate -> false', P.modelIsBottleneck({ fps: 14, camFps: 15, segMs: 80 }), false);
t('bottleneck: out far below cam, slow mask -> true', P.modelIsBottleneck({ fps: 8, camFps: 30, segMs: 100 }), true);
t('bottleneck: unknown cam, slow mask -> true', P.modelIsBottleneck({ fps: 8, segMs: 100 }), true);
t('bottleneck: no fps -> false', P.modelIsBottleneck({ fps: 0, camFps: 30, segMs: 100 }), false);
process.exit(bad ? 1 : 0);
