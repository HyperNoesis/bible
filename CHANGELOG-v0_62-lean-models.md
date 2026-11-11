# v0.62: lean models + real-photo gate
- models/modnet.onnx 26.0 -> 13.1 MB and models/rvm_mobilenetv3_fp32.onnx 15.0 -> 7.5 MB. Method: weights-only fp16 pack (tools/model-pack/pack_fp16.py): every large float32 weight is stored as float16 and cast back to float32 in the graph; arithmetic stays float32. Max relative weight error 0.049%.
- Verified: desktop onnxruntime max alpha change 0.004 (1/255) on real photos; real browser runtime (t45) overlap vs float32 reference 0.996-0.999 per photo; t41/t43/t44 pass; t42 Enhance passes (js/enhance-core.js size + sha256 updated to the packed MODNet file).
- Gate thresholds raised: modnetMinIou / rvmMinIou 0.90 -> 0.98 (measured 0.990-0.994 on the synthetic clip).
- New: tools/e2e/t45_real_photo_gate.js, get_real_photos.sh, make_real_refs.py (test photos are CC BY-NC-SA: testing only, never shipped).
- BIG_FILES.sha256 lists the shipped files; BIG_FILES_ORIGINAL.sha256 lists the untouched upstream models. restore-big-files.sh re-creates the packed models. sw cache v090.
- Kept on purpose: the WebGPU runtime (ort-wasm-simd-threaded.jsep.wasm, 25.9 MB raw / 6 MB zipped) because MODNet tries WebGPU first on phones that have it; MediaPipe hands/face mesh (optional features).
