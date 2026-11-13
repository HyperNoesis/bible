"""Tracker gate (v0.84): use a SAM 2.1 video tracker (Apache-2.0) as a STEADY, coarse "where is the person" mask, and remove BiRefNet
alpha that falls outside it. BiRefNet decides every frame alone, so now and then a patch of background or a bystander lights up for a
frame or two; the tracker follows one object through the clip and does not do that. The gate only SUBTRACTS (it never adds alpha), it
is dilated so hair and fingers beyond SAM's coarse mask survive, and it switches itself off on any frame where the tracker and
BiRefNet disagree too much (tracker lost the subject), so the worst case is "no change".

Single-subject clips: a second person is outside the tracker's prompt and would be gated out unless the two masks disagree enough
(min_keep) to switch the gate off. For two-person clips leave --tracker off.

gate_alpha / gate_sequence / bbox_from_alpha are numpy + OpenCV only and unit-tested. Sam2Tracker needs the sam2 package and a
checkpoint and was NOT run in the sandbox that wrote it (see CHANGELOG-v0_84).
"""
import os
import numpy as np


def _smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def bbox_from_alpha(alpha, thr=0.5, keep_ratio=0.15):
    """(x0, y0, x1, y1) around the main person (all pieces at least keep_ratio of the largest), or None when there is nobody."""
    from scipy import ndimage as ndi
    m = np.asarray(alpha) >= thr
    lab, n = ndi.label(m)
    if n == 0:
        return None
    areas = ndi.sum(m, lab, index=np.arange(1, n + 1))
    keep = [i + 1 for i, ar in enumerate(areas) if ar >= keep_ratio * areas.max()]
    ys, xs = np.where(np.isin(lab, keep))
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def gate_alpha(alpha, track_mask, dilate_frac=0.04, min_mask_frac=0.002, min_keep=0.6):
    """Returns (alpha, status). status: "gated" | "no_mask" (tracker found nothing) | "disagree" (gate would remove too much alpha)."""
    import cv2
    h, w = alpha.shape[:2]
    if track_mask is None:
        return alpha, "no_mask"
    m = np.asarray(track_mask) > 0
    if m.shape != alpha.shape[:2] or m.mean() < min_mask_frac:
        return alpha, "no_mask"
    r = max(2, int(round(dilate_frac * min(h, w))))
    d = cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))).astype(np.float32)
    g = _smoothstep(0.15, 0.6, cv2.GaussianBlur(d, (0, 0), max(1.0, r / 3.0)))
    out = (alpha * g).astype(np.float32)
    tot = float(alpha.sum())
    if tot > 0 and float(out.sum()) / tot < min_keep:
        return alpha, "disagree"
    return out, "gated"


def gate_sequence(alphas, masks, dilate_frac=0.04, **kw):
    """Gate every frame. Returns (alphas, stats) with stats = {"gated": n, "no_mask": n, "disagree": n}."""
    stats = {"gated": 0, "no_mask": 0, "disagree": 0}
    out = []
    for a, m in zip(alphas, masks):
        o, s = gate_alpha(a, m, dilate_frac, **kw)
        stats[s] += 1
        out.append(o)
    return out, stats


class Sam2Tracker:
    """SAM 2.1 video predictor, prompted once with the person's box on the start frame, then propagated forward and backward.
    Install: pip install git+https://github.com/facebookresearch/sam2.git   Checkpoint: sam2.1_hiera_tiny.pt (Apache-2.0).
    Written against the public SAM 2 video-predictor API; NOT run here, so expect to adjust names if the API has moved."""

    def __init__(self, checkpoint, config="configs/sam2.1/sam2.1_hiera_t.yaml", device="cuda"):
        from sam2.build_sam import build_sam2_video_predictor
        self.device = device
        self.pred = build_sam2_video_predictor(config, checkpoint, device=device)

    def masks(self, frames_rgb, start_alpha, start, progress=None):
        """Returns a list (one per frame) of bool (H, W) masks, None where the tracker gave nothing."""
        import shutil, tempfile
        import cv2
        import torch
        n = len(frames_rgb)
        box = bbox_from_alpha(start_alpha)
        if box is None:
            raise ValueError("no person on the start frame, cannot prompt the tracker")
        d = tempfile.mkdtemp(prefix="sam2frames_")
        out = [None] * n
        try:
            for i, fr in enumerate(frames_rgb):
                cv2.imwrite(os.path.join(d, f"{i:05d}.jpg"), cv2.cvtColor(fr, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 95])
            done = 0
            with torch.inference_mode(), torch.autocast(self.device, dtype=torch.bfloat16, enabled=(self.device == "cuda")):
                state = self.pred.init_state(video_path=d, offload_video_to_cpu=True, offload_state_to_cpu=True)
                self.pred.add_new_points_or_box(inference_state=state, frame_idx=start, obj_id=1, box=np.array(box, np.float32))
                for fi, _ids, logits in self.pred.propagate_in_video(state, start_frame_idx=start):
                    out[fi] = (logits[0, 0] > 0).cpu().numpy()
                    done += 1
                    if progress:
                        progress(done / n)
                if start > 0:
                    for fi, _ids, logits in self.pred.propagate_in_video(state, start_frame_idx=start, reverse=True):
                        out[fi] = (logits[0, 0] > 0).cpu().numpy()
        finally:
            shutil.rmtree(d, ignore_errors=True)
        return out
