/**
 * Enhance quality (premium export): re-mattes a RAW camera recording offline and renders it through the SAME compositor as the live
 * preview (render-core: temporal filter, edge refine, colour match, shadow), so the look matches. Better than live because it can
 * afford: MODNet at 512 px (live runs 256-320), a forward+backward temporal filter, and no frame deadline.
 * Output: WebM (VP8) with exact frame timing via WebCodecs + vendor/webm-muxer (MIT). Audio is re-encoded to Opus when the raw clip has it.
 * Needs: raw clip (Studio > "Keep original for Enhance"), WebCodecs (Chrome/Edge/Android Chrome). Honest limits: docs/PROMPT2_REPORT.md.
 */
(function () {
  const VS = window.VS = window.VS || {}; const C = VS.EnhanceCore;
  const once = (el, ev) => new Promise((res, rej) => { const ok = () => { el.removeEventListener(ev, ok); el.removeEventListener('error', bad); res(); }; const bad = () => { el.removeEventListener(ev, ok); el.removeEventListener('error', bad); rej(new Error('video error while waiting for ' + ev)); }; el.addEventListener(ev, ok); el.addEventListener('error', bad); });
  const abortCheck = (sig) => { if (sig && sig.aborted) { const e = new Error('Enhance cancelled'); e.name = 'AbortError'; throw e; } };
  const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

  // ---- Model store: download ON DEMAND with progress, verify sha256, cache (Cache Storage), reuse offline. ----
  const CACHE = 'genesis-models-v1';
  const ModelStore = {
    async has(id) { const m = C.MODELS[id]; if (!m || !('caches' in window)) return false; try { return !!(await (await caches.open(CACHE)).match(new URL(m.url, location.href).href)); } catch (e) { return false; } },
    /** @returns {Promise<{fromCache:boolean, bytes:number}>}  throws on hash mismatch or network failure with nothing cached */
    async ensure(id, o) {
      o = o || {}; const m = C.MODELS[id]; if (!m) throw new Error('unknown model ' + id); const url = new URL(m.url, location.href).href;
      const cache = 'caches' in window ? await caches.open(CACHE) : null; const hit = cache && await cache.match(url);
      if (hit) { const n = (await hit.clone().arrayBuffer()).byteLength; if (!m.bytes || n === m.bytes) { o.onProgress && o.onProgress(1, n, n); return { fromCache: true, bytes: n }; } await cache.delete(url); }
      const res = await (o.fetchFn || fetch)(url, { signal: o.signal }); if (!res.ok) throw new Error('model download failed: HTTP ' + res.status);
      const total = +res.headers.get('content-length') || m.bytes || 0; const reader = res.body.getReader(); const parts = []; let got = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; o.onProgress && o.onProgress(total ? got / total : 0, got, total); }
      const bytes = new Uint8Array(got); let p = 0; for (const c of parts) { bytes.set(c, p); p += c.length; }
      if (m.sha256) { const h = hex(await crypto.subtle.digest('SHA-256', bytes)); if (h !== m.sha256) throw new Error('model file is corrupt (checksum mismatch), not saved'); }
      if (cache) await cache.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(got) } }));
      return { fromCache: false, bytes: got };
    },
  };

  // ---- Job store (resume): pass-1 masks survive a cancel/crash. Own DB, so the app's IndexedDB schema is untouched. ----
  const Jobs = {
    db: null,
    async open() { if (this.db) return this.db; this.db = await new Promise((res, rej) => { const r = indexedDB.open('genesis-enhance', 1); r.onupgradeneeded = () => { r.result.createObjectStore('masks'); r.result.createObjectStore('jobs'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); return this.db; },
    async tx(store, mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction(store, mode), s = t.objectStore(store); const r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); },
    putMask(job, i, u8) { return this.tx('masks', 'readwrite', (s) => s.put(u8.buffer.slice(0), job + ':' + i)); },
    async getMask(job, i) { const b = await this.tx('masks', 'readonly', (s) => s.get(job + ':' + i)); return b ? new Uint8Array(b) : null; },
    putJob(job, meta) { return this.tx('jobs', 'readwrite', (s) => s.put(meta, job)); },
    getJob(job) { return this.tx('jobs', 'readonly', (s) => s.get(job)); },
    async clear(job, n) { for (let i = 0; i < n; i++) await this.tx('masks', 'readwrite', (s) => s.delete(job + ':' + i)); await this.tx('jobs', 'readwrite', (s) => s.delete(job)); },
  };

  function supported() { return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && !!window.WebMMuxer && !!VS.createRenderCore && !!VS.MODNetWorkerProvider; }

  /**
   * @param {{blob:Blob, jobId?:string, envId:string, states?:object, fps?:number, model?:string, onProgress?:(p:{phase:string,done:number,total:number})=>void, signal?:AbortSignal, bitrate?:number, keepJob?:boolean}} o
   * @returns {Promise<{blob:Blob, frames:number, fps:number, width:number, height:number, durationSec:number, audio:boolean, model:string, masks:{live?:Uint8Array[]}, resumedFrames:number}>}
   */
  async function run(o) {
    if (!supported()) throw new Error('This browser cannot do Enhance (needs WebCodecs: use current Chrome or Edge).');
    const model = C.MODELS[o.model || C.DEFAULT_MODEL]; if (!model || !model.runner) throw new Error('This enhance engine is not enabled: ' + (model && model.note));
    const prog = (phase, done, total) => { try { o.onProgress && o.onProgress({ phase, done, total }); } catch (e) {} };
    await ModelStore.ensure(model.id, { signal: o.signal, onProgress: (f) => prog('model', Math.round(f * 100), 100) });
    // 1. open the raw clip
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; const url = URL.createObjectURL(o.blob); v.src = url;
    try {
      await once(v, 'loadedmetadata');
      if (!isFinite(v.duration)) { v.currentTime = 1e101; await new Promise((r) => v.addEventListener('timeupdate', r, { once: true })); v.currentTime = 0; await once(v, 'seeked'); }   // MediaRecorder files have no duration
      const W = v.videoWidth & ~1, H = v.videoHeight & ~1, plan = C.plan(v.duration, o.fps || 15), N = plan.frames, jobId = o.jobId || ('job-' + (o.blob.size || 0) + '-' + N + '-' + model.id);
      const seekTo = async (i) => { v.currentTime = Math.min(v.duration - 0.001, (i + 0.5) / plan.fps); await once(v, 'seeked'); };
      // 2. pass 1 - matte every frame with MODNet at the enhance size (resumable)
      const seg = new VS.MODNetWorkerProvider(); await seg.initialize('balanced'); seg.longEdge = model.longEdge;
      const alphas = new Array(N).fill(null); let resumed = 0, mw = 0, mh = 0; const job = await Jobs.getJob(jobId).catch(() => null);
      if (job && job.n === N) { mw = job.mw; mh = job.mh; for (let i = 0; i < N; i++) { const m = await Jobs.getMask(jobId, i).catch(() => null); if (m && m.length === mw * mh) { alphas[i] = m; resumed++; } } }
      const rd = document.createElement('canvas'), rx = rd.getContext('2d', { willReadFrequently: true });
      for (let i = 0; i < N; i++) {
        abortCheck(o.signal); if (alphas[i]) { prog('matting', i + 1, N); continue; }
        await seekTo(i); const res = await seg.segment(v); const mc = res.segmentationMask; mw = mc.width; mh = mc.height; rd.width = mw; rd.height = mh; rx.clearRect(0, 0, mw, mh); rx.drawImage(mc, 0, 0);
        const d = rx.getImageData(0, 0, mw, mh).data, a = new Uint8Array(mw * mh); for (let k = 0; k < a.length; k++) a[k] = d[k * 4 + 3]; alphas[i] = a;
        await Jobs.putMask(jobId, i, a).catch(() => {}); if (i === 0 || i % 5 === 0) await Jobs.putJob(jobId, { n: N, mw, mh, fps: plan.fps }).catch(() => {}); prog('matting', i + 1, N);
      }
      await Jobs.putJob(jobId, { n: N, mw, mh, fps: plan.fps }).catch(() => {}); try { seg.dispose && seg.dispose(); } catch (e) {}
      // 3. non-causal temporal filter over the whole clip
      const smooth = C.smoothBidirectional(alphas, { base: 0.4, gate: 40 });
      // 4. render through the live compositor + encode with exact timestamps
      const out = document.createElement('canvas'); out.width = W; out.height = H; const post = (m) => { if (m.type === 'frameDone' && waiter) { const w2 = waiter; waiter = null; w2.res(); } else if (m.type === 'error' && waiter) { const w2 = waiter; waiter = null; w2.rej(new Error(m.message || 'render error')); } }; let waiter = null;
      const core = VS.createRenderCore(post); core.dispatch({ type: 'init', canvas: out, assetsBase: location.href }); core.dispatch({ type: 'resize', w: W, h: H });
      const S = o.states || {}; core.dispatch({ type: 'selectEnvironment', id: o.envId });
      if (S.realism) core.dispatch({ type: 'setRealism', state: S.realism }); if (S.mask) core.dispatch({ type: 'setMask', state: S.mask });
      core.dispatch({ type: 'setMatte', state: Object.assign({ mode: 'gl' }, S.matte || {}) }); if (S.scene) core.dispatch({ type: 'setScene', state: S.scene }); if (S.grade) core.dispatch({ type: 'setGrade', state: S.grade });
      // audio (optional): decode the raw clip's audio and re-encode to Opus
      let audioBuf = null; try { const ac = new (window.OfflineAudioContext || window.AudioContext)(1, 1, 48000); audioBuf = await ac.decodeAudioData(await o.blob.arrayBuffer()); } catch (e) { audioBuf = null; }
      const target = new WebMMuxer.ArrayBufferTarget();
      const muxer = new WebMMuxer.Muxer({ target, video: { codec: 'V_VP8', width: W, height: H, frameRate: plan.fps }, ...(audioBuf ? { audio: { codec: 'A_OPUS', numberOfChannels: Math.min(2, audioBuf.numberOfChannels), sampleRate: 48000 } } : {}), firstTimestampBehavior: 'offset' });
      let encErr = null; const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
      const cfg = { codec: 'vp8', width: W, height: H, bitrate: o.bitrate || Math.max(2e6, Math.round(W * H * 4)), framerate: plan.fps }; const sup = await VideoEncoder.isConfigSupported(cfg); if (!sup.supported) throw new Error('This browser cannot encode VP8 video.'); enc.configure(cfg);
      const mk = document.createElement('canvas'); mk.width = mw; mk.height = mh; const mkx = mk.getContext('2d'); const img = mkx.createImageData(mw, mh);
      for (let i = 0; i < N; i++) {
        abortCheck(o.signal); if (encErr) throw encErr; await seekTo(i);
        const person = await createImageBitmap(v); const a = smooth[i]; for (let k = 0; k < a.length; k++) { img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = 255; img.data[k * 4 + 3] = a[k]; } mkx.putImageData(img, 0, 0); const maskBmp = await createImageBitmap(mk);
        await new Promise((res, rej) => { waiter = { res, rej }; core.dispatch({ type: 'frame', token: i + 1, personBitmap: person, maskBitmap: maskBmp, w: W, h: H }); });
        const vf = new VideoFrame(out, { timestamp: Math.round(i * 1e6 / plan.fps), duration: Math.round(1e6 / plan.fps) }); enc.encode(vf, { keyFrame: i % 30 === 0 }); vf.close(); prog('rendering', i + 1, N);
        if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
      }
      await enc.flush(); enc.close();
      if (audioBuf && typeof AudioEncoder !== 'undefined') { try {
        const ch = Math.min(2, audioBuf.numberOfChannels), sr = audioBuf.sampleRate, total = Math.min(audioBuf.length, Math.round(plan.durationSec * sr)); let aerr = null;
        const ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { aerr = e; } }); ae.configure({ codec: 'opus', numberOfChannels: ch, sampleRate: sr, bitrate: 96000 });
        const FR = 960 * (sr / 48000 | 0 || 1); for (let s = 0; s < total; s += FR) { const n = Math.min(FR, total - s), buf = new Float32Array(n * ch); for (let c = 0; c < ch; c++) buf.set(audioBuf.getChannelData(c).subarray(s, s + n), c * n); const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round(s * 1e6 / sr), data: buf }); ae.encode(ad); ad.close(); }
        await ae.flush(); ae.close(); if (aerr) throw aerr; } catch (e) { audioBuf = null; } }
      muxer.finalize(); const blob = new Blob([target.buffer], { type: 'video/webm' });
      if (!o.keepJob) await Jobs.clear(jobId, N).catch(() => {});
      return { blob, frames: N, fps: plan.fps, width: W, height: H, durationSec: plan.durationSec, audio: !!audioBuf, model: model.id, resumedFrames: resumed, masks: { raw: alphas, smooth }, truncated: plan.truncated };
    } finally { URL.revokeObjectURL(url); }
  }

  // ---- Small UI: one button on a recording row (same pattern as Trim / RenderUI). Plain-language, never blocks recording. ----
  function attach(item, getRaw, onSaved) {
    if (!supported()) return; const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small'; b.textContent = 'Enhance quality'; b.title = 'Re-process your original camera footage for a cleaner cut-out. Takes a few minutes; runs on this device.';
    const st = document.createElement('span'); st.className = 'muted'; st.style.marginLeft = '8px'; let ctl = null;
    b.addEventListener('click', async () => {
      if (ctl) { ctl.abort(); return; } const raw = await getRaw(); if (!raw) { st.textContent = 'No original footage was kept for this take. Turn on "Keep original for Enhance" before recording.'; return; }
      ctl = new AbortController(); b.textContent = 'Cancel'; const label = { model: 'Preparing', matting: 'Cleaning edges', rendering: 'Rendering' };
      try { const r = await run({ blob: raw.blob, envId: raw.envId, states: raw.states, fps: raw.fps, signal: ctl.signal, onProgress: (p) => { st.textContent = (label[p.phase] || p.phase) + ' ' + p.done + '/' + p.total; } });
        st.textContent = 'Done (' + r.frames + ' frames' + (r.audio ? ', with audio' : ', no audio') + ').'; const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = 'genesis-enhanced-' + Date.now() + '.webm'; a.textContent = ' Download enhanced'; item.appendChild(a); onSaved && onSaved(r.blob);
      } catch (e) { st.textContent = e && e.name === 'AbortError' ? 'Cancelled. Press Enhance again to continue where it stopped.' : 'Enhance failed: ' + (e && e.message ? e.message : e); }
      ctl = null; b.textContent = 'Enhance quality';
    });
    item.appendChild(b); item.appendChild(st);
  }

  VS.Enhance = { run, ModelStore, Jobs, supported };
  VS.EnhanceUI = { attach };
})();
