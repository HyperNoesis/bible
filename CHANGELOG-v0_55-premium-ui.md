# v0.55 Premium UI/UX pass (visual layer only)

Changed: css/premium.css (NEW, loaded after style.css on every page), js/nav.js (grouped sidebar, mobile tabbar + More sheet), js/icons.js (+plus, arrowRight, more, script, live, overlay, shapes), js/app.js (only the TAB_ICONS map gained 7 entries), home.html (new stage hero, 3-step path, scene mosaic), environments.html (search, keyboard-focusable cards, designed empty state), studio.html (shorter rail labels only), auth.html (serif emphasis), sw.js (cache v082 + premium.css), all pages link premium.css.
Not touched: camera, segmentation, rendering, recording, auth logic, storage, URLs, DOM ids.

VERIFIED (ran in headless Chromium 1360x860 and 390x800, local http server, local sign-up flow): auth, home, environments, studio, projects, settings, editor, audio, call all load with zero page errors; no horizontal overflow on mobile studio; Studio tab switching works; More sheet opens/closes (Esc).
INFERRED: styling of recording/live states (.record-control.recording, .live-status) from CSS only; reduced-motion handling.
UNVERIFIED: real phone (Redmi/Chrome), live camera preview with the new frame/corner marks, an actual recording with the new dock, tests.html (needs vendor/mediapipe + network, not in the lite zip; it crashed on loading that file here, unrelated to the UI), editor/audio/call visual polish beyond the shared tokens.
Fonts: Space Grotesk still loads from Google Fonts with system fallback (as before); the serif accent uses local system serifs, no new assets or licences.

## v0.56 pass 2
Editor/Audio: eyebrow + serif headlines + illustrated empty states (js/editor.js, js/audio-studio.js). Call: green-room join card. Landing: always-dark full-bleed scene hero (landing.html links premium.css). Skeleton loaders, disabled/"Unavailable" selector state, toast close fix, HUD no longer overlaps the flip-camera button. sw cache v083.
VERIFIED (headless Chromium, fake camera): Studio live preview + recording state (REC timer, Recording dock) render with no page errors; Editor, Audio, Call, Landing screenshots reviewed. Emoji audit: none in UI.
UNVERIFIED: real phone, locked-state visuals (no locked states exist in the app), cam.html/remote.html not restyled, tests.html.

## v0.57 pass 3 (cache v084)
Fixed: Record bar now pinned on phones (fixed dock, nowrap, survives the Recording state); removed duplicate/clipped "UNAVAILABLE" tag on Quality selector; Audio "\u2013" literal text bug; page headers wrap on phones; touch targets >=44px (chips, rail, selectors); removed most backdrop blur (kept on overlays only), slower/smaller hero zoom, hero cycling pauses when tab hidden; Environments alert() replaced by an accessible toast; Home tag reworded "Ready when you are" (no readiness claim).
VERIFIED (headless Chromium, 390x800 + 1360x860, fake camera): all 17 Studio panels viewed on mobile; recording state on mobile; before/after in docs/ui-compare/.
STILL UNVERIFIED: real phone, tests.html, contrast audit by tool, cam.html/remote.html unstyled, Studio scene grid has no skeleton loader.

## v0.58 final polish (cache v085)
Self-hosted Space Grotesk variable font (no Google request; OFL in LICENSES.md); removed @import from style.css. Contrast: --text-faint 3.5:1 -> >=5:1, skip-link fixed; scripted contrast audit over home/environments/projects/settings/editor/audio/call/cam/remote/studio/landing found 0 failures (text on flat backgrounds only; text over photos not measured). Landing: icon set on feature cards, 3-step section, honest-limits callouts, 3-col grids, [hidden] respected. cam.html/remote.html restyled. Spacing tokens --s-1..--s-8. Studio scene-grid skeleton. No failed network requests in checked pages.
STILL UNVERIFIED: real phone; tests.html; contrast of text over photos.
