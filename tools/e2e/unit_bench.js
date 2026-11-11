// Unit: speed-test statistics, verdict freshness and phone thread cap (v0.62). Run: node tools/e2e/unit_bench.js
const path = require('path'); global.self = global; global.window = global; global.VS = {};
require(path.join(__dirname, '..', '..', 'js', 'providers', 'perf-profile.js'));
const P = global.VS.PerfProfile; let bad = 0;
const ok = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
// one hitch in an otherwise fast run must not look slow (the real report: 810 ms measured, true speed far lower)
ok('one slow hitch does not decide the result', P.lowQuartile([55, 52, 800, 54, 53, 58]) < 70, P.lowQuartile([55, 52, 800, 54, 53, 58]));
ok('a genuinely slow device still reads slow', P.lowQuartile([210, 190, 230, 205, 220, 215]) > 150);
ok('empty and junk samples -> 0', P.lowQuartile([]) === 0 && P.lowQuartile([NaN, undefined]) === 0);
ok('single sample is used', P.lowQuartile([42]) === 42);
const now = 1e12;
ok('fresh verdict (1 h old) is trusted', P.benchFresh({ at: now - 3600e3 }, now));
ok('old verdict (7 h) expires', !P.benchFresh({ at: now - 7 * 3600e3 }, now));
ok('verdict without timestamp / future timestamp is not trusted', !P.benchFresh({}, now) && !P.benchFresh({ at: now + 1e6 }, now) && !P.benchFresh(null, now));
ok('8-core phone, isolated -> 2 threads', P.wasmThreads(8, true, true, false) === 2);
ok('8-core desktop, isolated -> 4 threads', P.wasmThreads(8, true, false, false) === 4);
ok('not isolated -> 1 thread', P.wasmThreads(8, false, false, false) === 1);
ok('vs_threads=1 forces 1', P.wasmThreads(8, true, false, true) === 1);
ok('2-core phone -> 1 thread', P.wasmThreads(2, true, true, false) === 1);
ok('unknown core count is safe', P.wasmThreads(undefined, true, true, false) >= 1);
process.exit(bad ? 1 : 0);
