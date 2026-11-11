# v0.64 (from your first phone video)
- Forehead cut: the person layer is the whole camera frame, so a head touching the top of the frame showed a hard straight cut. It now fades softly there (only when the head touches the frame top; otherwise untouched). Still best: sit a little further back.
- Mask debris: detached specks and small holes in the model's raw mask are cleaned before the edge is snapped to the camera frame (js/providers/mask-clean.js). Real-photo and synthetic overlap unchanged (0.988-0.992).
- New tests: unit_maskclean.js, t47_headroom_fade_gate.js; unit_scene.js extended.
- NOT changed: shoulder streaks / stair-steps cannot be proven fixed from here (needs your raw camera clip); the fps pipeline is still frame-synchronous.

