# v0.84 — export teacher: hand-crop refinement + SAM 2.1 tracker gate (apply on top of v0.83)
Copy the files over the project, same paths. Export server only; the browser app is untouched.

## What changed (server/studio-export/)
1. hands_refine.py (new): MediaPipe Hands (Apache-2.0) finds each hand; BiRefNet re-runs on a square crop around it (about 5x more pixels on the
   fingers than the full-frame 1024 px pass); the crop alpha is merged back, gated to pixels near the full-frame person, feathered, tracked over time
   (boxes smoothed, held 6 frames when the detector drops a hand). Any error on a frame falls back to the full-frame alpha.
2. tracker_gate.py (new): SAM 2.1 Tiny (Apache-2.0) tracks the person; BiRefNet alpha outside the (dilated) tracked mask is removed. It only
   subtracts, and it switches itself off for a frame when the two disagree (tracker lost the subject). Single-subject clips only.
3. studio_export.py: pipeline is now BiRefNet -> hands -> tracker gate -> temporal fusion. New flags:
   --hands auto|on|off (default auto: on when mediapipe is installed), --hands-mode union|replace, --hands-pad, --hands-max,
   --tracker off|auto|on (default OFF), --sam2-checkpoint. The final JSON line now also carries "hands" and "tracker" stats.
4. fetch_models.sh: WITH_SAM2=1 downloads sam2.1_hiera_tiny.pt. requirements.txt: mediapipe and sam2 listed as optional.
5. test_hands_tracker.py (new): 40 checks on synthetic masks.

## Try it
  pip install mediapipe
  python studio_export.py -i clip.webm -o a.mp4 --background scene.jpg --hands off        # before
  python studio_export.py -i clip.webm -o b.mp4 --background scene.jpg --hands on         # after
  python studio_export.py -i clip.webm -o c.mp4 --background scene.jpg --hands on --hands-mode replace
  WITH_SAM2=1 ./fetch_models.sh && python studio_export.py ... --tracker on
Look at fingers (a hand held up against a plain wall) in a.mp4 vs b.mp4. Compare the "flicker" numbers on the last line.

## Verified (sandbox, no GPU)
test_hands_tracker.py 40/40, test_pipeline_logic.py and test_scene_logic.py still pass, studio_export.py parses, fetch_models.sh passes sh -n.
## NOT verified
Any real run: MediaPipe on real frames, BiRefNet on a real crop, the Sam2Tracker class (written against the public SAM 2 video-predictor API,
never executed; expect to adjust names if that API moved), whether fingers actually look better, and speed (each hand adds one BiRefNet pass
per frame: up to 3x the matting time with two hands). Defaults (pad 1.8, gate 0.25, union) are reasoned, not tuned. Tune on your clips.
