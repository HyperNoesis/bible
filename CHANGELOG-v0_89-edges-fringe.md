# v0.89 - cutout edge colour: green fringe fix + colour-line edge correction
Apply on top of v0.88. SW cache v115. Files: js/providers/gl-matte.js (shader), js/render-core.js + js/app.js (one new setting), tests.

## What changed
1. Edge colour (the pale-green fringe). Two causes in the old shader: the background colour it unmixed came from mask-cell averages that already contain person colour, and the
   correction was driven by the TIGHTENED alpha, which is 1.0 on a rim pixel that is really ~70% person, so the rim kept its background tint. Edge pixels now take their colour from
   confident interior person pixels found 1-3 mask cells inward (and, when it agrees with them, an unmix against the measured exterior colour). Driven by the raw alpha.
2. Colour-line edge correction (new, `colourSnap`, default 0.8). Near the mask edge the pixel colour is projected on the line between the local interior colour and the local
   exterior colour, which pulls alpha to 0 on wall-coloured pixels the model included (halo) and to 1 on person-coloured pixels it clipped. Skipped when person and wall colours are
   too alike, when the pixel is off the line (stripes, hair, highlights), and when no interior/exterior sample is found (thin parts: fingers, hair). Kill switch: localStorage `vs_snap=0`.
3. The alpha upsample (bilateral weights, smoothstep tightening) is UNCHANGED on purpose: on the synthetic test the old weights were already the best of four variants tried
   (a compact kernel and a colour-weight floor were both worse), and the blocky-staircase theory could not be reproduced on synthetic data.

## Measured (tools/e2e/t49_matte_edge_gate.js, synthetic person with ground truth, software GL; lower is better)
| scenario (mask) | alphaMAE old -> new | colour bleed old -> new | composite error old -> new |
|---|---|---|---|
| clean, accurate mask (256) | 0.009 -> 0.013 | 1.7 -> 3.9 | 1.4 -> 3.0 |
| hard: noisy + over-wide mask (256) | 0.256 -> 0.015 | 17.7 -> 5.3 | 24.8 -> 3.7 |
| hard (160) | 0.390 -> 0.042 | 21.7 -> 5.8 | 36.7 -> 6.5 |
| person colour ~ wall colour (256) | 0.276 -> 0.276 | 5.9 -> 4.9 | 25.5 -> 24.6 |
Honest reading: much better when the mask is off or the video is noisy; slightly WORSE on a clean, accurate mask (the old unmix was nearly exact there). No change when colours are alike.

## Verified here
unit_*.js all pass; Gate A (t40, real pipeline, fake camera) 8/8; Gate C (t42, Enhance export) all pass; new Gate F (t49) passes (added to tests.yml).
## NOT verified
Any real person, any real phone, the real MediaPipe/MODNet/RVM masks (all of this is a synthetic person). Speed on a Mali-G52 phone: the extra edge taps run only on edge pixels
(a few percent of the frame) but are UNMEASURED there. If the cutout looks worse or slower, set localStorage `vs_snap=0` first, then report back with Diagnostics.
