# v0.75 — UX pass
Auth: password eye inside field, clean Sign in/Sign up toggle, sign-up form spacing, one calm note.
Studio: removed repeated "Camera off"/Start camera, cleaner header, back arrow, Sign up / account button (new `user` icon), tool rail fade, no clipped tablet labels, phone header without unlabeled dots.
Balance: dock aligned to the stage (desktop); phone sheet equal gutters; inspector content no longer overflows; colour-grade buttons wrap correctly.
Home: single greeting heading, slim privacy note with "Got it", scrolling room chips on phone.
Service worker cache: genesis-shell-v103.
Files changed: css/genesis-system.css, auth.html, home.html, js/first-run.js, js/icons.js, js/studio-shell.js, sw.js.

# v0.76 additions
- Studio tool rail shows 6 core tools (Scene, Looks, Camera, Audio, Graphics, Go Live); the rest sit under "More" (remembered; auto-opens if a hidden tool is selected).
- The empty stage shows the selected scene behind Start Camera (updates when you pick another scene).
- Removed user-visible "not built yet / coming soon / planned" text (audio note, Looks note, virtual-camera line, ULTRA quality option).
- Select text no longer overflows on phones. Service worker cache: genesis-shell-v104.

# v0.77 additions
- Sign-up return trip: "Sign up" in Studio (and "Create an account" in the account menu) opens auth.html?next=<page>; after sign in/up you return there. Only allow-listed internal pages are accepted; anything else falls back to Home.
- CSS consolidation: removed 858 declarations and 107 rules that a later rule with the same selector and context always overrides (285 KB -> 259 KB). Verified by pixel-diffing 210 screenshots (17 pages + 17 Studio panels, 3 viewports, light and dark) before vs after: no visual differences.
- Service worker cache: genesis-shell-v105.

# v0.78 — QA pass (automated audit of 18 pages x 3 sizes + simulated-camera run: start, switch scene, record, stop, permission denied)
Fixed:
- Studio panels (Show, Graphics): button rows ran past the panel edge; they now wrap.
- On-stage status chips (Light / Mic / Camera) were a white box with grey text; now light text on dark glass.
- Live mode left an empty 340 px column on the right; the stage now uses the full width.
- Warning toast text was dark amber on a dark strip (unreadable) and its copy said "phone" on desktop; now readable and says "device".
- Step guide no longer sits on top of the warning toast.
- Phone Studio header ran off the screen and showed unlabeled dots; cleaned up.
- "Browse environments" link is now a 44 px tap target; Studio has a proper page heading (h1).
- Copy typo "and and" in the Looks panel.
Service worker cache: genesis-shell-v106.
