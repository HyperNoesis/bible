// node tools/e2e/unit_gesture.js : synthetic 21-point hands (wrist at bottom, y down). Rules only; real-hand accuracy UNVERIFIED.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ctx = { self: {} }; ctx.self = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/hand-gesture-core.js'), 'utf8'), ctx);
const G = ctx.VS.HandGesture; let bad = 0;
const t = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log((ok ? 'PASS ' : 'FAIL ') + n + ' -> ' + got); };
// Build a hand: wrist (0.5,0.9). Finger bases on a row at y=0.6. extended: tip/pip far up; curled: tip folded back near palm.
function hand(o) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.9, z: 0 })); lm[0] = { x: 0.5, y: 0.9, z: 0 };
  const xs = { 5: 0.42, 9: 0.48, 13: 0.54, 17: 0.60 };
  [[5, 'index'], [9, 'middle'], [13, 'ring'], [17, 'pinky']].forEach(([b, k]) => {
    const x = xs[b]; lm[b] = { x, y: 0.62, z: 0 };
    if (o[k]) { lm[b + 1] = { x, y: 0.50, z: 0 }; lm[b + 2] = { x, y: 0.40, z: 0 }; lm[b + 3] = { x, y: 0.30, z: 0 }; }
    else { lm[b + 1] = { x, y: 0.56, z: 0 }; lm[b + 2] = { x, y: 0.62, z: 0 }; lm[b + 3] = { x, y: 0.67, z: 0 }; }
  });
  lm[1] = { x: 0.40, y: 0.80, z: 0 }; lm[2] = { x: 0.36, y: 0.72, z: 0 };
  if (o.thumb === 'out') { lm[3] = { x: 0.28, y: 0.62, z: 0 }; lm[4] = { x: 0.22, y: 0.54, z: 0 }; }
  else if (o.thumb === 'up') { lm[3] = { x: 0.34, y: 0.56, z: 0 }; lm[4] = { x: 0.33, y: 0.40, z: 0 }; lm[5] = { x: 0.42, y: 0.62, z: 0 }; }
  else { lm[3] = { x: 0.44, y: 0.70, z: 0 }; lm[4] = { x: 0.48, y: 0.66, z: 0 }; }
  return lm;
}
t('open palm', G.classify(hand({ index: 1, middle: 1, ring: 1, pinky: 1, thumb: 'out' })), 'open_palm');
t('fist', G.classify(hand({ thumb: 'in' })), 'fist');
t('thumbs up', G.classify(hand({ thumb: 'up' })), 'thumbs_up');
t('peace', G.classify(hand({ index: 1, middle: 1, thumb: 'in' })), 'peace');
t('point', G.classify(hand({ index: 1, thumb: 'in' })), 'point');
t('bad input', G.classify(null), 'none');
t('short input', G.classify([{ x: 0, y: 0 }]), 'none');
const db = G.makeDebouncer(3); const out = ['fist', 'fist', 'fist', 'fist', 'none', 'fist', 'fist', 'fist'].map(db);
t('debounce fires once after 3 frames', JSON.stringify(out), JSON.stringify([null, null, 'fist', null, null, null, null, 'fist']));
process.exit(bad ? 1 : 0);
