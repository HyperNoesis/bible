/**
 * RVMWorkerProvider: Robust Video Matting (MobileNetV3) as a LIVE matting tier, run in a background worker (js/providers/rvm-worker.js).
 * Sits between MediaPipe (light, blocky mask) and MODNet (heavier) in app.js's speed-tested upgrade: same interface as MODNetWorkerProvider
 * (it extends it), so the ladder, the mask painting and the engine swap are shared code.
 *
 * Why it exists: measured on one CPU thread, RVM at 448x336 took about 35 ms where MODNet at 256x192 took about 84 ms, and RVM keeps a
 * memory of the previous frame (less flicker). Real-face quality is NOT yet verified (the test clip is synthetic).
 * Model file: models/rvm_mobilenetv3_fp32.onnx (same origin, 15 MB; scripts/restore-big-files.sh fetches it).
 * LICENCE: RobustVideoMatting is GPL-3.0 (see LICENSES.md). The owner chose to ship it; keep this note with the code.
 * Turn it off without a rebuild: localStorage vs_live_engine = 'modnet' (or 'light').
 */
const RVM_LITE_MODEL = 'models/rvm_mobilenetv3_fp32.onnx';
const STUDENT_MODEL = 'models/genesis_student.onnx';   // your own trained student (server/student-train); opt-in only until promote_gate.py says PROMOTE
const RVM_LITE_EDGE = { fast: 320, balanced: 448, quality: 448 };   // long edge (px) of the picture sent to the model

class RVMWorkerProvider extends window.VS.MODNetWorkerProvider {
  constructor() { super(); this.label = 'RVM matting (background worker)'; this.engine = 'rvm'; this.useRoi = false; this.modelPath = RVM_LITE_MODEL; this.sizeStep = 16; }   // RVM keeps a memory of the last frame: its input must keep one fixed shape, so no person crop here
  /** Same rule as the worker: the model analyses ~168 px and refines the matte up to the size we send. */
  static downsampleFor(w, h) { return Math.min(1, 168 / Math.max(w, h)); }
  /** Model input size for a camera size and long edge (multiples of 16 so every internal stride lines up). */
  static sizeFor(vw, vh, longEdge, step) {
    step = step || 16; const scale = Math.min(1, longEdge / Math.max(vw, vh));
    return [Math.max(step, Math.round((vw * scale) / step) * step), Math.max(step, Math.round((vh * scale) / step) * step)];
  }
  _configure(vw, vh) {
    const [mw, mh] = RVMWorkerProvider.sizeFor(vw, vh, this.longEdge, this.sizeStep);
    if (mw !== this._mw || mh !== this._mh) { this._mw = mw; this._mh = mh; this._inputCanvas.width = mw; this._inputCanvas.height = mh; }
  }
  async initialize(qualityMode, opts) {
    opts = opts || {};
    this.longEdge = RVM_LITE_EDGE[qualityMode] || RVM_LITE_EDGE.balanced;
    const want = (opts.threads | 0) > 0 ? (opts.threads | 0) : RVMWorkerProvider.threadsFor();
    await this._boot('js/providers/rvm-worker.js', (base) => ({ modelUrl: new URL(this.modelPath, base).href }), want);
    this.usingWebGPU = false; this.initNote = ''; this._ready = true;
    this.label = 'RVM matting (background worker, WASM' + (this.threads > 1 ? ' x' + this.threads : '') + ')';
    this._mw = 0; this._mh = 0;
  }
  async reset() { if (this._ready) await this._send({ type: 'reset' }); }
}
window.VS.RVMWorkerProvider = RVMWorkerProvider;
/** Genesis student: same recurrent contract as RVM minus downsample_ratio, H and W multiples of 32. Own weights, no GPL. Opt-in: localStorage vs_live_engine = 'student'. */
class StudentWorkerProvider extends RVMWorkerProvider {
  constructor() { super(); this.label = 'Genesis student matting (background worker)'; this.engine = 'student'; this.modelPath = STUDENT_MODEL; this.sizeStep = 32; }
  async initialize(qualityMode, opts) { await super.initialize(qualityMode, opts); this.label = this.label.replace('RVM matting', 'Genesis student matting'); }
}
window.VS.StudentWorkerProvider = StudentWorkerProvider;
