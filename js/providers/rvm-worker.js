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
let session = null, rec = null, curW = 0, curH = 0;
const REC_NAMES = ['r1i', 'r2i', 'r3i', 'r4i'];
function downsampleFor(w, h) { return Math.min(1, 168 / Math.max(w, h)); }
function zeroState() { return REC_NAMES.map(() => new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])); }

async function init(m) {
  const base = m.base;
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
  rec = zeroState(); curW = 0; curH = 0;
}

async function run(m) {
  const w = m.w, h = m.h, size = w * h, data = new Uint8ClampedArray(m.rgba);
  if (w !== curW || h !== curH) { rec = zeroState(); curW = w; curH = h; }   // a new size invalidates the memory's shape
  const chw = new Float32Array(3 * size);
  for (let i = 0; i < size; i++) { chw[i] = data[i * 4] / 255; chw[size + i] = data[i * 4 + 1] / 255; chw[2 * size + i] = data[i * 4 + 2] / 255; }
  const feeds = { src: new ort.Tensor('float32', chw, [1, 3, h, w]), downsample_ratio: new ort.Tensor('float32', new Float32Array([downsampleFor(w, h)]), [1]) };
  REC_NAMES.forEach((n, i) => { feeds[n] = rec[i]; });
  const out = await session.run(feeds);
  rec = [out.r1o, out.r2o, out.r3o, out.r4o];
  const pha = out.pha.data, dims = out.pha.dims, oh = dims[dims.length - 2], ow = dims[dims.length - 1], alpha = new Uint8Array(ow * oh);
  for (let i = 0; i < alpha.length; i++) { const v = pha[i]; alpha[i] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0; }
  try { if (self.VS && self.VS.MaskClean) self.VS.MaskClean.clean(alpha, ow, oh); } catch (e) { /* cleanup is optional */ }
  return { w: ow, h: oh, alpha };
}

self.onmessage = async (ev) => {
  const m = ev.data, id = m.id;
  try {
    if (m.type === 'init') { await init(m); self.postMessage({ id, type: 'ready', gpu: false, note: '' }); }
    else if (m.type === 'run') { const r = await run(m); self.postMessage({ id, type: 'result', w: r.w, h: r.h, alpha: r.alpha.buffer }, [r.alpha.buffer]); }
    else if (m.type === 'reset') { rec = zeroState(); curW = 0; curH = 0; self.postMessage({ id, type: 'reset-done' }); }
    else if (m.type === 'dispose') { try { session && session.release && session.release(); } catch (e) { /* ignore */ } session = null; rec = null; }
  } catch (e) { self.postMessage({ id, type: 'error', message: String((e && e.message) || e).slice(0, 300) }); }
};
