/* Local hand tracking (MediaPipe Hands legacy solution, files in vendor/mediapipe/hands, lite model, SIMD wasm only).
 * Offline, Apache-2.0. NOT wired into the studio UI and NOT run in a browser yet (UNVERIFIED): load js/hand-gesture-core.js first,
 * then `const h = new VS.HandsProvider(); await h.initialize(); const g = await h.gesture(videoEl);` ~ every 100 ms is plenty. */
(function (root) {
  const VS = root.VS = root.VS || {};
  const BASE = 'vendor/mediapipe/hands/';
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s); }); }
  class HandsProvider {
    constructor() { this.hands = null; this._last = null; this.label = 'MediaPipe Hands (local, lite)'; }
    async initialize() {
      if (!root.Hands) await loadScript(BASE + 'hands.js');
      this.hands = new root.Hands({ locateFile: (f) => BASE + f });
      this.hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5, selfieMode: false });
      this.hands.onResults((r) => { this._last = r.multiHandLandmarks && r.multiHandLandmarks[0] || null; });
      await this.hands.initialize();
    }
    /** @returns {Promise<{gesture:string, landmarks:Array|null}>} */
    async gesture(video) {
      await this.hands.send({ image: video });
      const lm = this._last;
      return { gesture: VS.HandGesture ? VS.HandGesture.classify(lm) : 'none', landmarks: lm };
    }
    dispose() { try { this.hands && this.hands.close(); } catch (e) { /* ignore */ } this.hands = null; }
  }
  VS.HandsProvider = HandsProvider;
})(typeof self !== 'undefined' ? self : this);
