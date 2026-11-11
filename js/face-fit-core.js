/* Head-fit maths (v0.53). Pure, no DOM. Turns face landmarks into the zoom/pan the framing engine needs so the head sits like a
 * normal talking-head shot: face about 30% of the frame height, eyes about 38% down from the top, centred sideways.
 * Landmarks are MediaPipe Face Mesh points in 0..1 of the SOURCE video. Tested on synthetic faces (tools/e2e/unit_facefit.js). */
(function (root) {
  const VS = root.VS = root.VS || {};
  const T = { faceFrac: 0.30, eyeFrac: 0.38, minZoom: 1, maxZoom: 3 };
  const median = (a) => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
  /** Forehead(10)-to-chin(152) height, eye line (corners 33/263 and 133/362), and horizontal centre. null if the points are missing. */
  function faceMetrics(lm) {
    if (!lm || lm.length < 400 || !lm[10] || !lm[152]) return null;
    const h = Math.abs(lm[152].y - lm[10].y); if (!(h > 0.02)) return null;
    let x0 = 1, x1 = 0; for (let i = 0; i < lm.length; i++) { const x = lm[i].x; if (x < x0) x0 = x; if (x > x1) x1 = x; }
    const eyeY = (lm[33].y + lm[263].y + lm[133].y + lm[362].y) / 4;
    return { h, eyeY, cx: (x0 + x1) / 2, top: lm[10].y };
  }
  /** Median of several samples, so one bad frame cannot move the camera. Needs >= minN usable samples. */
  function combine(samples, minN) {
    const ok = samples.filter(Boolean); if (ok.length < (minN || 4)) return null;
    return { h: median(ok.map((s) => s.h)), eyeY: median(ok.map((s) => s.eyeY)), cx: median(ok.map((s) => s.cx)), n: ok.length };
  }
  /** m = combined metrics, srcW/srcH = video size, ratio = output aspect (w/h).
   *  Returns { zoom, panX, panY, note, clamped } using the SAME crop maths as CompositionEngine.computeFrame. */
  function fitHead(m, srcW, srcH, ratio) {
    if (!m || !(srcW > 0) || !(srcH > 0) || !(ratio > 0)) return null;
    const cropH0 = (srcW / srcH > ratio) ? srcH : srcW / ratio;           // crop height at zoom 1
    let zoom = cropH0 / ((m.h * srcH) / T.faceFrac), note = '';           // want crop height = face height / faceFrac
    if (zoom < T.minZoom) { zoom = T.minZoom; note = 'You are close to the camera: move back a little for a wider shot.'; }
    if (zoom > T.maxZoom) { zoom = T.maxZoom; note = 'You are far from the camera: move closer for a sharper picture.'; }
    const ch = cropH0 / zoom, cw = ch * ratio;
    const cx = m.cx * srcW, cropTop = m.eyeY * srcH - T.eyeFrac * ch;
    let sx = cx - cw / 2, sy = cropTop;
    const sxC = Math.min(Math.max(sx, 0), srcW - cw), syC = Math.min(Math.max(sy, 0), srcH - ch);
    const clamped = Math.abs(sxC - sx) > 1 || Math.abs(syC - sy) > 1;
    if (clamped && !note) note = 'Fitted as far as the camera view allows. Raise or centre the phone for a better fit.';
    return { zoom: Math.round(zoom * 20) / 20, panX: (sxC + cw / 2) / srcW, panY: (syC + ch / 2) / srcH, note, clamped };
  }
  VS.FaceFit = { faceMetrics, combine, fitHead, median, T };
})(typeof self !== 'undefined' ? self : this);
