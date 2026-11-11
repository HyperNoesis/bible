/* Background removal presets (v0.70, constitution ch.10 / phase 6). Presentation only.
   Drives the EXISTING #modelSelect and #sharpQuality controls and mirrors the engine's own status text
   (#modelBenchNote, written by app.js from real measurements). It never invents a provider name, FPS or progress. */
(function () {
  'use strict';
  var model = document.getElementById('modelSelect'), edge = document.getElementById('sharpQuality');
  var wrap = document.getElementById('segPresets'), state = document.getElementById('segState'), custom = document.getElementById('segCustom');
  var bench = document.getElementById('modelBenchNote');
  if (!model || !edge || !wrap) return;
  // preset -> [model preference, edge quality]. Each combination uses options that already exist and are verified in app.js.
  var MAP = { auto: ['auto', '1'], balanced: ['modnet', '1'], detail: ['auto', '2'], performance: ['mediapipe', '1'] };
  function current() {
    for (var k in MAP) if (MAP[k][0] === model.value && MAP[k][1] === edge.value) return k;
    return null;
  }
  function render() {
    var cur = current();
    wrap.querySelectorAll('button').forEach(function (b) {
      var on = b.dataset.preset === cur; b.setAttribute('aria-checked', String(on)); b.tabIndex = (on || (!cur && b.dataset.preset === 'auto')) ? 0 : -1;
    });
    custom.hidden = !!cur;
  }
  function fire(el) { el.dispatchEvent(new Event('change', { bubbles: true })); }
  wrap.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-preset]'); if (!b) return;
    var m = MAP[b.dataset.preset];
    if (model.value !== m[0]) { model.value = m[0]; fire(model); }
    if (edge.value !== m[1]) { edge.value = m[1]; fire(edge); }
    render();
  });
  wrap.addEventListener('keydown', function (e) {
    var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }; if (!keys[e.key]) return;
    var btns = Array.prototype.slice.call(wrap.querySelectorAll('button')), i = btns.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); var n = btns[(i + keys[e.key] + btns.length) % btns.length]; n.focus(); n.click();
  });
  model.addEventListener('change', render); edge.addEventListener('change', render);
  // Status line = the engine's own measured note, verbatim. Empty until the engine has reported something.
  function sync() { var t = bench && bench.textContent.trim(); state.textContent = t || 'Background removal starts with your camera.'; }
  if (bench && window.MutationObserver) new MutationObserver(sync).observe(bench, { childList: true, characterData: true, subtree: true });
  sync(); render(); setTimeout(render, 600); // app.js restores the saved model preference after load
})();
