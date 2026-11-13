"""Genesis live matting student (v0.85): a recurrent matting network written from scratch for this project.

Not RVM code (RVM is GPL-3.0). The ideas are common knowledge (a mobile CNN encoder, a context block, a decoder with ConvGRU memory at
several scales, a full-resolution refinement head); the code, the layout and the weights are ours. Encoder: torchvision MobileNetV3 (BSD-3 code,
ImageNet-pretrained weights are optional, see README for the licence note).

Interface (same shape of contract as RVM so the browser provider changes little):
  inputs : src [B,3,H,W] float 0..1 RGB (H, W multiples of 32), r1i..r4i recurrent states (zeros [1,1,1,1] on the first frame)
  outputs: pha [B,1,H,W] 0..1, r1o..r4o new states
State channels per stage are model.state_channels (decoder width / 2). Resolution may change between frames only if you reset the states.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision

MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)


def _cbr(i, o, k=3, s=1):
    return nn.Sequential(nn.Conv2d(i, o, k, s, k // 2, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True))


class ConvGRU(nn.Module):
    """GRU over half the channels (the other half passes through): memory at about half the cost of a full ConvGRU.
    x [B,C,H,W] (C even), h [*,C/2,*,*] or a [1,1,1,1] zero (broadcast on the first frame)."""

    def __init__(self, ch, k=3):
        super().__init__()
        assert ch % 2 == 0
        self.half = ch // 2
        self.gates = nn.Conv2d(self.half * 2, self.half * 2, k, 1, k // 2)
        self.cand = nn.Conv2d(self.half * 2, self.half, k, 1, k // 2)

    def forward(self, x, h):
        a, b = x[:, : self.half], x[:, self.half:]
        h = h.expand(x.shape[0], self.half, x.shape[2], x.shape[3])
        r, z = torch.sigmoid(self.gates(torch.cat([b, h], 1))).split(self.half, 1)
        c = torch.tanh(self.cand(torch.cat([b, r * h], 1)))
        h = (1 - z) * h + z * c
        return torch.cat([a, h], 1), h


BACKBONES = {
    # name: (builder, slices [s2, s4, s8, s16, s32], channels)
    "large": (torchvision.models.mobilenet_v3_large, [(0, 2), (2, 4), (4, 7), (7, 13), (13, 17)], [16, 24, 40, 112, 960]),
    "small": (torchvision.models.mobilenet_v3_small, [(0, 1), (1, 2), (2, 4), (4, 9), (9, 13)], [16, 16, 24, 48, 576]),
}


class Encoder(nn.Module):
    def __init__(self, backbone="large", pretrained=False):
        super().__init__()
        build, sl, self.channels = BACKBONES[backbone]
        f = build(weights="IMAGENET1K_V1" if pretrained else None).features
        self.stages = nn.ModuleList([f[a:b] for a, b in sl])
        self.register_buffer("mean", torch.tensor(MEAN).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor(STD).view(1, 3, 1, 1))

    def forward(self, src):
        x = (src - self.mean) / self.std
        out = []
        for s in self.stages:
            x = s(x)
            out.append(x)
        return out   # strides 2, 4, 8, 16, 32


class Context(nn.Module):
    """LR-ASPP style: a 1x1 projection of the stride-32 features gated by global context."""

    def __init__(self, i, o):
        super().__init__()
        self.a = _cbr(i, o, 1)
        self.g = nn.Sequential(nn.AdaptiveAvgPool2d(1), nn.Conv2d(i, o, 1), nn.Sigmoid())

    def forward(self, x):
        return self.a(x) * self.g(x)


class Up(nn.Module):
    def __init__(self, i, skip, o):
        super().__init__()
        self.conv = nn.Sequential(_cbr(i + skip, o), _cbr(o, o))
        self.gru = ConvGRU(o)

    def forward(self, x, skip, h):
        x = F.interpolate(x, size=skip.shape[2:], mode="bilinear", align_corners=False)
        x = self.conv(torch.cat([x, skip], 1))
        return self.gru(x, h)


class StudentMatting(nn.Module):
    def __init__(self, backbone="large", width=1.0, pretrained=False):
        super().__init__()
        self.enc = Encoder(backbone, pretrained)
        c = self.enc.channels
        d = [max(8, int(round(v * width / 2)) * 2) for v in (96, 48, 32, 16)]
        self.dec_channels = d
        self.state_channels = [v // 2 for v in d]
        self.ctx = Context(c[4], 128)
        self.u16 = Up(128, c[3], d[0])
        self.u8 = Up(d[0], c[2], d[1])
        self.u4 = Up(d[1], c[1], d[2])
        self.u2 = Up(d[2], c[0], d[3])
        self.aux = nn.Conv2d(d[3], 1, 1)                       # coarse alpha at stride 2 (deep supervision in training)
        self.head = nn.Sequential(_cbr(d[3] + 3 + 1, 16), _cbr(16, 16), nn.Conv2d(16, 1, 1))

    def init_states(self, device=None):
        z = torch.zeros(1, 1, 1, 1, device=device)
        return [z, z, z, z]

    def forward(self, src, r1=None, r2=None, r3=None, r4=None, return_aux=False):
        z = torch.zeros(1, 1, 1, 1, device=src.device, dtype=src.dtype)
        r1, r2, r3, r4 = [z if r is None else r for r in (r1, r2, r3, r4)]
        f2, f4, f8, f16, f32 = self.enc(src)
        x = self.ctx(f32)
        x, r1 = self.u16(x, f16, r1)
        x, r2 = self.u8(x, f8, r2)
        x, r3 = self.u4(x, f4, r3)
        x, r4 = self.u2(x, f2, r4)
        coarse = self.aux(x)
        x = F.interpolate(x, size=src.shape[2:], mode="bilinear", align_corners=False)
        c_up = F.interpolate(coarse, size=src.shape[2:], mode="bilinear", align_corners=False)
        logit = self.head(torch.cat([x, src, c_up], 1))
        pha = torch.sigmoid(logit)
        if return_aux:
            return pha, [r1, r2, r3, r4], torch.sigmoid(c_up)
        return pha, [r1, r2, r3, r4]

    def forward_seq(self, frames, return_aux=False):
        """frames [B,T,3,H,W] -> alphas [B,T,1,H,W] (and coarse alphas), unrolled with memory."""
        r = [None] * 4
        out, aux = [], []
        for t in range(frames.shape[1]):
            if return_aux:
                a, r, c = self.forward(frames[:, t], *r, return_aux=True)
                aux.append(c)
            else:
                a, r = self.forward(frames[:, t], *r)
            out.append(a)
        out = torch.stack(out, 1)
        return (out, torch.stack(aux, 1)) if return_aux else out


class StepExport(nn.Module):
    """ONNX wrapper with RVM-style flat names."""

    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, src, r1i, r2i, r3i, r4i):
        pha, (r1, r2, r3, r4) = self.m(src, r1i, r2i, r3i, r4i)
        return pha, r1, r2, r3, r4


def count_params(m):
    return sum(p.numel() for p in m.parameters())
