// Node unit test for VS.Flags (remote switches). Run: node tools/e2e/unit_flags.js
const vm = require('vm'), fs = require('fs'), path = require('path');
const ctx = { self: {} }; ctx.self = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/flags.js'), 'utf8'), ctx);
const F = ctx.VS.Flags; let bad = 0;
const t = (n, ok, extra) => { if (!ok) bad++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra !== undefined ? ' -> ' + extra : '')); };
(async () => {
  t('defaults: colourSnap 0.8', F.get('colourSnap') === 0.8);
  t('sanitize keeps a valid number', F.sanitize({ colourSnap: 0.3 }).colourSnap === 0.3);
  t('sanitize clamps high values to 1', F.sanitize({ colourSnap: 7 }).colourSnap === 1);
  t('sanitize clamps negatives to 0', F.sanitize({ colourSnap: -2 }).colourSnap === 0);
  t('sanitize ignores strings, NaN, null and unknown keys', Object.keys(F.sanitize({ colourSnap: '0.5', other: 1 })).length === 0 && Object.keys(F.sanitize({ colourSnap: NaN })).length === 0 && Object.keys(F.sanitize(null)).length === 0 && Object.keys(F.sanitize('x')).length === 0);
  const ok = (j) => () => Promise.resolve({ ok: true, json: () => Promise.resolve(j) });
  let r = await F.load(ok({ colourSnap: 0 }), 500);
  t('load applies a valid file (kill switch to 0)', r.colourSnap === 0 && F.get('colourSnap') === 0);
  r = await F.load(() => Promise.reject(new Error('offline')), 500);
  t('a failed fetch keeps the last good value', r.colourSnap === 0);
  F.apply({});
  t('an empty file restores the default', F.get('colourSnap') === 0.8);
  r = await F.load(() => Promise.resolve({ ok: false }), 500);
  t('HTTP error changes nothing', r.colourSnap === 0.8);
  r = await F.load(() => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('bad json')) }), 500);
  t('broken JSON changes nothing', r.colourSnap === 0.8);
  console.log(bad ? 'FAIL ' + bad : 'PASS all flag tests'); process.exit(bad ? 1 : 0);
})();
