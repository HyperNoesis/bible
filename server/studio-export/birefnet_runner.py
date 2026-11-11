"""BiRefNet (MIT) as a per-frame alpha predictor. Two backends, same output:
  * ONNX  (onnxruntime; CUDA if present, else CPU)  - weights/birefnet.onnx  (no torch needed)
  * torch (.pth, BiRefNet repo)                      - weights/BiRefNet-matting.pth or BiRefNet-portrait.pth
Output: float32 (H, W) in 0..1, same size as the input frame."""
import os
import numpy as np

MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-np.clip(x, -30, 30)))


class BiRefNetRunner:
    def __init__(self, here, onnx_path=None, pth_name="BiRefNet-matting.pth", size=1024, device=None):
        self.size = size
        self.onnx = None
        self.net = None
        # v0.83: the bundled weights/birefnet.onnx is the GENERAL model. The MATTING .pth gives softer, truer edges,
        # so torch + the matting weights is the default; ONNX is used only when asked for (--birefnet-onnx) or when torch is missing.
        if onnx_path is None:
            try:
                import torch  # noqa: F401
            except ImportError:
                onnx_path = os.path.join(here, "weights", "birefnet.onnx")
        if onnx_path and os.path.exists(onnx_path):
            import onnxruntime as ort
            prov = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
            self.onnx = ort.InferenceSession(onnx_path, providers=prov)
            self.in_name = self.onnx.get_inputs()[0].name
            self.backend = "onnx:" + prov[0]
        else:
            import sys, torch
            sys.path.insert(0, os.path.join(here, "vendor", "BiRefNet"))
            from models.birefnet import BiRefNet  # noqa
            from utils import check_state_dict  # noqa
            self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
            net = BiRefNet(bb_pretrained=False)
            sd = torch.load(os.path.join(here, "weights", pth_name), map_location="cpu")
            net.load_state_dict(check_state_dict(sd))
            self.net = net.to(self.device).eval()
            if self.device == "cuda":
                self.net = self.net.half()
            self.backend = "torch:" + self.device

    def alpha(self, rgb_u8):
        import cv2
        h, w = rgb_u8.shape[:2]
        x = cv2.resize(rgb_u8, (self.size, self.size), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
        x = ((x - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
        if self.onnx is not None:
            y = self.onnx.run(None, {self.in_name: x})[0][0, 0]
            if y.min() < -0.01 or y.max() > 1.01:        # logits -> probability
                y = _sigmoid(y)
        else:
            import torch
            t = torch.from_numpy(x).to(self.device)
            if self.device == "cuda":
                t = t.half()
            with torch.inference_mode():
                y = self.net(t)[-1].sigmoid().float().cpu().numpy()[0, 0]
        return cv2.resize(y.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)
