# v0.90: harder edge tests + a remote switch (15 Nov 2026)
Apply on top of v0.89 (merged). SW cache v119. Every claim is tagged VERIFIED (run here) or UNVERIFIED.

## 1. Gate F now has six scenes, not three (tools/e2e/t49_matte_edge_gate.js, matte_edge_gates.json)
New synthetic scenes, same method (known ground truth, fixed 8 px edge band, software GL, deterministic). The three old scenes measure exactly as before (VERIFIED).
| scene | what it stands for | alphaMAE @256 | alphaMAE @160 |
|---|---|---|---|
| dark | dim room, heavy sensor noise, low colour contrast | 0.27 | 0.41 |
| hair | 70 fine strands (1.2-2.6 px) leaving the head | 0.065 | 0.067 |
| motion | model mask 14 px behind the picture | 0.24 | 0.17 |
These are BASELINES held at about 1.4x the measured value (regression guards), not quality targets. They show where the product is weak: low-contrast edges (dark, lowc), lagging masks, and lost hair strands. The shader cannot fix a mask that is wrong by more than the colour edge can recover; the fix is a better mask model (see docs/MODEL_DECISION_v0_82.md: BiRefNet for export, a small student model for the live tier).
SYNTHETIC ONLY. It does not replace looking at a real person on a real phone (UNVERIFIED).

## 2. Remote switch (js/flags.js, flags.json)
`flags.json` at the site root can turn the v0.89 colour-line edge correction down or off for everyone (`{"colourSnap": 0}`) with one small push and no user action. Rules: only known keys, values clamped, a missing/slow/broken file changes nothing, nothing is sent anywhere. A device's own `localStorage vs_snap=0` still wins. unit_flags (10 checks) PASS; in a real browser: file -> 0.8, file says 0 -> 0, file returns HTTP 500 -> 0.8, no page errors (VERIFIED).
To use it: edit flags.json, push to main. The Pages deploy takes about a minute; devices pick it up on next open (service worker is network-first for this file).

## 3. Not built tonight, on purpose
- Real-user telemetry: needs your decision on consent wording, where the numbers go, and the privacy page (NDPA). Nothing that collects user data was added.
- A new live segmentation model: needs a GPU, real consented footage and a hand-made ground truth. None exist in the sandbox (Hugging Face is blocked).
- Studio UI restructure: the studio screen on a 390 px phone looked calm in a fake-camera run (VERIFIED by screenshot); no layout change made. One thing worth deciding: a 16:9 scene sits in a tall frame with large black bars.
