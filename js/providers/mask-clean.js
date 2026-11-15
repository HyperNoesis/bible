/**
 * VS.MaskClean (v0.91): removes mask debris from model alpha while protecting nearby fine hair-like wisps.
 *  - detached specks: small components that look like debris are cleared;
 *  - hair wisps: nearby, thin, elongated components survive the small-speck filter;
 *  - small holes: enclosed gaps are filled unless bounded by a protected wisp.
 * Uses 8-connectivity so diagonal strands are not fragmented into single-pixel noise.
 * Pure function on a Uint8Array alpha (0..255), safe to run in a worker. Typical 448x256 cost is a few ms when wisps need checking.
 */
(function (root) {
  const VS = root.VS = root.VS || {};
  function clean(alpha, w, h, opt) {
    opt = opt || {};
    const THR = opt.threshold || 128, minSpeck = opt.minSpeck != null ? opt.minSpeck : Math.max(24, (w * h) * 0.0004);
    const holeMax = opt.holeMax != null ? opt.holeMax : Math.max(30, (w * h) * 0.0015);
    // Fine hair can be split into many tiny high-confidence islands by a low-resolution
    // matte. Keep a *nearby, very thin and elongated* island rather than treating it as
    // background debris. The radius is in model-mask pixels (20 px ~= 57 px at 448 px
    // input when the source is 1280 px), deliberately local to the head/body boundary.
    const wispRadius = opt.wispRadius != null ? Math.max(1, Math.min(64, opt.wispRadius | 0)) : 20;
    const n = w * h, lab = new Int32Array(n), stack = new Int32Array(n); const areas = [0], comps = [null];
    const stats = { specks: 0, holes: 0, holesPreserved: 0, pieces: 0, wispsKept: 0 };
    // 1) label foreground pieces (8-connected, iterative flood fill). Four-connectivity splits
    // diagonal 1 px hair into single-pixel specks; 8-connectivity follows visible strands.
    // Gather shape moments so rotated/curved thin wisps can be distinguished from square noise.
    let next = 0;
    for (let i = 0; i < n; i++) {
      if (alpha[i] < THR || lab[i]) continue;
      next++; let sp = 0, area = 0;
      let minX = w, minY = h, maxX = -1, maxY = -1, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      stack[sp++] = i; lab[i] = next;
      while (sp) {
        const p = stack[--sp], x = p % w, y = (p - x) / w;
        area++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x > 0 && !lab[p - 1] && alpha[p - 1] >= THR) { lab[p - 1] = next; stack[sp++] = p - 1; }
        if (x < w - 1 && !lab[p + 1] && alpha[p + 1] >= THR) { lab[p + 1] = next; stack[sp++] = p + 1; }
        if (y > 0 && !lab[p - w] && alpha[p - w] >= THR) { lab[p - w] = next; stack[sp++] = p - w; }
        if (y < h - 1 && !lab[p + w] && alpha[p + w] >= THR) { lab[p + w] = next; stack[sp++] = p + w; }
        if (x > 0 && y > 0 && !lab[p - w - 1] && alpha[p - w - 1] >= THR) { lab[p - w - 1] = next; stack[sp++] = p - w - 1; }
        if (x < w - 1 && y > 0 && !lab[p - w + 1] && alpha[p - w + 1] >= THR) { lab[p - w + 1] = next; stack[sp++] = p - w + 1; }
        if (x > 0 && y < h - 1 && !lab[p + w - 1] && alpha[p + w - 1] >= THR) { lab[p + w - 1] = next; stack[sp++] = p + w - 1; }
        if (x < w - 1 && y < h - 1 && !lab[p + w + 1] && alpha[p + w + 1] >= THR) { lab[p + w + 1] = next; stack[sp++] = p + w + 1; }
      }
      areas.push(area);
      const mx = sx / area, my = sy / area;
      const vx = Math.max(0, sxx / area - mx * mx), vy = Math.max(0, syy / area - my * my), cov = sxy / area - mx * my;
      const tr = vx + vy, disc = Math.sqrt(Math.max(0, (vx - vy) * (vx - vy) + 4 * cov * cov));
      const major = Math.max(0, (tr + disc) * 0.5), minor = Math.max(0, (tr - disc) * 0.5);
      const majorExtent = 4 * Math.sqrt(major), minorExtent = 4 * Math.sqrt(minor);
      const elongated = area >= 4 && majorExtent >= 5 && major / Math.max(minor, 0.12) >= 4 && minorExtent <= 4.5;
      comps.push({ area, minX, minY, maxX, maxY, elongated });
    }
    stats.pieces = next;
    if (!next) return stats;
    let big = 0, mainId = 1;
    for (let k = 1; k <= next; k++) if (areas[k] > big) { big = areas[k]; mainId = k; }
    const cut = Math.max(minSpeck, big * 0.02);   // a piece smaller than 2% of the main body (and tiny in absolute terms) is usually debris
    let smallCount = 0;
    for (let k = 1; k <= next; k++) if (areas[k] < cut) smallCount++;

    // Only build the local distance field when there are components that would otherwise
    // be dropped. A multi-source 8-neighbour BFS from the largest person component is
    // cheaper and more reliable than bounding-box distance for curved/diagonal hair.
    const nearMain = new Uint8Array(next + 1);
    if (smallCount) {
      // Distance from the outside of the main component, not from every pixel
      // inside it. Seed only its 8-neighbour boundary, then flood through the
      // surrounding area. The zero value means "unvisited"; distances are 1..64.
      // This avoids queueing the whole person on every frame when hair cleanup runs.
      const dist = new Uint8Array(n);
      const queue = new Int32Array(n); let head = 0, tail = 0;
      const seed = (q) => { if (lab[q] !== mainId && !dist[q]) { dist[q] = 1; queue[tail++] = q; } };
      for (let i = 0; i < n; i++) if (lab[i] === mainId) {
        const x = i % w, y = (i - x) / w;
        if (x > 0 && y > 0) seed(i - w - 1);
        if (y > 0) seed(i - w);
        if (x < w - 1 && y > 0) seed(i - w + 1);
        if (x > 0) seed(i - 1);
        if (x < w - 1) seed(i + 1);
        if (x > 0 && y < h - 1) seed(i + w - 1);
        if (y < h - 1) seed(i + w);
        if (x < w - 1 && y < h - 1) seed(i + w + 1);
      }
      while (head < tail) {
        const p = queue[head++], d = dist[p];
        if (d >= wispRadius) continue;
        const x = p % w, y = (p - x) / w, nd = d + 1;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (lab[q] !== mainId && !dist[q]) { dist[q] = nd; queue[tail++] = q; }
          }
        }
      }
      for (let i = 0; i < n; i++) if (lab[i] && dist[i] && dist[i] <= wispRadius) nearMain[lab[i]] = 1;
    }

    const drop = new Uint8Array(next + 1);
    const wispIds = new Uint8Array(next + 1);
    for (let k = 1; k <= next; k++) {
      if (areas[k] >= cut) continue;
      const c = comps[k];
      const keepWisp = !!nearMain[k] && !!c && c.elongated;
      if (keepWisp) { stats.wispsKept++; wispIds[k] = 1; }
      else { drop[k] = 1; stats.specks++; }
    }
    if (stats.specks) {
      // Clear dropped pieces AND their soft fringe (non-zero neighbours that are not next to a kept piece).
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
      let cnt = 0, s2 = 0, touchesWisp = false; const members = []; stack[s2++] = i; seen[i] = 1;
      while (s2) { const p = stack[--s2]; cnt++; if (cnt <= holeMax + 1) members.push(p); const x = p % w, y = (p - x) / w;
        // Do not fill tiny background pockets bounded by preserved wisps: that would
        // reconnect distinct strands into a solid blob and undo the hair preservation.
        for (let dy = -1; dy <= 1 && !touchesWisp; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const id = lab[yy * w + xx]; if (id && wispIds[id]) { touchesWisp = true; break; } } }
        const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1];
        for (const q of nb) if (q >= 0 && alpha[q] < THR && !bg[q] && !seen[q]) { seen[q] = 1; stack[s2++] = q; } }
      if (cnt <= holeMax && !touchesWisp) { for (const p of members) alpha[p] = 255; stats.holes++; }
      else if (cnt <= holeMax && touchesWisp) stats.holesPreserved++;
    }
    return stats;
  }
  VS.MaskClean = { clean };
})(typeof self !== 'undefined' ? self : this);
