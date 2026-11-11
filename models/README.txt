MODEL FILES (shipped in this folder, do not rename):

  modnet.onnx                   MODNet webcam portrait matting (Apache-2.0). 13.1 MB.
  rvm_mobilenetv3_fp32.onnx     Robust Video Matting MobileNetV3 (GPL-3.0, see LICENSES.md). 7.5 MB.

Both files are the upstream float32 models with their WEIGHTS stored as float16 (the maths still runs in float32; each weight is rounded once, max relative
error 0.05%). Measured on real photos: masks are identical to the originals (overlap >= 0.996 in the real browser runtime, largest alpha change 0.004).
The file names are kept so nothing in the app changes. How it was made and checked: tools/model-pack/pack_fp16.py, tools/e2e/t45_real_photo_gate.js.
The unmodified originals are listed in BIG_FILES_ORIGINAL.sha256 (MODNet: github.com/yakhyo/modnet releases "weights"; RVM: github.com/PeterL1n/RobustVideoMatting v1.0.0).
Keep the Apache-2.0 / GPL-3.0 licence and attribution notes from LICENSES.md with the app.
