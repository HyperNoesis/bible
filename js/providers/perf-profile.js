/**
 * PerfProfile — the brains behind FAST mode for low-end devices.
 *
 * Two jobs, both deliberately kept as PURE functions (no DOM, no timers) so the
 * exact rules can be unit-tested in tests.html instead of trusted by eye:
 *
 *  1. classifyDevice(signals) — a STATIC guess, made before the camera starts,
 *     about whether this device is low-powered. Used only to PRE-SELECT FAST
 *     when the user never picked a default, and to show a note. It never
 *     forces anything.
 *
 *  2. decideDegradeAction(ctx) — the RUNTIME decision, made after the frame
 *     rate has actually been measured low for several seconds in a row. This is
 *     the one that matters: it reacts to what this device really does, not to
 *     what its spec sheet suggests.
 *
 * HONEST LIMITS (do not oversell these in UI copy):
 *  - navigator.deviceMemory exists only in Chromium browsers, is rounded to a
 *    power of two (a 6 GB phone reports 4), and is capped at 8. Safari and
 *    Firefox don't expose it at all. navigator.hardwareConcurrency counts
 *    logical threads, not speed, and Firefox's fingerprinting protection
 *    reports a fake 2. So this is a heuristic that can be wrong in both
 *    directions — which is exactly why it only recommends, and why the runtime
 *    rule below exists to catch what it misses.
 *  - Nothing here can make MediaPipe's model itself faster. FAST's real levers
 *    are: the lighter of MediaPipe's two bundled models, a smaller output
 *    canvas, skipping two of the heaviest per-frame canvas passes, and (only if
 *    the frame rate still can't hold) refreshing the mask on every other frame.
 */
