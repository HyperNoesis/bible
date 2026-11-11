/**
 * Realism engine — makes the composite look shot-together instead of
 * cut-and-pasted, using cheap canvas math only. No ML model, no paid API,
 * runs every frame at interactive framerate.
 *
 * Techniques, in the order they're applied to the final composite:
 *  1. Tone match   — sample the environment's average color/luminance and
 *     nudge the person layer's brightness/contrast/saturation/warmth
 *     toward it via a canvas `filter` string (cheap: no per-pixel JS loop).
 *  2. Contact shadow — soft elliptical gradient under the subject's feet,
 *     derived from the mask's bounding box, tinted from the environment.
 *  3. Light wrap / rim light — (v0.82 rewrite) the scene's own blurred colours
 *     screened onto a thin band just inside the silhouette, so a bright window on
 *     the left lights the left edge and a dark wall on the right does not.
 *     BEFORE v0.82 this step tinted the WHOLE frame toward the average scene colour
 *     (measured: far background 234,187,109 -> 206,165,100 and 22,28,49 -> 49,48,55),
 *     i.e. it washed out contrast whenever Light wrap was ticked.
 *  4. Grain match — a tileable noise texture blended over the whole frame
 *     so the clean webcam layer doesn't look suspiciously cleaner than a
 *     compressed/generated background.
 *
 * Environment tone sampling is throttled (not every frame) since the
 * background is static between environment switches.
 */
