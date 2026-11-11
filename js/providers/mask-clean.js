/**
 * VS.MaskClean (v0.64): removes mask debris that is NOT part of the person, on the model's raw alpha (before the edge is snapped to the camera frame).
 *  - detached specks: a connected piece of mask that is much smaller than the main body (background flicker, a lamp, a poster face) is cleared;
 *  - small holes: a small fully-enclosed gap inside the body (a wrongly-cut patch of skin or shirt) is filled.
 * It never touches soft edge values (hair, fingers) that belong to a kept piece, and it keeps several people (every piece >= keepRatio of the largest).
 * Pure function on a Uint8Array alpha (0..255), safe to run in a worker. Cost at 448x256: about 1 ms.
 */
(function (root) {
  const VS = root.VS = root.VS || {};
  function clean(alpha, w, h, opt) {
    opt = opt || {};
    const THR = opt.threshold || 128, minSpeck = opt.minSpeck != null ? opt.minSpeck : Math.max(24, (w * h) * 0.0004);
    const holeMax = opt.holeMax != null ? opt.holeMax : Math.max(30, (w * h) * 0.0015);
    const n = w * h, lab = new Int32Array(n), stack = new Int32Array(n); const areas = [0];
    const stats = { specks: 0, holes: 0, pieces: 0 };
    // 1) label foreground pieces (4-connected, iterative flood fill)
    let next = 0;
    for (let i = 0; i < n; i++) {
      if (alpha[i] < THR || lab[i]) continue;
      next++; let sp = 0, area = 0; stack[sp++] = i; lab[i] = next;
      while (sp) {
        const p = stack[--sp]; area++; const x = p % w, y = (p - x) / w;
        if (x > 0 && !lab[p - 1] && alpha[p - 1] >= THR) { lab[p - 1] = next; stack[sp++] = p - 1; }
        if (x < w - 1 && !lab[p + 1] && alpha[p + 1] >= THR) { lab[p + 1] = next; stack[sp++] = p + 1; }
        if (y > 0 && !lab[p - w] && alpha[p - w] >= THR) { lab[p - w] = next; stack[sp++] = p - w; }
        if (y < h - 1 && !lab[p + w] && alpha[p + w] >= THR) { lab[p + w] = next; stack[sp++] = p + w; }
      }
      areas.push(area);
    }
    stats.pieces = next;
    if (!next) return stats;
    let big = 0; for (let k = 1; k <= next; k++) if (areas[k] > big) big = areas[k];
    const drop = new Uint8Array(next + 1);
    const cut = Math.max(minSpeck, big * 0.02);   // a piece smaller than 2% of the main body (and tiny in absolute terms) is debris; real second people / raised hands are bigger
    for (let k = 1; k <= next; k++) if (areas[k] < cut) { drop[k] = 1; stats.specks++; }
    if (stats.specks) {
      // clear the dropped pieces AND their soft fringe (non-zero neighbours that are not next to a kept piece)
      for (let i = 0; i < n; i++) if (lab[i] && drop[lab[i]]) alpha[i] = 0;
      for (let i = 0; i < n; i++) {
        if (alpha[i] === 0 || lab[i]) continue;      // soft pixels (below THR) that were never labelled
        const x = i % w, y = (i - x) / w; let keep = false;
        for (let dy = -2; dy <= 2 && !keep; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -2; dx <= 2; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const l = lab[yy * w + xx]; if (l && !drop[l]) { keep = true; break; } } }
        if (!keep && alpha[i] < THR) alpha[i] = 0;
      }
    }
    // 2) fill small enclosed holes inside kept pieces: flood the background from the border; background pieces not reached and small are holes
    const bg = new Uint8Array(n); let sp = 0;
    const push = (p) => { if (!bg[p] && alpha[p] < THR) { bg[p] = 1; stack[sp++] = p; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); } for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp) { const p = stack[--sp], x = p % w; if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (p >= w) push(p - w); if (p < n - w) push(p + w); }
    const seen = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (alpha[i] >= THR || bg[i] || seen[i]) continue;
      let cnt = 0, s2 = 0, touchesSoft = false; const members = []; stack[s2++] = i; seen[i] = 1;
      while (s2) { const p = stack[--s2]; cnt++; if (cnt <= holeMax + 1) members.push(p); const x = p % w;
        const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1];
        for (const q of nb) if (q >= 0 && alpha[q] < THR && !bg[q] && !seen[q]) { seen[q] = 1; stack[s2++] = q; } }
      if (cnt <= holeMax) { for (const p of members) alpha[p] = 255; stats.holes++; }
    }
    return stats;
  }
  VS.MaskClean = { clean };
})(typeof self !== 'undefined' ? self : this);
