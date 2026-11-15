// Real ONNX Runtime Web/WASM inference on the repository's synthetic camera fixture.
// This is an offline model smoke/relative benchmark, NOT a real-person quality certificate.
'use strict';
const fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const tmp = path.resolve(process.argv[3] || process.cwd());
const count = Math.max(2, Math.min(60, Number(process.argv[4]) || 12));
const ort = require(path.join(root, 'vendor/ort/ort.min.js'));
ort.env.wasm.wasmPaths = {
  wasm: path.join(root, 'vendor/ort/ort-wasm-simd-threaded.wasm'),
  mjs: path.join(root, 'vendor/ort/ort-wasm-simd-threaded.js')
};
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
global.self = global;
global.VS = {};
require(path.join(root, 'js/providers/mask-clean.js'));

function readFrames(file, w, h, n) {
  const b = fs.readFileSync(file), bytes = w * h * 3;
  if (b.length !== bytes * n) throw new Error(`Bad RGB fixture ${file}: expected ${bytes*n} bytes, got ${b.length}`);
  return Array.from({ length: n }, (_, i) => new Uint8Array(b.buffer, b.byteOffset + i * bytes, bytes));
}
function chwRgb(frame, w, h, modnet) {
  const pixels = w * h, out = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    const k = i * 3, scale = modnet ? 127.5 : 255, bias = modnet ? -1 : 0;
    out[i] = frame[k] / scale + bias;
    out[pixels + i] = frame[k + 1] / scale + bias;
    out[2 * pixels + i] = frame[k + 2] / scale + bias;
  }
  return out;
}
function alphaU8(tensor, expectedW, expectedH) {
  if (!tensor || !tensor.data || !tensor.dims || tensor.dims.length < 2) throw new Error('Model returned no alpha tensor');
  const h = tensor.dims[tensor.dims.length - 2], w = tensor.dims[tensor.dims.length - 1];
  if (w !== expectedW || h !== expectedH || tensor.data.length !== w * h) throw new Error(`Unexpected alpha dimensions ${w}x${h}`);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const v = tensor.data[i];
    out[i] = !Number.isFinite(v) || v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }
  VS.MaskClean.clean(out, w, h);
  return out;
}
function stats(times) {
  const a = times.slice().sort((x, y) => x - y);
  const q = p => a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))];
  const measured = a.length > 1 ? a.slice(1) : a; // report warmed steady state separately from frame 1
  const q2 = p => measured[Math.min(measured.length - 1, Math.floor((measured.length - 1) * p))];
  return { firstFrameMs: times[0], medianMs: q2(0.5), p95Ms: q2(0.95), samples: times.length };
}
async function runRvm() {
  const file = path.join(root, 'models/rvm_mobilenetv3_fp32.onnx');
  if (!fs.existsSync(file)) throw new Error('RVM model missing: ' + file);
  const W = 448, H = 336, frames = readFrames(path.join(tmp, 'frames-rvm.rgb'), W, H, count);
  const session = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(file)), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  for (const k of ['src', 'downsample_ratio', 'r1i', 'r2i', 'r3i', 'r4i']) if (!session.inputNames.includes(k)) throw new Error('RVM input missing: ' + k);
  for (const k of ['pha', 'r1o', 'r2o', 'r3o', 'r4o']) if (!session.outputNames.includes(k)) throw new Error('RVM output missing: ' + k);
  const results = [];
  for (const edge of [168, 224, 256, 320]) {
    let rec = ['r1i', 'r2i', 'r3i', 'r4i'].map(() => new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]));
    const times = [], masks = [];
    for (const frame of frames) {
      const feeds = {
        src: new ort.Tensor('float32', chwRgb(frame, W, H, false), [1, 3, H, W]),
        downsample_ratio: new ort.Tensor('float32', new Float32Array([Math.min(1, edge / Math.max(W, H))]), [1])
      };
      ['r1i', 'r2i', 'r3i', 'r4i'].forEach((k, i) => { feeds[k] = rec[i]; });
      const start = performance.now(), out = await session.run(feeds);
      times.push(performance.now() - start);
      rec = ['r1o', 'r2o', 'r3o', 'r4o'].map(k => out[k]);
      masks.push(alphaU8(out.pha, W, H));
    }
    fs.writeFileSync(path.join(tmp, `rvm-${edge}.alpha`), Buffer.concat(masks.map(Buffer.from)));
    results.push({ engine: 'rvm', analysisEdge: edge, ...stats(times) });
  }
  await session.release();
  return results;
}
async function runModnet() {
  const file = path.join(root, 'models/modnet.onnx');
  if (!fs.existsSync(file)) throw new Error('MODNet model missing: ' + file);
  const W = 448, H = 352, frames = readFrames(path.join(tmp, 'frames-modnet.rgb'), W, H, count);
  const session = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(file)), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const inputName = session.inputNames[0], outputName = session.outputNames[0];
  const times = [], masks = [];
  for (const frame of frames) {
    const input = new ort.Tensor('float32', chwRgb(frame, W, H, true), [1, 3, H, W]);
    const start = performance.now(), out = await session.run({ [inputName]: input });
    times.push(performance.now() - start);
    masks.push(alphaU8(out[outputName] || out[Object.keys(out)[0]], W, H));
  }
  fs.writeFileSync(path.join(tmp, 'modnet.alpha'), Buffer.concat(masks.map(Buffer.from)));
  await session.release();
  return [{ engine: 'modnet', ...stats(times) }];
}
(async () => {
  const rvm = await runRvm();
  const modnet = await runModnet();
  fs.writeFileSync(path.join(tmp, 'timings.json'), JSON.stringify([...rvm, ...modnet], null, 2));
  process.stdout.write(JSON.stringify([...rvm, ...modnet]));
})().catch(err => { console.error(err && err.stack || err); process.exit(1); });
