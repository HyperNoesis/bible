# v0.73 — Design Constitution execution and Studio signature pass

## Added
- Shared semantic design tokens and a single active stylesheet.
- Atelier, Obsidian, Graphite and Daylight atmosphere presets.
- System, Dark and Light appearance modes; Violet, Cyan, Blue, Rose, Emerald and Amber accents.
- Beginner, Creator and Professional workspace density controls.
- Explicit Setup / Live / Edit Studio modes.
- Responsive tablet inspector drawer and mobile near-full-height inspector sheet.
- Mobile tool strip and production dock in separate non-overlapping rows.
- QA scripts for routes, responsive composition, CSS contrast, auto-start privacy, service-worker precache and Studio shell interactions.

## Changed
- Removed the old `body.landing` class that reactivated the legacy landing header layout.
- Merged the old compatibility CSS into the single active design stylesheet; archived original CSS sources in `css/legacy/`.
- Kept the preview stage dark in Light mode and corrected stage overlay text contrast.
- Camera/microphone auto-start is off by default and requires explicit opt-in plus already-granted camera and microphone permissions.
- Service worker cache bumped to `genesis-shell-v100`; precache now references current pages, active CSS, JS and built-in scene assets.
- Service-worker installation now fails visibly if shell precaching fails instead of silently installing an incomplete offline shell.

## Fixed
- Mobile tool rail previously stretched to full width per tab and overlapped the transport dock; it is now a horizontal scroll strip above the dock.
- Tablet Studio previously collapsed the preview into the rail column; it now retains a vertical rail, wide stage, right-side inspector drawer and reachable dock.
- Stale service-worker references to removed CSS files would have caused the shell precache to fail; all current precache references now resolve.

## Known blockers
- Original `tools/e2e/unit_*.js` and `t40`–`t47` camera/ONNX regression gates are missing from the supplied source bundle. See `tools/e2e/README.md`.
- Real camera, microphone, segmentation, recording, audio, streaming, export, cloud auth, physical Android, performance and full accessibility tests remain outstanding.
- Compatibility selectors remain in the active stylesheet until feature components can be migrated with the genuine engine regression suite.
