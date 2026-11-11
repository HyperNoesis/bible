# v0.60 (30 Oct 2026): CI gates + Enhance export. See docs/PROMPT1_REPORT.md and docs/PROMPT2_REPORT.md.
- MODNet background upgrade default ON (bench-gated); ladder step-back-up (256 -> 320, capped).
- CI: tests.yml (units + gates A/B/C); APK/Release depends on it.
- Enhance quality: raw-footage toggle, offline re-matting at 512 px, WebCodecs WebM export with audio, resume/cancel, model store.
- sw cache v088. Not verified on a phone.
