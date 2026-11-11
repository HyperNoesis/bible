/**
 * VS.RoiTrack (v0.80) — "look where the person is".
 *
 * WHY: a matting model sees a fixed number of pixels. When the person sits back and fills 40-60% of the frame, most of those pixels
 * are wasted on room, so hair and shoulders are mushy. Cropping the model's input to the person (plus a safe margin) spends the same
 * pixel budget on the person only. Measured offline (MODNet, equal pixel cost): edge error vs the model's own best output fell
 * 0.235 -> 0.190 at 60% of frame and 0.471 -> 0.305 at 40%; with the person filling the frame there is no gain, so the crop
 * switches itself off there (active() is false when the box covers more than MAX_AREA of the frame).
 *
 * PURE logic, no DOM: unit-tested in tools/e2e/unit_roi.js. The provider (modnet-provider.js) applies it.
 *
 * Rules that keep it safe:
 *  - box sizes are QUANTISED to steps of 0.1 of the frame (0.5..1.0) so the model input shape changes rarely (shape churn is costly on WebGPU);
 *  - the box GROWS at once when the person (plus margin) no longer fits, and SHRINKS only after SHRINK_AFTER calm frames;
 *  - the box centre follows the person with smoothing;
 *  - a person touching the box edge widens the box next frame; an empty mask for 2 frames drops back to the full frame;
 *  - never smaller than MIN_FRAC of the frame in either direction.
 */
(function (root) {
  const VS = root.VS = root.VS || {};
  const STEP = 0.1, MIN_FRAC = 0.5, MAX_AREA = 0.8, MARGIN = 0.15, SHRINK_AFTER = 45, THR = 0.4, MIN_PIXELS = 0.004, TOUCH = 0.03, FOLLOW = 0.5;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const up = (v) => clamp(Math.ceil(v / STEP - 1e-9) * STEP, MIN_FRAC, 1);

  function create() { return { wq: 1, hq: 1, cx: 0.5, cy: 0.5, calm: 0, miss: 0, on: false }; }
  function reset(st) { st.wq = 1; st.hq = 1; st.cx = 0.5; st.cy = 0.5; st.calm = 0; st.miss = 0; st.on = false; }

  /** Is the crop worth using right now? (a crop covering most of the frame costs a reshape for no gain) */
  function active(st) { return !!st && st.on && st.wq * st.hq <= MAX_AREA + 1e-9; }

  /** Box as fractions of the frame: {x0,y0,x1,y1}. Full frame when not active. */
  function box(st) {
    if (!active(st)) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    const x0 = clamp(st.cx - st.wq / 2, 0, 1 - st.wq), y0 = clamp(st.cy - st.hq / 2, 0, 1 - st.hq);
    return { x0, y0, x1: x0 + st.wq, y1: y0 + st.hq };
  }

  /** Box in integer camera pixels (even numbers, never empty). */
  function rectPx(st, vw, vh) {
    const b = box(st), ev = (v) => Math.max(2, Math.round(v / 2) * 2);
    let sx = ev(b.x0 * vw), sy = ev(b.y0 * vh), sw = ev((b.x1 - b.x0) * vw), sh = ev((b.y1 - b.y0) * vh);
    if (sx + sw > vw) sx = Math.max(0, vw - sw); if (sy + sh > vh) sy = Math.max(0, vh - sh);
    sw = Math.min(sw, vw); sh = Math.min(sh, vh);
    return { sx, sy, sw, sh };
  }

  /** Bounding box of the person in an alpha image, as fractions of THAT image (or null when there is no person). */
  function bboxOf(a, w, h, stride, offset) {
    stride = stride || 1; offset = offset || 0;
    const t = Math.round(THR * 255); let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
    for (let y = 0; y < h; y++) {
      const row = y * w; let first = -1, last = -1;
      for (let x = 0; x < w; x++) if (a[(row + x) * stride + offset] >= t) { if (first < 0) first = x; last = x; n++; }
      if (first >= 0) { if (first < x0) x0 = first; if (last > x1) x1 = last; if (y < y0) y0 = y; y1 = y; }
    }
    if (n < w * h * MIN_PIXELS) return null;
    return { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
  }

  /**
   * Feed the alpha the model just produced FOR THE CURRENT BOX; updates the box for the next frame.
   * @param a alpha data (Uint8Array, or RGBA with stride 4 / offset 3)  @param w,h its size
   * @returns {string} what happened: 'none' | 'init' | 'grow' | 'shrink' | 'hold' | 'lost'
   */
  function update(st, a, w, h, stride, offset) {
    const cur = box(st), bb = bboxOf(a, w, h, stride, offset);
    if (!bb) { st.calm = 0; if (++st.miss >= 2 && st.on) { reset(st); return 'lost'; } return 'none'; }
    st.miss = 0;
    const cw = cur.x1 - cur.x0, ch = cur.y1 - cur.y0;
    // person box in FRAME fractions
    const px0 = cur.x0 + bb.x0 * cw, px1 = cur.x0 + bb.x1 * cw, py0 = cur.y0 + bb.y0 * ch, py1 = cur.y0 + bb.y1 * ch;
    const pw = px1 - px0, ph = py1 - py0, mg = MARGIN * Math.max(pw, ph);
    let needW = pw + 2 * mg, needH = ph + 2 * mg;
    // touching a side of the box that is not the frame edge: widen so the person is never cut off
    if (st.on) {
      const touchL = bb.x0 <= TOUCH && cur.x0 > 0.001, touchR = bb.x1 >= 1 - TOUCH && cur.x1 < 0.999;
      const touchT = bb.y0 <= TOUCH && cur.y0 > 0.001, touchB = bb.y1 >= 1 - TOUCH && cur.y1 < 0.999;
      if (touchL || touchR) needW += 0.2; if (touchT || touchB) needH += 0.2;
    }
    const tw = up(needW), th = up(needH);
    const tcx = (px0 + px1) / 2, tcy = (py0 + py1) / 2;
    let verdict = 'hold';
    if (!st.on) { st.on = true; st.wq = tw; st.hq = th; st.cx = tcx; st.cy = tcy; st.calm = 0; return 'init'; }
    if (tw > st.wq + 1e-9 || th > st.hq + 1e-9) { st.wq = Math.max(st.wq, tw); st.hq = Math.max(st.hq, th); st.calm = 0; verdict = 'grow'; }
    else if (tw < st.wq - 1e-9 || th < st.hq - 1e-9) {
      if (++st.calm >= SHRINK_AFTER) { st.wq = tw; st.hq = th; st.calm = 0; verdict = 'shrink'; }
    } else st.calm = 0;
    st.cx += (tcx - st.cx) * FOLLOW; st.cy += (tcy - st.cy) * FOLLOW;
    return verdict;
  }

  /** Model input size (multiples of 32) holding about `budgetPx` pixels at the crop's aspect: the same cost as the full frame, spent on the person. */
  function sizeForBudget(sw, sh, budgetPx) {
    const r32 = (v) => Math.max(32, Math.round(v / 32) * 32), ar = sw / sh, mh = Math.sqrt(budgetPx / ar), mw = mh * ar;
    return [r32(Math.min(mw, Math.max(32, sw))), r32(Math.min(mh, Math.max(32, sh)))];
  }

  VS.RoiTrack = { create, reset, update, active, box, rectPx, bboxOf, sizeForBudget, STEP, MIN_FRAC, MAX_AREA, MARGIN, SHRINK_AFTER };
})(typeof self !== 'undefined' ? self : this);