(function (root) {
  const VS = root.VS = root.VS || {};

  // At or below these, a browser is running ML + canvas compositing + a video
  // encoder on hardware that will struggle. Deliberately inclusive of 4 GB:
  // a wrongly-recommended FAST is one tap to undo; a wrongly-withheld one is
  // a stuttering first impression.
  const LOW_MEMORY_GB = 4;
  const LOW_THREADS = 4;

  // How much of each frame's wall-clock time must be spent inside the
  // segmentation model before skipping mask updates is worth it. Below this,
  // the bottleneck is rendering or the camera and skipping inference would
  // only make the cutout laggier for no speed gain.
  const INFERENCE_BOUND_SHARE = 0.4;

  // Mask refreshes on 1 of every N frames at most. 2 is the ceiling on
  // purpose: at 3+ a moving head visibly outruns its own cutout.
  const MAX_STRIDE = 2;

  /**
   * @param {{deviceMemory?: number, hardwareConcurrency?: number}} sig
   * @returns {{tier: 'low'|'standard', reasons: string[]}}
   */
  function classifyDevice(sig) {
    sig = sig || {};
    const reasons = [];
    if (typeof sig.deviceMemory === 'number' && sig.deviceMemory > 0 && sig.deviceMemory <= LOW_MEMORY_GB) {
      reasons.push(`${sig.deviceMemory} GB memory reported`);
    }
    if (typeof sig.hardwareConcurrency === 'number' && sig.hardwareConcurrency > 0 && sig.hardwareConcurrency <= LOW_THREADS) {
      reasons.push(`${sig.hardwareConcurrency} CPU threads`);
    }
    return { tier: reasons.length ? 'low' : 'standard', reasons };
  }

  /** Reads the two signals a browser will give us. Every field may be absent. */
  function readSignals(nav) {
    nav = nav || (typeof navigator !== 'undefined' ? navigator : {});
    return { deviceMemory: nav.deviceMemory, hardwareConcurrency: nav.hardwareConcurrency };
  }

  function detect(nav) {
    const signals = readSignals(nav);
    const result = classifyDevice(signals);
    result.signals = signals;
    return result;
  }

  /**
   * Called when the measured frame rate has stayed under the floor for several
   * consecutive seconds. Returns WHAT TO DO, not how to show it.
   *
   * @param {{quality: string, stride: number, fps: number, segMs: number}} ctx
   *   quality — the mode currently running
   *   stride  — current mask-refresh stride (1 = every frame)
   *   fps     — measured composited frames per second
   *   segMs   — smoothed time one segmentation call takes (0 if unknown)
   * @returns {'suggest-fast'|'engage-stride'|'no-stride-help'|'ceiling'}
   */
  function decideDegradeAction(ctx) {
    if (ctx.quality !== 'fast') return 'suggest-fast';
    if (ctx.stride >= MAX_STRIDE) return 'ceiling';
    const frameMs = ctx.fps > 0 ? 1000 / ctx.fps : Infinity;
    const share = ctx.segMs > 0 && Number.isFinite(frameMs) ? ctx.segMs / frameMs : 0;
    return share >= INFERENCE_BOUND_SHARE ? 'engage-stride' : 'no-stride-help';
  }

  // Battery saver (brief D4). Pure so it can be unit-tested. Browsers expose no temperature, so the signals are
  // battery level/charging (Battery API, Chromium only) and the Compute Pressure state (Chromium only).
  const SAVER_BATTERY_LEVEL = 0.2;
  /**
   * @param {{saverOn:boolean, level?:number, charging?:boolean, pressure?:string}} c
   * @returns {'none'|'suggest-saver'|'auto-throttle'}
   *   auto-throttle: the CPU reports serious/critical pressure, so cut work now (and say so).
   */
  function decideSaver(c) {
    c = c || {};
    if (c.saverOn) return 'none';
    if (c.pressure === 'critical' || c.pressure === 'serious') return 'auto-throttle';
    if (typeof c.level === 'number' && c.level <= SAVER_BATTERY_LEVEL && c.charging === false) return 'suggest-saver';
    return 'none';
  }
  const SAVER_FRAME_MS = 50; // cap at about 20 fps while saving battery


  // ---- Step-down ladder (Oct 2026 research, Phase 6). PURE: it only DECIDES; app.js applies it. ----
  // Order = what we give up first. Each rung keeps the app alive on a weaker phone instead of stuttering.
  const LADDER = [
    { id: 'modnet-320', engine: 'modnet', longEdge: 320, effects: 'full' },
    { id: 'modnet-256', engine: 'modnet', longEdge: 256, effects: 'full' },
    { id: 'mediapipe-light', engine: 'mediapipe', longEdge: 0, effects: 'full' },
    { id: 'mediapipe-light-lean', engine: 'mediapipe', longEdge: 0, effects: 'lean' },
  ];
  const HOPELESS_SEG_MS = 700;     // one mask slower than this = under about 1.4 fps
  const HOPELESS_SECONDS = 2;      // ...for this many one-second checks in a row
  const LADDER_FLOOR_FPS = 18;     // below this for LADDER_LOW_SECONDS in a row -> step down
  const LADDER_LOW_SECONDS = 4;
  const LADDER_MAX_FIRST_RUNG = { low: 2, standard: 0 }; // a 'low' tier device starts at modnet-256
  /**
   * @param {{rung:number, fps:number, lowSeconds:number, busy:boolean, segMs?:number}} c
   * @returns {{action:'hold'|'step-down'|'floor'|'wait-busy', nextRung:number, rung:object}}
   *   busy = recording or live: never change engine mid-take, say so instead.
   */
  function decideLadderStep(c) {
    c = c || {};
    const rung = Math.max(0, Math.min(LADDER.length - 1, c.rung | 0));
    const hold = (action, reason) => ({ action, nextRung: rung, rung: LADDER[rung], reason: reason || '' });
    const camAware = c.camFps > 0;   // v0.80: when the camera's real rate is known, judge the MODEL against the CAMERA, not against a fixed 18 fps
    const floor = camAware ? Math.min(LADDER_FLOOR_FPS, c.camFps * CAM_BOUND_SHARE) : LADDER_FLOOR_FPS;
    const need = camAware ? LADDER_LOW_SECONDS_CAM : LADDER_LOW_SECONDS;
    // v0.84: a mask that takes this long is a slideshow (about 1.4 fps or less). Stepping down one size at a time cannot fix it, and neither "fps = 0"
    // nor "recording" may trap a phone there: go straight to the light model (verified against a real Mali-G52 phone: MODNet 4.7 s per mask).
    if (c.segMs >= HOPELESS_SEG_MS && (c.lowSeconds | 0) >= HOPELESS_SECONDS && LADDER[rung].engine !== 'mediapipe') {
      const mp = LADDER.findIndex((r) => r.engine === 'mediapipe');
      return { action: 'step-down', nextRung: mp, rung: LADDER[mp], reason: 'hopeless' };
    }
    if (!(c.fps > 0) || c.fps >= floor || (c.lowSeconds | 0) < need) return hold('hold');
    if (camAware && !modelIsBottleneck(c)) return hold('hold', 'camera-bound');   // the camera (dim room, auto exposure) or the page is the limit: a smaller model would not help
    if (rung >= LADDER.length - 1) return hold('floor');
    // Never give up on matting for the blocky light model while the smallest matting size still keeps a usable mask rate.
    if (camAware && LADDER[rung + 1].engine === 'mediapipe' && !(c.segMs >= MEDIAPIPE_MIN_SEG_MS)) return hold('hold', 'smallest-matting-ok');
    if (c.busy) return hold('wait-busy');
    return { action: 'step-down', nextRung: rung + 1, rung: LADDER[rung + 1], reason: 'model-bound' };
  }
  // v0.80 — why the old ladder dropped good models on fast machines: it compared the OUTPUT frame rate with a fixed 18 fps. A webcam in a normal
  // room often delivers only 10-15 fps (auto exposure), so the ladder blamed the model for the camera and walked down to the blocky light model.
  // The model is the bottleneck only when (a) we output clearly fewer frames than the camera delivers AND (b) one mask takes about as long as a camera frame.
  const CAM_BOUND_SHARE = 0.85;          // output >= 85% of the camera rate => camera-bound, not model-bound
  const LADDER_LOW_SECONDS_CAM = 8;      // camera-aware mode waits longer before acting (a brief dip is not a verdict)
  const MEDIAPIPE_MIN_SEG_MS = 150;      // only leave matting when even the smallest size needs this long per mask
  /** @param {{fps:number, camFps?:number, segMs?:number}} c  @returns {boolean} true when the matting model is what limits the frame rate */
  function modelIsBottleneck(c) {
    c = c || {};
    if (!(c.fps > 0)) return c.segMs >= MEDIAPIPE_MIN_SEG_MS;   // v0.84: a phone so slow that it reports 0 fps is the model's fault, not the camera's (it used to count as 'not the model' and was never stepped down)
    const cam = c.camFps > 0 ? c.camFps : 0;
    if (cam && c.fps >= cam * CAM_BOUND_SHARE) return false;
    if (c.segMs > 0 && c.segMs < (1000 / (cam || 30)) * 0.75) return false;
    return true;
  }
  // Step BACK UP (Prompt 1, e): only inside the MODNet sizes (256 -> 320), only after a long stable stretch, never while recording/live,
  // and at most LADDER_MAX_UPS times per camera session so a borderline phone cannot oscillate. The engine swap back to MODNet is never automatic.
  const LADDER_UP_FPS = 27;
  const LADDER_UP_SECONDS = 30;
  const LADDER_MAX_UPS = 2;
  /**
   * @param {{rung:number, fps:number, highSeconds:number, busy:boolean, ups:number}} c
   * @returns {{action:'hold'|'step-up', nextRung:number, rung:object}}
   */
  function decideLadderStepUp(c) {
    c = c || {};
    const rung = Math.max(0, Math.min(LADDER.length - 1, c.rung | 0));
    const hold = { action: 'hold', nextRung: rung, rung: LADDER[rung] };
    if (rung !== 1) return hold;                       // only modnet-256 can step up (to modnet-320)
    if (c.busy || (c.ups | 0) >= LADDER_MAX_UPS) return hold;
    if (!(c.fps >= LADDER_UP_FPS) || (c.highSeconds | 0) < LADDER_UP_SECONDS) return hold;
    return { action: 'step-up', nextRung: 0, rung: LADDER[0] };
  }
  /** First rung for a classified device. Static guess only; the ladder corrects it at runtime. */
  function startRung(tier) { return LADDER_MAX_FIRST_RUNG[tier] != null ? LADDER_MAX_FIRST_RUNG[tier] : 0; }

  /** Speed-test statistic. Contention (camera, renderer, other threads) only ever makes a run SLOWER, never faster, so the true speed is near the fast end:
   *  take the lower quartile instead of the median. One hitch can no longer decide which model a phone gets. Returns 0 for no samples. */
  function lowQuartile(times) {
    const t = (times || []).filter((x) => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
    return t.length ? t[Math.floor((t.length - 1) / 4)] : 0;
  }
  /** A saved speed-test verdict is only trusted for maxAgeMs (default 6 h): a bad reading (hot phone, busy moment) must not pin a phone to the light model for good. */
  const BENCH_MAX_AGE_MS = 6 * 3600 * 1000;
  function benchFresh(b, now, maxAgeMs) {
    return !!b && typeof b.at === 'number' && ((now == null ? Date.now() : now) - b.at) < (maxAgeMs || b.holdMs || BENCH_MAX_AGE_MS) && ((now == null ? Date.now() : now) - b.at) >= 0;
  }
  /** CPU threads for ORT-web. Phones have a few fast cores and many slow ones: more than 2 threads usually land on slow cores and starve the page, so phones are capped at 2. */
  function wasmThreads(cores, isolated, mobile, forceOne) {
    if (forceOne || !isolated) return 1;
    const c = Math.max(1, (cores | 0) || 2);
    return Math.max(1, Math.min(mobile ? 2 : 4, c - 1));
  }

  VS.PerfProfile = {
    lowQuartile, benchFresh, wasmThreads, BENCH_MAX_AGE_MS,
    HOPELESS_SEG_MS, HOPELESS_SECONDS, modelIsBottleneck, CAM_BOUND_SHARE, LADDER_LOW_SECONDS_CAM, MEDIAPIPE_MIN_SEG_MS,
    classifyDevice, readSignals, detect, decideDegradeAction, decideSaver, decideLadderStep, decideLadderStepUp, startRung, LADDER, LADDER_UP_FPS, LADDER_UP_SECONDS, LADDER_MAX_UPS, LADDER_FLOOR_FPS, LADDER_LOW_SECONDS, SAVER_BATTERY_LEVEL, SAVER_FRAME_MS,
    LOW_MEMORY_GB, LOW_THREADS, INFERENCE_BOUND_SHARE, MAX_STRIDE,
  };
})(typeof self !== 'undefined' ? self : this);
