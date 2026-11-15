# v0.91 — Preserve fine detached matte wisps (15 Nov 2026)

## Verified changes

- `js/providers/mask-clean.js`: foreground components now use 8-connectivity; nearby thin elongated components can survive the small-speck filter as hair-like wisps.
- The cleaner still removes a nearby square speck and a distant thin noise line in deterministic regression coverage.
- Small background pockets touching protected wisps are not filled into solid blobs.
- Added `tools/e2e/unit_maskclean_hair.js` to protect high-confidence strand pixels and soft fringe from regression.
- Service worker shell cache incremented to v120.
- Diagnostics build label incremented to v0.91.
- All 43 JavaScript unit suites passed; the Python export logic/API suites passed; `npm run www` passed.

## Synthetic comparison

The deterministic 448×256 mask-cleaner fixture retained 0/935 marked hair-like pixels with the original v0.90 cleaner and 935/935 with the v0.91 cleaner. This is a synthetic unit-test result, not a real-camera quality claim.

## Known limitations

- RVM internally downsamples to a 168-pixel long edge. That quality/performance trade-off remains unchanged until it can be measured on the target device.
- The supplied v0.90 package set does not contain the BiRefNet/MatAnyone export weights mentioned in older documentation. Only the weights checksum manifest is present.
- The real-model inference path, WebGL matte gate, real human footage, and physical Android behaviour remain unverified in this environment.
