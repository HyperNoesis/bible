# v0.74 — merged build (Claude fixes on top of GPT v0.73)
Base: GPT v0.73 (single stylesheet css/genesis-system.css, Appearance system, segmentation presets, Settings/Environments/Editor/Audio/Call/Remote/Camera restyles, camera auto-start off by default).
Kept from GPT: all of the above, plus its landing page.
Replaced / fixed by Claude:
- Home rebuilt: calm "Ready to record?" panel, framed scene preview (no text over photos), room picker chips, quick links, "Continue where you left off" with real frame thumbnails, honest empty/error states.
- Floating appearance button removed (it covered content on phones). Appearance now opens from the account menu and Settings, and as a quiet icon in Studio's header.
- Settings: new Appearance section.
- Logo mark sits on a dark disc so it is visible in light theme.
- First-run welcome card works again (its id clashed with a hidden GPT rule).
- Studio: duplicate mode chip removed, mode tabs and Home link meet 40-44px targets, new Diagnostics block under Background removal (real measured frame rate, frame time p50/p95, engine, output size; "--" until measured), plain-language status pill on the stage, technical names only in Diagnostics.
- Projects, auth, guest mode, sign-in/up/reset kept and re-verified.
- Service worker cache bumped.
