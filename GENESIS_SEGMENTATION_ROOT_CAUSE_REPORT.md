# Genesis Studio — Segmentation Root-Cause Report

**Engineering snapshot:** v0.92 (based on supplied v0.90 packages, hardened in v0.91–v0.92)  
**Date:** 15 November 2026  
**Scope:** Source-level diagnosis of the browser live-mask cleanup path and inspection of the separate recorded-video export path.

## Executive finding

A confirmed defect exists in the common post-processing function `VS.MaskClean.clean()` (`js/providers/mask-clean.js`). It treated every small disconnected foreground component as debris. Its four-connected component labelling also split diagonal one-pixel structures into many separate fragments. Both the MODNet worker and RVM worker call this cleaner immediately after converting the model output to an 8-bit alpha mask.

This means the cleanup stage could erase fine, thin hair-like structures even when the model had emitted them. It was not necessary for the model itself to be wrong for this loss to occur.

## Evidence for the confirmed defect

A deterministic 448×256 synthetic regression scene was constructed with an elliptical subject and 70 thin, diagonal, detached foreground wisps. The exact same scene was passed to the v0.90 cleaner extracted from the original source archive and to the patched cleaner.

| Cleaner | High-confidence wisp pixels before | Pixels retained | Retention |
|---|---:|---:|---:|
| Original v0.90 cleaner | 935 | 0 | 0% |
| Patched v0.91 cleaner | 935 | 935 | 100% |

The original cleaner split the synthetic structures into 373 connected pieces and removed all 935 marked pixels. The patched version identified 47 nearby elongated components as wisps; connected strands merged into larger components under 8-connectivity. It retained the high-confidence strands and soft fringe in this synthetic test.

This is a source-level regression test, not a real-person footage result. It isolates the cleanup function and does not establish how many strands RVM or MODNet can detect from a real camera frame.

## Why the defect occurred

The previous cleaner:

1. Labelled foreground components using four-neighbour connectivity.
2. Calculated a small-component cutoff using the larger of an absolute speck floor and 2% of the largest component area.
3. Removed components below that cutoff.

Thin diagonal strands are particularly vulnerable to four-connectivity: diagonally touching pixels are not considered connected. Once split into small pieces, they fall below the small-component threshold and are cleared.

## Scope of impact

The cleaner is imported and called by:

- `js/providers/modnet-worker.js`
- `js/providers/rvm-worker.js`

The defect therefore affects both worker-based live matting paths when their model output contains disconnected fine structures. It does not prove that every MediaPipe or export path uses the same cleaner.

## Additional quality constraint discovered — RVM inference scale

The RVM worker uses `downsampleFor(w, h) = min(1, 168 / max(w, h))`. For a 448×256 frame supplied to the worker, the RVM network's internal analysis scale is approximately 168×96 before its output is returned at the larger matte size.

This is an intentional performance trade-off in the supplied code. It is a plausible source of lost very-fine detail, but it has **not** been demonstrated as the cause of a particular real-camera defect in this environment. It has not been changed because a higher internal scale needs a measured speed/quality comparison on the target phone. Raising it without measurement could make live capture too slow.

## Export-path finding

The supplied three archives do not contain the BiRefNet or MatAnyone model weights described in some older export documentation. `server/studio-export/weights/` contains only `SHA256SUMS`; the expected weight files and associated vendor implementation are absent from this package set. The source package's `UNZIP_ME.txt` explicitly says GPU-server weights from the separate `models` branch are not included.

The export logic tests can run with their stand-in matte path, but the real BiRefNet/MatAnyone export models cannot be validated from these three archives alone. No large model download was initiated; this work remains zero-spend.

## Not established

- No real human camera recording was available in the archives for ground-truth quality comparison.
- RVM and MODNet ONNX inference has since been executed in Node/WASM on the bundled synthetic 12-frame fixture (see `GENESIS_SEGMENTATION_V0_92_REPORT.md`). Browser camera integration and real-person quality remain unverified.
- The existing `t49_matte_edge_gate.js` is a synthetic GL matte/shader test, not a real model-inference quality test. It could not be executed here because the Node Playwright dependency was unavailable and the available headless browser did not expose WebGL2.
- No physical Android device test was performed.

## Conclusion

The shared mask-cleanup bug is confirmed and has been corrected with a focused regression test. Fine-hair quality still depends on what the upstream model produces, the RVM internal downsample scale, camera conditions, and device performance. Those require a real camera/device validation pass before any production-quality claim.
