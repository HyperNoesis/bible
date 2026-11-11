# v0.59 Pleasant UX pass (visual + guidance layer only, cache v086)

Changed: js/studio-ux.js (NEW, loaded after app.js in studio.html), css/premium.css (palette rebalance + v0.59 section), js/app.js (3 one-line CustomEvent dispatches + a duration variable, no behaviour change), environments.html (scene preview dialog), projects.html (undo delete), design.html (NEW reference page), sw.js (cache v086 + 2 files), theme-color meta now #0c0b0e.
Not touched: camera, segmentation, rendering, recording logic, auth, storage schema, URLs, DOM ids.

## What you get
- Colour: softer, warmer. Ember is now coral-peach to rose (was hot coral to pink), indigo/lagoon/orchid slightly muted, surfaces warm charcoal (less violet), warm-tinted shadows. Roles unchanged.
- Studio tabs grouped: Set (Scene, Looks, Framing, Realism, Mask) / Perform (Camera, Audio, Prompter, Captions) / On screen (Show, Graphics, Content, Presets) / Output (Quality, Recordings, Go Live) / Advanced. Same buttons, ids and listeners.
- First-run guide (Pick a scene > Start camera > Record). Steps tick from real state (scene picked, transportStatus, recording). Hidden for good after the first saved take, or with its Hide button.
- Ready check chips over the preview: Light (LightMeter), Mic (audio chain peak), Camera (decoded frames per second) plus ONE plain sentence. A chip shows "Measuring" or "--" until a real value exists. Framing is NOT shown: the app has no continuous face-position readout to report honestly.
- Post-recording card: thumbnail, length, size, Download / Trim (opens Recordings and starts Trim) / Open in Projects.
- Scene preview in Environments: large image, Use in Studio, arrow keys, Esc, focus trap, focus returns to the card.
- Undo delete in Projects: row leaves at once, file removed after 7 s, Undo restores. Closing the page first keeps the recording (safe failure). The old confirm() is gone.
- Details: tab title and theme colour change while recording, tabular numbers, touch press feedback, scroll-snap + edge fade on tab strips, reduced-motion respected.
- design.html: live reference of colour roles, buttons, chips, steps, cards, toast.

## VERIFIED (headless Chromium, fake camera, local http server, 390x800 and 1360x860)
All of: landing, home, environments, projects, settings, editor, audio, call, design load with 0 page errors, 0 failed requests, no horizontal overflow. Studio: rail grouped (17 tabs kept), tab switching works, camera start, ready chips fill from real readings, record 3 s + stop, "Recording" title, done card with thumbnail, Trim button opens Recordings. Environments: dialog opens, ArrowRight changes scene, Esc closes and returns focus. Projects: delete shows Undo toast, Undo restores the row.
## INFERRED
Mic chip thresholds (peak dBFS -3 / -30 / -45) are reasoned, not tuned on a phone. Rotating/landscape layouts. Low-light advice wording.
## UNVERIFIED
Real phone (Redmi/Chrome), real room light and real voice levels, installed-PWA status bar colour, TalkBack, contrast of text over photos, tests.html (needs vendor files not in the lite zip), service-worker upgrade path from v085.
## Not built (on purpose)
Light theme, swipe between tabs, long-press scene preview, Add-to-Home-Screen nudge, per-failure retry panels beyond the existing camera "Try again". Each is a real feature and should be its own verified step.
