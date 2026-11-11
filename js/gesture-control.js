/* Hands-free slide control (v0.52). Pure controller + a small runtime. Opt-in (Studio > Hands). Mapping:
 * thumbs up = next slide, peace sign = previous slide. A gesture must be held ~0.75 s (6 samples at 8 Hz) and then a cooldown applies,
 * so a wave or a half-formed hand never flips a slide. Rules + timings tested in tools/e2e/unit_gesture_control.js (synthetic input only). */
(function (root) {
  const VS = root.VS = root.VS || {};
  const MAP = { thumbs_up: 'next', peace: 'prev' };
  /** feed(gesture, nowMs) -> 'next' | 'prev' | null */
  function makeController(opts) {
    opts = opts || {}; const cooldown = opts.cooldownMs || 1500;
    const deb = VS.HandGesture.makeDebouncer(opts.holdSamples || 6); let lastFire = -1e9;
    return function feed(gesture, now) {
      const fired = deb(gesture || 'none'); const action = fired && MAP[fired];
      if (!action || now - lastFire < cooldown) return null;
      lastFire = now; return action;
    };
  }
  /** Runtime: samples the video ~8x/s, never overlaps two detections, pauses while the picture is struggling. */
  function create(o) {
    let timer = null, busy = false, prov = null, errs = 0; const feed = makeController();
    const tick = async () => {
      if (busy || !o.canRun()) return; busy = true;
      try {
        const r = await prov.gesture(o.video); errs = 0;
        const a = feed(r.gesture, performance.now()); if (a) o.onAction(a);
      } catch (e) { if (++errs >= 5) { o.onError && o.onError(e); stop(); } } finally { busy = false; }
    };
    async function start() {
      if (timer) return;
      if (!VS.HandsProvider) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'js/providers/hands-provider.js'; s.onload = res; s.onerror = () => rej(new Error('hands-provider.js missing')); document.head.appendChild(s); });
      prov = new VS.HandsProvider(); await prov.initialize(); timer = setInterval(tick, 125);
    }
    function stop() { if (timer) clearInterval(timer); timer = null; try { prov && prov.dispose(); } catch (e) {} prov = null; }
    return { start, stop, isOn: () => !!timer };
  }
  VS.GestureControl = { makeController, create, MAP };
})(typeof self !== 'undefined' ? self : this);
