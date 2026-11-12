// Unit: v0.84 emergency step-down. Replays a real phone report (Mali-G52, Android 10): MODNet 4758 ms per mask, FPS 0, recording in progress.
// Run: node tools/e2e/unit_ladder_hopeless.js
global.self = global; global.window = global; global.VS = global.VS || {};
require('../../js/providers/perf-profile.js');
const PP = global.VS.PerfProfile; let fails = 0;
const check = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
const base = { rung: 0, camFps: 30, segMs: 4758, lowSeconds: 4, busy: false };
check('fps 0 + slow mask now counts as model-bound', PP.modelIsBottleneck({ fps: 0, camFps: 30, segMs: 4758 }) === true);
check('fps 0 + fast mask is still NOT the model', PP.modelIsBottleneck({ fps: 0, camFps: 30, segMs: 20 }) === false);
let d = PP.decideLadderStep({ ...base, fps: 0 });
check('fps 0, 4.7 s mask -> straight to the light model', d.action === 'step-down' && d.rung.engine === 'mediapipe' && d.reason === 'hopeless');
d = PP.decideLadderStep({ ...base, fps: 0.2, busy: true });
check('recording does not trap a slideshow phone', d.action === 'step-down' && d.rung.engine === 'mediapipe');
d = PP.decideLadderStep({ ...base, fps: 0, lowSeconds: 1 });
check('needs a few seconds in a row first (no verdict on one bad frame)', d.action === 'hold');
d = PP.decideLadderStep({ ...base, fps: 0, segMs: 300, lowSeconds: 20 });
check('a 300 ms mask is NOT hopeless (old one-size-at-a-time rules apply)', d.reason !== 'hopeless');
d = PP.decideLadderStep({ ...base, rung: 2, fps: 0, lowSeconds: 20 });
check('already on the light model: nothing to do', d.action !== 'step-down' || d.rung.engine !== 'modnet');
d = PP.decideLadderStep({ rung: 0, fps: 30, camFps: 30, segMs: 40, lowSeconds: 0, busy: false });
check('a healthy device is left alone', d.action === 'hold');
process.exit(fails ? 1 : 0);
