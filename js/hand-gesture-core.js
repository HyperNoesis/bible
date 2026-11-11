/* Hand gestures from 21 MediaPipe hand landmarks (pure, no DOM). Rules, not a trained classifier:
 * a finger counts as extended when its tip is farther from the wrist than its middle joint (works at any hand size/rotation).
 * Returns 'open_palm' | 'fist' | 'thumbs_up' | 'peace' | 'point' | 'none'. Unit test: tools/e2e/unit_gesture.js */
(function (root) {
  const VS = root.VS = root.VS || {};
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
  function fingers(lm) {
    const w = lm[0], ext = (tip, pip) => d(lm[tip], w) > d(lm[pip], w) * 1.08;
    // thumb: tip must be clearly farther from the pinky base than the thumb's IP joint is
    const thumb = d(lm[4], lm[17]) > d(lm[3], lm[17]) * 1.12 && d(lm[4], lm[5]) > d(lm[2], lm[5]) * 0.9;
    return { thumb, index: ext(8, 6), middle: ext(12, 10), ring: ext(16, 14), pinky: ext(20, 18) };
  }
  function classify(lm) {
    if (!lm || lm.length < 21) return 'none';
    const f = fingers(lm), n = [f.index, f.middle, f.ring, f.pinky].filter(Boolean).length;
    if (n === 4 && f.thumb) return 'open_palm';
    if (n === 0 && f.thumb && lm[4].y < lm[3].y && lm[4].y < lm[5].y) return 'thumbs_up';   // image y grows downward: thumb tip above its joints
    if (n === 0 && !f.thumb) return 'fist';
    if (f.index && f.middle && !f.ring && !f.pinky) return 'peace';
    if (f.index && n === 1) return 'point';
    return 'none';
  }
  /** Needs the same gesture on `need` consecutive frames before reporting it, so a flicker never flips a slide. */
  function makeDebouncer(need) {
    need = need || 6; let last = 'none', run = 0, fired = 'none';
    return function (g) { run = g === last ? run + 1 : 1; last = g; if (run >= need && g !== fired) { fired = g; return g; } if (g === 'none') fired = 'none'; return null; };
  }
  VS.HandGesture = { classify, fingers, makeDebouncer };
})(typeof self !== 'undefined' ? self : this);
