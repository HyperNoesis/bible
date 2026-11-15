# Genesis Studio — Segmentation Implementation Report

**Engineering snapshot:** v0.91 (based on supplied v0.90 packages)  
**Date:** 15 November 2026

## Changes implemented

### 1. Fine-wisp-aware mask cleanup

Updated `js/providers/mask-clean.js`.

- Changed foreground connected-component labelling from 4-connectivity to 8-connectivity so diagonal strands are not automatically fragmented into isolated one-pixel components.
- Added component shape measurements using second moments/covariance to recognise small, narrow, elongated structures.
- Added a proximity check against the largest foreground component. Small elongated components within a configurable 20-mask-pixel neighbourhood can be preserved as hair-like wisps.
- Kept ordinary small/square detached specks eligible for removal.
- Kept distant thin noise eligible for removal.
- Prevented small background pockets touching protected wisps from being filled into a solid patch.
- Optimised proximity calculation by seeding a bounded-distance flood from the boundary of the main component, rather than queueing every pixel inside the subject.
- Added diagnostic counters `wispsKept` and `holesPreserved` alongside the existing cleanup statistics.

The cleanup remains a pure in-place function on the model's 8-bit alpha array and remains shared by the MODNet and RVM workers.

### 2. Regression coverage

Added `tools/e2e/unit_maskclean_hair.js`.

It covers:

- 70 synthetic thin detached wisps near a subject.
- Retention of high-confidence strand pixels.
- Retention of soft anti-aliased fringe pixels.
- Removal of a nearby square speck.
- Removal of a distant thin noise line.
- Preservation of the existing small enclosed-hole fill behaviour.

### 3. Cache/build identity

- Bumped the service-worker shell cache from `genesis-shell-v119` to `genesis-shell-v120`, ensuring clients do not keep the old cached `mask-clean.js` after deployment.
- Updated the diagnostics build label to `genesis v0.91`.

## What was deliberately not changed

- No new segmentation model was added.
- RVM's internal 168-pixel downsample rule was not changed because this environment could not measure the quality/performance trade-off on the target phone.
- The existing live engine-selection ladder and recording safeguards were preserved.
- The separate export pipeline was not rewritten because its declared BiRefNet/MatAnyone model weights are not present in the supplied package set.
- No paid API, paid GPU, paid model, or compulsory cloud dependency was introduced.

## Before/after synthetic regression result

| Measurement | Original v0.90 | Patched v0.91 |
|---|---:|---:|
| High-confidence hair-like pixels retained | 0 / 935 | 935 / 935 |
| High-confidence pixel retention | 0% | 100% |
| Soft fringe pixels retained | Not separately tracked | 467 / 467 (100%) |
| Nearby square speck | Removed | Removed |
| Distant thin noise line | Removed | Removed |

These are deterministic synthetic cleaner tests, not model-quality measurements on real footage.

## Performance observation

A local Node timing run over 250 synthetic 448×256 hair-cleanup samples, after warm-up, measured approximately:

- Median: 2.90 ms
- 95th percentile: 5.12 ms
- 99th percentile: 5.89 ms
- Maximum: 6.82 ms

This is a desktop/container measurement, not a phone benchmark. The existing cleaner unit gate also passed its `<15 ms` 448×256 check in this environment.
