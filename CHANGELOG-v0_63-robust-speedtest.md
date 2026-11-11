# v0.63 (from your phone report: RVM measured 810 ms, MODNet 2867 ms, "chose light model")
- The speed test was measuring a fight for the CPU (camera + light model + renderer all running). Sandbox repro: same RVM measured 178 ms inside the live app and 72 ms with the loop paused.
  Now: the live picture holds its last frame for a few seconds while the model is timed; 3 warm-up frames; lower-quartile timing; if too slow it re-tests with 1 thread, then once more after a pause.
- Phones use at most 2 CPU threads (the other cores are slow ones that starve the page) and ORT no longer busy-waits (allow_spinning off).
- MODNet no longer tries WebGPU on phones (it was the likely cause of 2867 ms on the Mali-G52). Override: vs_webgpu = 1.
- Limit per mask raised 70 -> 100 ms (vs_max_ms overrides). A "too slow" verdict now expires after 6 hours and the app looks again once after 45 s.
- If the runtime fps ladder drops you to the light model, it looks again after 90 s (max 2 times per camera session) instead of staying down.
- New tests: unit_bench.js, t46_upgrade_flow_gate.js (simulated hitch). Everything else still passes.

