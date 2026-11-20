# v0.93 — decoupled pipeline (fixes ~8 fps on phones)
- Segmentation now runs asynchronously (max ~6 masks/s); every camera frame is drawn immediately with the latest mask. Toggle: localStorage vs_async_seg=0.
- Model speed budget is 3x while async, and the old "too slow" bench verdicts are invalidated (bench v4), so RVM/MODNet (WebGPU first) can be selected live.
- WASM threads on mobile: up to 3 (min 2) when cross-origin isolated.
- Recorder samples when a new frame is rendered (heartbeat if stalled) instead of a 30 fps clock with resyncs.
- Dark-scene banner when the camera is held near 10 fps with low-light boost active.
