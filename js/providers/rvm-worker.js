/* RVM (Robust Video Matting, MobileNetV3) inference worker. Same job as modnet-worker.js: onnxruntime-web (vendor/ort, bundled) and the
 * model live INSIDE the worker, so loading and inference never block the page. WASM only on purpose: the WebGPU path is unverified for
 * RVM's recurrent (ConvGRU) graph and a wrong mask is worse than a slow one.
 * Protocol (every message carries an id):
 *   {type:'init', base, modelUrl}              -> {type:'ready', gpu:false} | {type:'error', message}
 *   {type:'run', w, h, rgba:ArrayBuffer}       -> {type:'result', w, h, alpha:ArrayBuffer(uint8 w*h)} | {type:'error', message}
 *   {type:'reset'}                             -> forget the recurrent memory (new scene / camera restart)
 *   {type:'dispose'}
 * RVM keeps its own memory of the previous frame (r1..r4), which is why its mask flickers less than a per-frame model.
 * Cost control: the network analyses a DOWNSCALED copy (downsample_ratio) and refines the alpha back up to the size we send, so the
 * work stays almost constant while the output gets sharper. ds = min(1, 168 / longEdge), the same rule as RVMWorkerProvider.downsampleFor. */
'use strict';
let session = null, rec = null, curW = 0, curH = 0, analysisEdge = 168, disposed = false;
const REC_NAMES = ['r1i', 'r2i', 'r3i', 'r4i'];
const REC_OUTPUT_NAMES = ['r1o', 'r2o', 'r3o', 'r4o'];
const MAX_INPUT_PIXELS = 8 * 1024 * 1024;
function downsampleFor(w, h, edge) { return Math.min(1, (edge || analysisEdge) / Math.max(w, h)); }
function validSize(w, h) { return Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 4096 && h <= 4096 && w * h <= MAX_INPUT_PIXELS; }
function zeroState() { return REC_NAMES.map(() => new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])); }

async function init(m) {
  const base = m.base;
  if (!base || !m.modelUrl) throw new Error('RVM init requires base and modelUrl');
  analysisEdge = [168, 224, 256, 320].includes(m.analysisEdge) ? m.analysisEdge : 168;
  disposed = false;
  importScripts(base + 'vendor/ort/ort.min.js');
  try { importScripts(base + 'js/providers/mask-clean.js'); } catch (e) { /* optional */ }
  ort.env.wasm.wasmPaths = { mjs: base + 'vendor/ort/ort-wasm-simd-threaded.js', wasm: base + 'vendor/ort/ort-wasm-simd-threaded.wasm' };
  ort.env.wasm.numThreads = (m.threads | 0) > 1 ? (m.threads | 0) : 1; ort.env.wasm.proxy = false;
  const res = await fetch(m.modelUrl);
  if (!res.ok) throw new Error('RVM model HTTP ' + res.status);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 1000000) throw new Error('RVM model file too small');
  session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all', extra: { session: { intra_op: { allow_spinning: '0' } } } });
  for (const n of ['src', 'downsample_ratio', ...REC_NAMES]) if (!session.inputNames.includes(n)) throw new Error('RVM model has no input ' + n);
  for (const n of ['pha', 'r1o', 'r2o', 'r3o', 'r4o']) if (!session.outputNames.includes(n)) throw new Error('RVM model has no output ' + n);
  rec = zeroState(); curW = 0; curH = 0;
}

async function run(m) {
  if (!session || disposed) throw new Error('RVM worker is not initialized');
  const w = m.w, h = m.h;
  if (!validSize(w, h)) throw new Error('RVM frame dimensions are invalid or exceed the 8-megapixel safety limit');
  if (!(m.rgba instanceof ArrayBuffer) || m.rgba.byteLength !== w * h * 4) throw new Error('RVM frame buffer size does not match its dimensions');
  const size = w * h, data = new Uint8ClampedArray(m.rgba);
  if (w !== curW || h !== curH) { rec = zeroState(); curW = w; curH = h; }   // a new size invalidates the memory's shape
  const chw = new Float32Array(3 * size);
  for (let i = 0; i < size; i++) { chw[i] = data[i * 4] / 255; chw[size + i] = data[i * 4 + 1] / 255; chw[2 * size + i] = data[i * 4 + 2] / 255; }
  const feeds = { src: new ort.Tensor('float32', chw, [1, 3, h, w]), downsample_ratio: new ort.Tensor('float32', new Float32Array([downsampleFor(w, h, analysisEdge)]), [1]) };
  REC_NAMES.forEach((n, i) => { feeds[n] = rec[i]; });
  const out = await session.run(feeds);
  if (!out || !out.pha || !ArrayBuffer.isView(out.pha.data) || !Array.isArray(out.pha.dims) || out.pha.dims.length < 2) throw new Error('RVM returned no usable alpha matte');
  const dims = out.pha.dims, oh = dims[dims.length - 2], ow = dims[dims.length - 1], pha = out.pha.data;
  if (!validSize(ow, oh) || pha.length !== ow * oh) throw new Error('RVM returned an invalid alpha matte shape');
  // Do not commit recurrent memory until every output has passed validation.
  // A partially malformed graph result must not poison the next frame's state.
  const nextRec = REC_OUTPUT_NAMES.map((name) => {
    const state = out[name];
    if (!state || !ArrayBuffer.isView(state.data) || !Array.isArray(state.dims) || !state.dims.length ||
        state.dims.some((d) => !Number.isInteger(d) || d < 1) ||
        state.dims.reduce((n, d) => n * d, 1) !== state.data.length) {
      throw new Error('RVM returned an invalid recurrent state: ' + name);
    }
    return state;
  });
  const alpha = new Uint8Array(ow * oh);
  for (let i = 0; i < alpha.length; i++) { const v = pha[i]; alpha[i] = !Number.isFinite(v) || v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0; }
  try { if (self.VS && self.VS.MaskClean) self.VS.MaskClean.clean(alpha, ow, oh); } catch (e) { /* cleanup is optional */ }
  rec = nextRec;
  return { w: ow, h: oh, alpha };
}

// RVM is recurrent: frame N+1 consumes the state emitted by frame N. Web
// Worker message events can overlap while an earlier session.run() is still
// awaiting, so serialize *all* state-changing commands (including reset).
let messageQueue = Promise.resolve();
async function dispatch(m) {
  const id = m && m.id;
  try {
    if (!m || typeof m.type !== 'string') throw new Error('RVM worker received an invalid message');
    if (m.type === 'init') { await init(m); self.postMessage({ id, type: 'ready', gpu: false, note: '', analysisEdge }); }
    else if (m.type === 'run') { const r = await run(m); self.postMessage({ id, type: 'result', w: r.w, h: r.h, alpha: r.alpha.buffer }, [r.alpha.buffer]); }
    else if (m.type === 'reset') {
      if (!session || disposed) throw new Error('RVM worker is not initialized');
      rec = zeroState(); curW = 0; curH = 0;
      self.postMessage({ id, type: 'reset-done' });
    }
    else if (m.type === 'dispose') {
      disposed = true;
      try { session && session.release && session.release(); } catch (e) { /* ignore */ }
      session = null; rec = null; curW = 0; curH = 0;
      self.postMessage({ id, type: 'disposed' });
    }
    else throw new Error('RVM worker received an unsupported message type');
  } catch (e) {
    self.postMessage({ id, type: 'error', message: String((e && e.message) || e).slice(0, 300) });
  }
}
self.onmessage = (ev) => {
  const m = ev && ev.data;
  messageQueue = messageQueue.then(() => dispatch(m), () => dispatch(m));
};
