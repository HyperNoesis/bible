// Mocked RVM worker protocol regression: recurrent inference and reset are serialized.
const fs = require('fs'), path = require('path'), vm = require('vm');
const R = path.resolve(__dirname, '..', '..');
const src = fs.readFileSync(path.join(R, 'js/providers/rvm-worker.js'), 'utf8');
const replies = [], seenState = [];
let active = 0, maxActive = 0, callNo = 0, released = false;
class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
const fakeSession = {
  inputNames: ['src', 'downsample_ratio', 'r1i', 'r2i', 'r3i', 'r4i'],
  outputNames: ['pha', 'r1o', 'r2o', 'r3o', 'r4o'],
  async run(feeds) {
    active++; maxActive = Math.max(maxActive, active); callNo++;
    seenState.push(feeds.r1i.data[0]);
    const marker = feeds.src.data[0];
    await new Promise(resolve => setTimeout(resolve, marker < 0.5 ? 15 : 2));
    active--;
    const state = new Tensor('float32', new Float32Array([callNo]), [1,1,1,1]);
    const result = { pha: new Tensor('float32', new Float32Array(feeds.src.dims[2] * feeds.src.dims[3]).fill(0.6), [1,1,feeds.src.dims[2],feeds.src.dims[3]]), r1o: state, r2o: state, r3o: state, r4o: state };
    if (marker > 0.8) delete result.r4o; // one deliberately malformed graph response
    return result;
  },
  release() { released = true; }
};
const ort = { env: { wasm: {} }, Tensor, InferenceSession: { create: async () => fakeSession } };
const self = { postMessage(m) { replies.push(m); } };
const context = { self, ort, Uint8Array, Uint8ClampedArray, Float32Array, ArrayBuffer, Number, Math, Promise, setTimeout,
  importScripts() {}, fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1024 * 1024) }) };
vm.runInNewContext(src, context, { filename: 'rvm-worker.js' });
const send = (id, type, extra={}) => self.onmessage({ data: { id, type, ...extra } });
const pause = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  send(1, 'init', { base: 'https://example.test/', modelUrl: 'model.onnx', analysisEdge: 224 });
  send(2, 'run', { w: 16, h: 16, rgba: new ArrayBuffer(16*16*4) });
  send(3, 'run', { w: 16, h: 16, rgba: new ArrayBuffer(16*16*4) });
  send(4, 'reset');
  send(5, 'run', { w: 16, h: 16, rgba: new ArrayBuffer(16*16*4) });
  await pause(120);
  const byId = id => replies.find(x => x.id === id);
  let bad = 0;
  const t = (name, ok, extra='') => { if (!ok) bad++; console.log((ok?'PASS ':'FAIL ')+name+(extra?' '+extra:'')); };
  t('init acknowledged with selected analysis edge', byId(1)?.type === 'ready' && byId(1)?.analysisEdge === 224);
  t('both frame outputs returned', byId(2)?.type === 'result' && byId(3)?.type === 'result');
  t('recurrent session.run never overlaps', maxActive === 1, 'maxActive='+maxActive);
  t('second frame consumes first frame recurrent state', seenState.length >= 2 && seenState[1] === 1, JSON.stringify(seenState));
  t('reset acknowledgement occurs before the post-reset inference', !!byId(4) && !!byId(5) && replies.indexOf(byId(4)) < replies.indexOf(byId(5)));
  t('post-reset frame starts with zero recurrent state', seenState.length === 3 && seenState[2] === 0, JSON.stringify(seenState));
  send(6, 'run', { w: 16, h: 16, rgba: new ArrayBuffer(8) });
  await pause(10);
  t('mismatched RGBA buffer is rejected', byId(6)?.type === 'error');
  const malformedFrame = new Uint8Array(16*16*4); malformedFrame[0] = 255;
  send(8, 'run', { w: 16, h: 16, rgba: malformedFrame.buffer }); await pause(20);
  t('malformed recurrent state is rejected', byId(8)?.type === 'error' && /invalid recurrent state/.test(byId(8)?.message || ''));
  send(9, 'run', { w: 16, h: 16, rgba: new ArrayBuffer(16*16*4) }); await pause(20);
  t('invalid model output does not poison the next recurrent input', seenState.length === 5 && seenState[4] === seenState[3], JSON.stringify(seenState));
  send(7, 'dispose'); await pause(10);
  t('dispose releases the inference session', released && byId(7)?.type === 'disposed');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
