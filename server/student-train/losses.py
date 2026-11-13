"""Training losses for the live student. All tensors are [B,T,1,H,W] alphas in 0..1 (pred vs teacher/GT)."""
import torch
import torch.nn.functional as F

_K = None


def _gauss(device, dtype):
    k = torch.tensor([1, 4, 6, 4, 1], dtype=dtype, device=device)
    k = (k[:, None] * k[None, :]) / 256.0
    return k.view(1, 1, 5, 5)


def _blur_down(x):
    k = _gauss(x.device, x.dtype)
    x = F.conv2d(F.pad(x, (2, 2, 2, 2), mode="reflect"), k)
    return x[:, :, ::2, ::2], x


def lap_loss(p, g, levels=4):
    """L1 between Laplacian-pyramid bands: weights the edge detail (hair, fingers) far more than a plain L1 does."""
    loss = 0.0
    for i in range(levels):
        pd, pb = _blur_down(p)
        gd, gb = _blur_down(g)
        up_p = F.interpolate(pd, size=p.shape[2:], mode="bilinear", align_corners=False)
        up_g = F.interpolate(gd, size=g.shape[2:], mode="bilinear", align_corners=False)
        loss = loss + (2 ** i) * F.l1_loss(p - up_p, g - up_g)
        p, g = pd, gd
    return loss / levels


def _sobel(x):
    kx = torch.tensor([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=x.dtype, device=x.device).view(1, 1, 3, 3) / 8
    ky = kx.transpose(2, 3)
    x = F.pad(x, (1, 1, 1, 1), mode="replicate")
    return F.conv2d(x, kx), F.conv2d(x, ky)


def grad_loss(p, g):
    px, py = _sobel(p)
    gx, gy = _sobel(g)
    return F.l1_loss(px, gx) + F.l1_loss(py, gy)


def temporal_loss(p, g):
    """The student's frame-to-frame CHANGE must match the (already smooth) teacher's change: kills shimmer without blurring real motion."""
    if p.shape[1] < 2:
        return p.new_zeros(())
    return F.l1_loss(p[:, 1:] - p[:, :-1], g[:, 1:] - g[:, :-1])


def edge_weight(g, k=7, boost=4.0):
    """Per-pixel weight: 1 everywhere, up to 1+boost in the soft edge band of the target (where matting is hard)."""
    band = ((g > 0.02) & (g < 0.98)).float()
    band = F.max_pool2d(band, k, 1, k // 2)
    return 1.0 + boost * band


def total_loss(pred, gt, aux=None, w=None):
    """pred, gt: [B,T,1,H,W]. Returns (scalar, dict of parts)."""
    w = dict(l1=1.0, lap=1.0, grad=1.0, temporal=1.0, aux=0.5, **(w or {}))
    B, T = pred.shape[:2]
    p, g = pred.flatten(0, 1), gt.flatten(0, 1)
    ew = edge_weight(g)
    parts = {
        "l1": (torch.abs(p - g) * ew).mean(),
        "lap": lap_loss(p, g),
        "grad": grad_loss(p, g),
        "temporal": temporal_loss(pred, gt),
    }
    if aux is not None:
        parts["aux"] = F.l1_loss(aux.flatten(0, 1), g)
    total = sum(w[k] * v for k, v in parts.items())
    return total, {k: float(v.detach()) for k, v in parts.items()}
