/* Segmentation diagnostics (v0.74). Presentation only: reads measured values the engine already publishes
   (#stats, #renderHud, #transportStatus, #degradeBanner, the model and quality selects). Nothing is invented: "--" until measured.
   Technical names appear only here; the stage shows a plain-language status pill. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var anchor = $('segState'); if (!anchor) return;
  var FRIENDLY = { fast: 'Performance', balanced: 'Balanced', quality: 'Detail', ultra: 'Ultra' };
  var det = document.createElement('details'); det.className = 'seg-diag';
  det.innerHTML = '<summary>Diagnostics</summary><dl id="segDiag"></dl><p class="seg-note">Measured in this session. Frame time is sampled once a second.</p>';
  anchor.parentNode.insertBefore(det, anchor.nextSibling);
  var dl = $('segDiag'), samples = [], fps = null, lat = null, stride = 1, low = false, prov = '';
  function read() {
    var t = ($('stats') && $('stats').textContent) || '';
    var f = t.match(/FPS:\s*(\d+)/), l = t.match(/Frame latency:\s*([\d.]+)/), s = t.match(/Mask refresh: 1 in (\d+)/), p = t.match(/Provider:\s*([^|]+)/);
    fps = f ? +f[1] : null; lat = l ? +l[1] : null; stride = s ? +s[1] : 1; low = /Low-light boost: active/.test(t); prov = p ? p[1].trim() : '';
  }
  var camera = function () { var s = ($('transportStatus') || {}).textContent || ''; return /previewing|recording/i.test(s); };
  var banner = function () { var b = $('degradeBanner'); return b && b.classList.contains('show') ? (b.textContent || '').trim() : ''; };
  function pct(a, p) { if (!a.length) return null; var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; }
  function status() {
    if (!camera()) return { tone: 'idle', pill: 'Camera off' };
    var b = banner();
    if (/could not start|crashed/i.test(b)) return { tone: 'bad', pill: 'Needs attention' };
    if (/^No person/i.test(b)) return { tone: 'warn', pill: 'No person found' };
    if (/^(Switched|Fixing)|slow|frame rate|lowered/i.test(b)) return { tone: 'warn', pill: 'Reduced quality' };
    if (fps == null) return { tone: 'ai', pill: 'Starting' };
    if (fps < 15) return { tone: 'warn', pill: 'Running slowly' };
    return { tone: 'ai', pill: 'Background removal active' };
  }
  var hud = $('previewHud'), pill = null;
  if (hud) { pill = document.createElement('span'); pill.className = 'pill seg-pill'; pill.id = 'segPill'; pill.setAttribute('aria-hidden', 'true'); hud.appendChild(pill); var rh = $('renderHud'); if (rh) rh.style.display = 'none'; }
  function engineLog() {
    var L = (window.VS && window.VS.segLog) || [];
    if (!L.length) return 'no changes this session';
    return L.slice(-4).map(function (e) { return e.ev + (e.why ? ' (' + e.why + ')' : '') + ' [out ' + e.fps + ', cam ' + e.cam + ', mask ' + e.seg + ' ms' + (e.edge ? ', ' + e.edge + ' px' : '') + (e.ms ? ', bench ' + e.ms + ' ms' : '') + ']'; }).join('<br>');
  }
  function row(k, v) { return '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>'; }
  function render() {
    var run = camera(), s = status();
    if (pill) { pill.textContent = s.pill; pill.dataset.tone = s.tone; }
    if (run && lat != null) { samples.push(lat); if (samples.length > 120) samples.shift(); } if (!run) samples.length = 0;
    var cv = $('canvas'), m = $('modelSelect'), q = $('qualitySelect'), e = $('sharpQuality');
    dl.innerHTML =
      row('Background removal', run ? s.pill : 'Camera off') +
      row('Preset model', m ? (m.options[m.selectedIndex] ? m.options[m.selectedIndex].text.replace(/\s*\(.*\)/, '') : m.value) : '--') +
      row('Engine in use', ($('renderHud') && $('renderHud').textContent.trim()) || '--') +
      row('Model', prov || '--') +
      row('Edge quality', e ? (e.value === '2' ? 'High' : 'Fast') : '--') +
      row('Quality mode', q ? (FRIENDLY[q.value] || q.value) : '--') +
      row('Output size', cv ? cv.width + ' x ' + cv.height : '--') +
      row('Frame rate', run && fps != null ? fps + ' fps' : '--') +
      row('Frame time (now)', run && lat != null ? lat + ' ms' : '--') +
      row('Frame time p50 / p95', samples.length > 4 ? pct(samples, .5) + ' / ' + pct(samples, .95) + ' ms' : '--') +
      row('Cutout refresh', run ? (stride > 1 ? 'every ' + stride + ' frames' : 'every frame') : '--') +
      row('Low-light boost', run ? (low ? 'on' : 'off') : '--') +
      row('Camera delivers', run && window.__camFps ? window.__camFps + ' fps (asked of the camera)' : '--') +
      row('Person crop', run ? ((window.VS && window.VS.segLog) ? 'see log' : 'active only when it helps') : '--') +
      row('Why the engine changed', run ? engineLog() : '--');
    var qh = $('qualityHud'); if (qh && q && FRIENDLY[q.value] && qh.textContent !== FRIENDLY[q.value]) qh.textContent = FRIENDLY[q.value];
  }
  setInterval(function () { try { read(); render(); } catch (e) {} }, 1000);
  render();
})();
