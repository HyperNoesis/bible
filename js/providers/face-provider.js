/* Local face landmarks (MediaPipe Face Mesh legacy solution, files in vendor/mediapipe/face_mesh, SIMD wasm only, Apache-2.0).
 * NOT run in a browser yet (UNVERIFIED). const f = new VS.FaceProvider(); await f.initialize(); const lm = await f.landmarks(videoEl); */
(function (root) {
  const VS = root.VS = root.VS || {};
  const BASE = 'vendor/mediapipe/face_mesh/';
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s); }); }
  class FaceProvider {
    constructor() { this.fm = null; this._last = null; this.label = 'MediaPipe Face Mesh (local)'; }
    async initialize() {
      if (!root.FaceMesh) await loadScript(BASE + 'face_mesh.js');
      this.fm = new root.FaceMesh({ locateFile: (f) => BASE + f });
      this.fm.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5, selfieMode: false });
      this.fm.onResults((r) => { this._last = r.multiFaceLandmarks && r.multiFaceLandmarks[0] || null; });
      await this.fm.initialize();
    }
    async landmarks(video) { this._last = null; await this.fm.send({ image: video }); return this._last; }
    dispose() { try { this.fm && this.fm.close(); } catch (e) { /* ignore */ } this.fm = null; }
  }
  VS.FaceProvider = FaceProvider;
})(typeof self !== 'undefined' ? self : this);
