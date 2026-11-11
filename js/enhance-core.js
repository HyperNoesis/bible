/**
 * Enhance (premium export) - PURE logic, no DOM. Unit-tested in tools/e2e/unit_enhance.js.
 * Enhance re-mattes a RAW camera recording offline with things the live loop cannot afford: a bigger MODNet input, a NON-CAUSAL
 * (forward + backward) temporal filter, and the same compositor/look as live. Honest limits are in docs/PROMPT2_REPORT.md.
 */
(function (root) {
  const VS = root.VS = root.VS || {};

  // Model registry. `runner:null` = measured and NOT enabled (see docs/PROMPT2_REPORT.md). Licences verified on the official repos (Oct 30 2026).
  const MODELS = {
    'modnet-hq': { id: 'modnet-hq', name: 'MODNet, high quality (offline)', licence: 'Apache-2.0', licenceUrl: 'https://github.com/ZHKKKe/MODNet/blob/master/LICENSE',
      url: 'models/modnet.onnx', bytes: 13066403, sha256: '8ab20e3ff799e90f71fad2d6dc1f4e3b0dc7b18c1a9b7f545f358b095e4d4940', longEdge: 512, runner: 'modnet-worker', minMemoryGb: 0, needsWebGpu: false },
    'birefnet-tiny': { id: 'birefnet-tiny', name: 'BiRefNet swin-tiny (1024 px)', licence: 'MIT', licenceUrl: 'https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE',
      url: 'https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx', bytes: 224005088,
      sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333', longEdge: 1024, runner: null, minMemoryGb: 8, needsWebGpu: true,
      note: 'Not enabled: a 1024x1024 pass was killed by the OS on a 4 GB machine (onnxruntime CPU), so it cannot be offered on phones. Needs a WebGPU desktop test first.' },
    'ben2-base': { id: 'ben2-base', name: 'BEN2 base', licence: 'MIT', licenceUrl: 'https://github.com/PramaLLC/BEN2/blob/main/LICENSE',
      url: 'https://huggingface.co/PramaLLC/BEN2/resolve/main/BEN2_Base.onnx', bytes: 0, sha256: '', longEdge: 1024, runner: null, minMemoryGb: 8, needsWebGpu: true,
      note: 'Not measured: the ONNX file is hosted on Hugging Face, which the build sandbox cannot reach.' },
  };
  const DEFAULT_MODEL = 'modnet-hq';

  /** Which engines may be OFFERED on this device. Pure: pass {deviceMemory, webgpu}. */
  function availableModels(sig) {
    sig = sig || {};
    return Object.values(MODELS).filter((m) => m.runner && (!m.needsWebGpu || sig.webgpu) && (!(m.minMemoryGb > 0) || (sig.deviceMemory || 0) >= m.minMemoryGb)).map((m) => m.id);
  }

  /** Frames to process for a clip. fps is the OUTPUT rate; capped so a phone job stays bounded. */
  function plan(durationSec, fps, maxFrames) {
    fps = Math.max(1, Math.min(60, fps | 0 || 15)); maxFrames = maxFrames || 1800;
    const n = Math.max(1, Math.min(maxFrames, Math.floor(durationSec * fps + 1e-6)));
    return { fps, frames: n, durationSec: n / fps, truncated: durationSec * fps > maxFrames + 1e-6 };
  }

  /**
   * Zero-phase temporal smoothing of per-frame alpha masks (Uint8Array, same size). Forward then backward, each motion-gated:
   * pixels that change a lot (you moved) pass through, small changes (flicker) are averaged. No ghost trail, no lag.
   * @param {Uint8Array[]} masks  @param {{base?:number, gate?:number}} o  base = weight of the NEW frame for small changes (lower = smoother)
   */
  function smoothBidirectional(masks, o) {
    o = o || {}; const base = o.base != null ? o.base : 0.4, gate = o.gate != null ? o.gate : 40, n = masks.length;
    if (n < 2) return masks.map((m) => m.slice());
    const len = masks[0].length, out = masks.map((m) => new Uint8Array(m));
    const pass = (order) => { let prev = null; for (const k of order) { const cur = out[k]; if (prev) for (let i = 0; i < len; i++) { const d = cur[i] - prev[i], ad = d < 0 ? -d : d; const w = ad >= gate ? 1 : base + (1 - base) * (ad / gate); cur[i] = Math.round(prev[i] + w * d); } prev = cur; } };
    pass([...Array(n).keys()]); pass([...Array(n).keys()].reverse());
    return out;
  }

  /** Mean abs difference between consecutive masks (0..255). */
  function flicker(masks) { if (masks.length < 2) return 0; let t = 0; for (let k = 1; k < masks.length; k++) { let s = 0; const a = masks[k], b = masks[k - 1]; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); t += s / a.length; } return t / (masks.length - 1); }
  /** Mean abs error vs ground truth (0..255) inside the edge band (pixels where gt is partial, grown by `grow` px). */
  function edgeBandError(mask, gt, w, h, grow) {
    grow = grow == null ? 4 : grow; const band = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const g = gt[y * w + x]; if (g > 5 && g < 250) for (let dy = -grow; dy <= grow; dy++) for (let dx = -grow; dx <= grow; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) band[yy * w + xx] = 1; } }
    let s = 0, n = 0; for (let i = 0; i < w * h; i++) if (band[i]) { s += Math.abs(mask[i] - gt[i]); n++; } return n ? s / n : 0;
  }

  /** Resume bookkeeping: which frames of pass 1 are already stored. */
  function nextFrameToDo(done, total) { for (let i = 0; i < total; i++) if (!done[i]) return i; return total; }

  VS.EnhanceCore = { MODELS, DEFAULT_MODEL, availableModels, plan, smoothBidirectional, flicker, edgeBandError, nextFrameToDo };
  if (typeof module !== 'undefined') module.exports = VS.EnhanceCore;
})(typeof self !== 'undefined' ? self : this);