(function () {
  // Works both as a normal <script> (main thread) and via importScripts()
  // inside the render worker — OffscreenCanvas exists in both contexts in
  // every modern browser, so scratch canvases here never need `document`.
  function scratchCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w || 1, h || 1);
    const c = document.createElement('canvas');
    c.width = w || 1; c.height = h || 1;
    return c;
  }

  class RealismEngine {
    constructor() {
      this.enabled = false;      // master "make it believable" toggle
      this.toneMatch = true;
      this.shadow = true;
      this.lightWrap = true;
      this.grain = true;
      this.intensity = 0.7;      // 0..1 global strength dial
      this.abPreview = false;    // when true, right half renders WITHOUT effects
      // FAST mode (see setPerf in render-core.js): skips light wrap only — it
      // costs two extra full-frame draws per frame, one through a 10px blur.
      // Tone match, contact shadow and grain are cheap and stay as chosen.
      this.lite = false;

      this.castShadow = true;    // v0.82: directional silhouette shadow on the plain-environment path (follows the Contact shadow toggle)
      this._envSmall = null;     // 32x32 snapshot of the scene taken BEFORE the person is drawn (colour map for the light wrap)
      this._side = 0;            // -1..+1, positive = the left of the scene is brighter (light comes from the left)
      this._envTone = { r: 128, g: 128, b: 128, lum: 128 };
      this._envToneSampleCounter = 0;
      this._noiseCanvas = this._buildNoiseTile(128);
    }

    setAll(on) { this.enabled = on; }

    /** Cheap periodic sample of the background's average color, used to drive tone match + tints. */
    sampleEnvironmentTone(envCanvasLike, w, h) {
      this._envToneSampleCounter++;
      if (this._envToneSampleCounter % 30 !== 0 && this._envToneSampleCounter !== 1) return; // ~1x/sec at 30fps
      try {
        const sw = 32, sh = 32;
        const tmp = this._tmpCanvas || (this._tmpCanvas = scratchCanvas(sw, sh));
        const tctx = tmp.getContext('2d', { willReadFrequently: true });
        tctx.drawImage(envCanvasLike, 0, 0, sw, sh);
        const data = tctx.getImageData(0, 0, sw, sh).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
        r /= n; g /= n; b /= n;
        this._envTone = { r, g, b, lum: 0.2126 * r + 0.7152 * g + 0.0722 * b };
        this._envSmall = tmp;
        // which side of the scene is brighter (columns 0-9 vs 22-31 of the 32x32 sample)
        let lL = 0, lR = 0, nL = 0, nR = 0;
        for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
          const i = (y * sw + x) * 4, v = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          if (x < 10) { lL += v; nL++; } else if (x >= 22) { lR += v; nR++; }
        }
        lL /= nL; lR /= nR;
        this._side = Math.max(-1, Math.min(1, ((lL - lR) / (lL + lR + 1e-3)) * 4));
      } catch (e) { /* environment source not readable this frame — keep last known tone */ }
    }

    /** Filter string applied to the person layer to tone-match it to the environment. */
    personFilterString() {
      if (!this.enabled || !this.toneMatch) return 'none';
      const k = this.intensity;
      const { r, g, b, lum } = this._envTone;
      // Target ~ neutral 128 midtone environments shouldn't shift the person at all;
      // warm/cool or bright/dark environments should pull the person that direction.
      const brightness = 1 + ((lum - 128) / 255) * 0.35 * k;
      const warmth = ((r - b) / 255) * 18 * k; // degrees, fed into hue-rotate as a mild push
      const saturate = 1 + ((Math.max(r, g, b) - Math.min(r, g, b)) / 255) * 0.25 * k;
      const contrast = 1 + 0.06 * k;
      return `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)}) hue-rotate(${warmth.toFixed(1)}deg)`;
    }

    /** Draws a soft contact shadow under the subject, BEFORE the person layer is drawn. */
    drawShadow(ctx, maskBounds, w, h, personCanvas) {
      if (!this.enabled || !this.shadow || !maskBounds) return;
      const k = this.intensity;
      if (personCanvas && this.castShadow) this._drawCastSilhouette(ctx, personCanvas, w, h, k);
      const cx = (maskBounds.minX + maskBounds.maxX) / 2;
      const footY = maskBounds.maxY;
      const spread = (maskBounds.maxX - maskBounds.minX) * 0.55;
      ctx.save();
      const grad = ctx.createRadialGradient(cx, footY, 1, cx, footY, spread);
      grad.addColorStop(0, `rgba(0,0,0,${0.38 * k})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, footY, spread, spread * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /**
     * v0.82: soft silhouette shadow thrown AWAY from the scene's brighter side (plain-environment path; the premium-studio
     * path has its own in scene-engine.drawCastShadow). Quarter resolution, blurred at quarter size, then scaled up: cheap.
     * Even lighting -> weaker, so it never reads as a dark halo.
     */
    _drawCastSilhouette(ctx, personCanvas, w, h, k) {
      const qw = Math.max(32, w >> 2), qh = Math.max(18, h >> 2);
      const L = this._shLayer || (this._shLayer = scratchCanvas(qw, qh));
      if (L.width !== qw || L.height !== qh) { L.width = qw; L.height = qh; }
      const lc = L.getContext('2d');
      const side = this._side;
      const dx = side * 0.05 * qw, dy = 0.012 * qh;
      lc.globalCompositeOperation = 'source-over'; lc.globalAlpha = 1; lc.clearRect(0, 0, qw, qh);
      lc.filter = 'blur(' + (0.028 * qh * 4 / 4).toFixed(2) + 'px)';
      lc.drawImage(personCanvas, dx, dy, qw, qh);
      lc.filter = 'none';
      lc.globalCompositeOperation = 'source-in'; lc.fillStyle = '#000'; lc.fillRect(0, 0, qw, qh);
      lc.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.globalAlpha = Math.min(1, 0.30 * k * (0.35 + 0.65 * Math.abs(side)));
      ctx.drawImage(L, 0, 0, w, h);
      ctx.restore();
    }

    /**
     * Light wrap (v0.82 rewrite), drawn AFTER the person. Only a thin band just inside the silhouette is touched; its colour is the
     * scene's own colour at that spot (blurred), screened on. `rect` = where the person layer was drawn ({dx,dy,dw,dh}); omit for full frame.
     */
    drawLightWrap(ctx, personCanvas, w, h, rect) {
      if (!this.enabled || !this.lightWrap || this.lite || !this._envSmall) return;
      const k = this.intensity;
      const qw = Math.max(32, w >> 2), qh = Math.max(18, h >> 2);
      const L = this._wrapLayer || (this._wrapLayer = scratchCanvas(qw, qh));
      if (L.width !== qw || L.height !== qh) { L.width = qw; L.height = qh; }
      const lc = L.getContext('2d');
      const rx = rect ? rect.dx * qw / w : 0, ry = rect ? rect.dy * qh / h : 0;
      const rw = rect ? rect.dw * qw / w : qw, rh = rect ? rect.dh * qh / h : qh;
      lc.globalCompositeOperation = 'source-over'; lc.globalAlpha = 1; lc.filter = 'none'; lc.clearRect(0, 0, qw, qh);
      lc.drawImage(personCanvas, rx, ry, rw, rh);                                     // S
      lc.globalCompositeOperation = 'destination-out';
      lc.filter = 'blur(' + (0.05 * qh).toFixed(2) + 'px)';
      lc.drawImage(personCanvas, rx, ry, rw, rh);                                     // S * (1 - blur(S)) = thin inner band
      lc.filter = 'blur(2px)';
      lc.globalCompositeOperation = 'source-in';
      lc.drawImage(this._envSmall, 0, 0, qw, qh);                                     // band takes the scene's colour at that place
      lc.filter = 'none'; lc.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(1, 0.9 * k);
      ctx.drawImage(L, 0, 0, w, h);
      ctx.restore();
    }

    /** Final full-frame grain pass so the composite doesn't look artificially clean. */
    drawGrain(ctx, w, h) {
      if (!this.enabled || !this.grain) return;
      const k = this.intensity;
      ctx.save();
      ctx.globalAlpha = 0.05 * k;
      ctx.globalCompositeOperation = 'overlay';
      const pattern = ctx.createPattern(this._noiseCanvas, 'repeat');
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    _buildNoiseTile(size) {
      const c = scratchCanvas(size, size);
      const cx = c.getContext('2d');
      const img = cx.createImageData(size, size);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 128 + (Math.random() - 0.5) * 90;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      cx.putImageData(img, 0, 0);
      return c;
    }
  }

  globalThis.VS = globalThis.VS || {};
  globalThis.VS.RealismEngine = RealismEngine;
})();
