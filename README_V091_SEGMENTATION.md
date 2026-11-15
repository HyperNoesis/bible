# v0.91 segmentation update

This project is reconstructed from the three Genesis v0.90 source/model/runtime/MediaPipe archives and adds a focused correction to the shared browser mask-cleaning stage.

**What changed:** the cleanup now protects nearby, thin, elongated foreground wisps (including synthetic fine-hair structures) instead of classifying every small detached component as noise. The change is covered by `tools/e2e/unit_maskclean_hair.js`.

**What this does not prove:** it does not prove that the upstream RVM/MODNet model detects real hair, and it does not certify live camera quality on Android. The RVM worker still performs its internal inference at a 168-pixel long edge for speed. The BiRefNet/MatAnyone export weights are not present in the three supplied archives.

Start with these documents:

- `GENESIS_SEGMENTATION_ROOT_CAUSE_REPORT.md`
- `GENESIS_SEGMENTATION_IMPLEMENTATION_REPORT.md`
- `GENESIS_SEGMENTATION_TEST_REPORT.md`
- `GENESIS_V0_91_DEPLOYMENT.md`
- `CHANGELOG-v0_91-hair-wisp-preservation.md`

Build the deployable static site using `npm run www`; publish the contents of `www/`.
