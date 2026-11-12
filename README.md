# models branch
The four heavy Studio Export model files, split into 90 MB parts because GitHub refuses files over 100 MB.
- weights/BiRefNet-matting.pth, BiRefNet-portrait.pth, birefnet.onnx (BiRefNet, MIT) and matanyone2.pth (MatAnyone 2, NON-COMMERCIAL, reference only).
- `sh restore.sh` joins the parts into ./weights-restored/ and verifies SHA256SUMS. server/studio-export/fetch_models.sh on main uses this branch automatically if the original download links fail.
- Originals: github.com/ZhengPeng7/BiRefNet releases v1 and github.com/pq-yang/MatAnyone2 releases v1.0.0. Do not merge this branch into main.
