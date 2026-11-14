/**
 * Studio calm: one message at a time on the preview.
 *
 * Problem (seen in a real run of the studio): after Start Camera the preview stacked status chips, a mic warning bubble, the "loading the cutout
 * engine" message, the orange "your device is working hard" banner and the footer hint on top of each other, each written by a different
 * module that knows nothing about the others.
 *
 * This file is PRESENTATION ONLY. It never edits any message text, never removes the 'show' class the app uses to track its own banner,
 * and never changes app state. It only decides which one of the existing messages is visible, by setting data-stage-msg on #previewFrame
 * and adding two helper classes (calm-dismissed, calm-hidden) that css/genesis-system.css (section "Studio calm") understands.
 *
 * Priority: critical error > loading > performance notice > mic/light advice. Critical errors are never hidden and never time out.
 *   - performance notice: shown, then tucked away after PERF_MS (the "Reduced quality" pill stays as the quiet record of it)
 *   - advice: only shown after it has been the same for ADV_STABLE_MS (a one-frame mic peak is not advice), shown for ADV_SHOW_MS,
 *     and not repeated within ADV_REPEAT_MS
 *   - chips: only the ones that need attention are visible (css); the good ones are noise
 * Turn it off without a rebuild: localStorage vs_calm = '0' (then reload).
 */
(function () {
  'use strict';
  try { if (localStorage.getItem('vs_calm') === '0') return; } catch (e) { /* storage blocked: stay on */ }
  var frame = document.getElementById('previewFrame');
  if (!frame) return;

  var CRIT = /crashed|feed lost|could not start|cutout unavailable|permission|denied|not supported|black picture/i;
  var PERF_MS = 8000, ADV_STABLE_MS = 2500, ADV_SHOW_MS = 7000, ADV_REPEAT_MS = 90000, TICK_MS = 600;

  var banner = document.getElementById('degradeBanner');
  var perf = { text: '', since: 0 };
  var adv = { text: '', since: 0, shownAt: 0, last: {} };

  function bannerShown() { return !!banner && banner.classList.contains('show'); }
  function toggle(el, cls, on) { if (el && el.classList.contains(cls) !== on) el.classList.toggle(cls, on); }
  function setAttr(el, name, value) {
    if (value === null) { if (el.hasAttribute(name)) el.removeAttribute(name); } else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function update() {
    var now = Date.now();

    // ---- performance / error banner
    var critical = false, perfVisible = false;
    if (bannerShown()) {
      var t = (banner.textContent || '').replace(/[×x]\s*$/i, '').trim();
      critical = CRIT.test(t);
      if (t !== perf.text) { perf.text = t; perf.since = now; toggle(banner, 'calm-dismissed', false); }
      setAttr(banner, 'data-critical', critical ? '1' : null);
      if (!critical && now - perf.since > PERF_MS) toggle(banner, 'calm-dismissed', true);
      perfVisible = !banner.classList.contains('calm-dismissed');
    } else if (banner) {
      perf.text = ''; toggle(banner, 'calm-dismissed', false); setAttr(banner, 'data-critical', null);
    }

    // ---- loading overlay (class added in js/app.js showStageLoading)
    var loading = !!frame.querySelector('.stage-loading');

    // ---- advice bubble (written every second by js/studio-ux.js)
    var p = frame.querySelector('.ux-advice');
    var adviceVisible = false;
    if (p) {
      var text = p.hidden ? '' : (p.textContent || '').trim();
      if (!text) { adv.text = ''; toggle(p, 'calm-hidden', false); }
      else {
        if (text !== adv.text) { adv.text = text; adv.since = now; adv.shownAt = 0; }
        var show = false;
        if (adv.shownAt) show = now - adv.shownAt < ADV_SHOW_MS;
        else if (now - adv.since >= ADV_STABLE_MS && !(adv.last[text] && now - adv.last[text] < ADV_REPEAT_MS)) { adv.shownAt = now; adv.last[text] = now; show = true; }
        toggle(p, 'calm-hidden', !show);
        adviceVisible = show;
      }
    }

    var state = critical ? 'critical' : loading ? 'loading' : perfVisible ? 'perf' : adviceVisible ? 'advice' : 'none';
    setAttr(frame, 'data-stage-msg', state);
  }

  function safe() { try { update(); } catch (e) { /* cosmetic only: never break the studio */ } }
  setInterval(safe, TICK_MS);
  if (window.MutationObserver) {
    // react quickly when the app shows/hides a message; we only write when a value changes, so this settles after one pass
    new MutationObserver(safe).observe(frame, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  }
  safe();
  window.VS = window.VS || {};
  window.VS.stageCalm = { update: safe, state: function () { return frame.getAttribute('data-stage-msg'); } };
})();
