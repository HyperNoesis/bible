#!/usr/bin/env python3
"""Studio Export: highest-quality person matting for a RECORDED clip (runs on a GPU box, not in the browser).

Two engines (v0.82):
  --engine clean (default, every part MIT/Apache/BSD, fine for a paid product)
      BiRefNet (MIT) alpha on EVERY frame -> optical-flow temporal fusion (temporal.py) -> scene integration (scene_integrate.py)
  --engine matanyone2 (REFERENCE ONLY: MatAnyone 2 is under the NTU S-Lab non-commercial licence)
      BiRefNet first mask -> MatAnyone 2 for every frame. Use it to measure how close the clean engine gets; do not ship its output
      in a paid service unless you hold a written commercial licence from the authors (see docs/MODEL_DECISION_v0_82.md).
Looks: --look scene (default) = foreground colour estimation + colour cast match + light wrap + cast shadow + grain match;
       --look plain = the old straight alpha blend.

Usage:
  python studio_export.py -i clip.webm -o out.mp4 --background scene.jpg
  python studio_export.py -i clip.webm -o alpha.mp4 --out-mode alpha
  python studio_export.py -i clip.webm -o out.mp4 --background scene.jpg --mask-model general --max-size 1080
Hook into the render worker:  RENDER_CMD='python studio_export.py -i {in} -o {out} --background /path/scene.jpg'
Run fetch_models.sh once first. Progress lines on stdout are JSON: {"progress":0.42,"stage":"matting"}.
Heavy imports are inside functions so matting_logic.py stays testable without torch.
"""
import argparse, json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np
import matting_logic as L
import temporal as T
import scene_integrate as SI

WEIGHTS = {"matting": "BiRefNet-matting.pth", "portrait": "BiRefNet-portrait.pth", "general": "BiRefNet-general.pth", "lite": "BiRefNet-lite.pth"}


def say(**kw):
    print(json.dumps(kw), flush=True)


def read_frames(path, max_side):
    import cv2
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise SystemExit("cannot open input video")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if not (1 < fps < 121):
        fps = 30.0
    frames = []
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        h, w = bgr.shape[:2]
        s = min(1.0, max_side / min(h, w)) if max_side > 0 else 1.0
        if s < 1.0:
            bgr = cv2.resize(bgr, (int(round(w * s / 2) * 2), int(round(h * s / 2) * 2)), interpolation=cv2.INTER_AREA)
        else:
            bgr = bgr[: h - h % 2, : w - w % 2]
        frames.append(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    cap.release()
    if not frames:
        raise SystemExit("input video has no frames")
    return frames, fps


def first_mask(frame, model_name, device):  # matanyone2 engine only
    """BiRefNet probability map for one frame -> cleaned uint8 mask."""
    import torch, cv2
    bir = os.path.join(HERE, "vendor", "BiRefNet")
    sys.path.insert(0, bir)
    from models.birefnet import BiRefNet  # noqa
    from utils import check_state_dict  # noqa
    net = BiRefNet(bb_pretrained=False)
    sd = torch.load(os.path.join(HERE, "weights", WEIGHTS["portrait" if model_name == "matting" else model_name]), map_location="cpu")
    net.load_state_dict(check_state_dict(sd))
    net = net.to(device).eval()
    h, w = frame.shape[:2]
    x = cv2.resize(frame, (1024, 1024), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    x = (x - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
    t = torch.from_numpy(x.transpose(2, 0, 1))[None].to(device)
    with torch.inference_mode():
        pred = net(t)[-1].sigmoid().float().cpu().numpy()[0, 0]
    del net
    if device == "cuda":
        torch.cuda.empty_cache()
    prob = cv2.resize(pred, (w, h), interpolation=cv2.INTER_LINEAR)
    return L.clean_first_mask(prob)


def matte(frames, mask_u8, device, n_warmup, erode, dilate, progress):
    """MatAnyone 2 over `frames` (list of RGB uint8) starting from mask_u8 on frames[0]. Returns list of float alpha (H,W)."""
    import torch
    ma = os.path.join(HERE, "vendor", "MatAnyone2")
    sys.path.insert(0, ma)
    from matanyone2.inference.inference_core import InferenceCore
    from matanyone2.utils.get_default_model import get_matanyone2_model
    from matanyone2.utils.inference_utils import gen_dilate, gen_erosion
    model = get_matanyone2_model(os.path.join(HERE, "weights", "matanyone2.pth"), device)
    proc = InferenceCore(model, cfg=model.cfg)
    m = mask_u8
    if dilate > 0:
        m = gen_dilate(m, dilate, dilate)
    if erode > 0:
        m = gen_erosion(m, erode, erode)
    mask = torch.from_numpy(m).float().to(device)
    seq = [frames[0]] * n_warmup + list(frames)
    out = []
    ctx = torch.autocast(device_type=device, dtype=torch.float16) if device == "cuda" else torch.autocast(device_type="cpu", enabled=False)
    with torch.inference_mode(), ctx:
        for ti, fr in enumerate(seq):
            img = (torch.from_numpy(fr).permute(2, 0, 1).float() / 255.0).to(device)
            if ti == 0:
                prob = proc.step(img, mask, objects=[1])
                prob = proc.step(img, first_frame_pred=True)
            elif ti <= n_warmup:
                prob = proc.step(img, first_frame_pred=True)
            else:
                prob = proc.step(img)
            if ti >= n_warmup:
                out.append(proc.output_prob_to_mask(prob).float().cpu().numpy())
                progress((ti - n_warmup + 1) / len(frames))
    return out


def write_video(path, frames_rgb, fps):
    import imageio_ffmpeg
    h, w = frames_rgb[0].shape[:2]
    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", f"{fps:.3f}",
           "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for f in frames_rgb:
        p.stdin.write(np.ascontiguousarray(f).tobytes())
    p.stdin.close()
    if p.wait() != 0:
        raise SystemExit("video encode failed")


def mux_audio(src, video, out):
    """Copy the original audio track onto the result when there is one."""
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", video, "-i", src, "-map", "0:v:0", "-map", "1:a:0?", "-c", "copy", "-shortest", out])
    return r.returncode == 0


def clean_alpha(frames, a, device, progress):
    """BiRefNet on every frame -> optional hand-crop refinement -> optional SAM 2.1 tracker gate -> flow-guided temporal fusion.
    Returns (fused alpha list, raw alpha list, backend string, extra stats dict)."""
    from birefnet_runner import BiRefNetRunner
    import hands_refine as H
    import tracker_gate as TG
    runner = BiRefNetRunner(HERE, onnx_path=a.birefnet_onnx, pth_name=WEIGHTS.get(a.mask_model, "BiRefNet-matting.pth"), size=a.size)
    say(stage="matting", backend=runner.backend, engine="clean")
    if getattr(a, "tta", False):                      # flip test-time augmentation: average the prediction on the frame and its mirror (2x slower, cleaner edges)
        _one = runner.alpha
        runner.alpha = lambda f, _o=_one: np.ascontiguousarray(0.5 * (_o(f) + _o(np.ascontiguousarray(f[:, ::-1]))[:, ::-1]))
        say(note="flip TTA on")
    refiner = H.make_refiner(runner, a, say)
    raw, extra = [], {}
    for i, fr in enumerate(frames):
        al = runner.alpha(fr)
        raw.append(refiner(fr, al, i) if refiner else al)
        progress(0.8 * (i + 1) / len(frames))
    if refiner:
        extra["hands"] = dict(refiner.stats)
        if refiner.last_error:
            extra["hands_last_error"] = refiner.last_error
        refiner.close()
    gated = raw
    if a.tracker != "off":
        try:
            ckpt = a.sam2_checkpoint or os.path.join(HERE, "weights", "sam2.1_hiera_tiny.pt")
            if not os.path.exists(ckpt):
                raise FileNotFoundError(f"SAM 2.1 checkpoint not found: {ckpt} (see fetch_models.sh --sam2)")
            start = a.start_frame if a.start_frame >= 0 else L.pick_start_frame(frames)
            say(stage="tracking", start=start)
            tr = TG.Sam2Tracker(ckpt, device=device)
            masks = tr.masks(frames, raw[start], start, progress=lambda x: progress(0.8 + 0.1 * x))
            gated, st = TG.gate_sequence(raw, masks)
            extra["tracker"] = st
        except Exception as e:
            if a.tracker == "on":
                raise SystemExit(f"--tracker on failed: {e}")
            say(note=f"tracker gate skipped: {e}")
    fused = T.fuse_sequence(gated, frames, bidirectional=not a.causal) if not a.no_temporal else gated
    return fused, raw, runner.backend, extra


def main(a):
    import cv2
    t0 = time.time()
    try:
        device = "cuda" if __import__("torch").cuda.is_available() else "cpu"
    except ImportError:                                   # the ONNX route needs no torch
        device = "cpu"
    say(stage="reading", device=device, engine=a.engine)
    frames, fps = read_frames(a.input, a.max_size)
    n = len(frames)
    raw_alpha, extra = None, {}
    if a.engine == "clean":
        def p1(x):
            say(progress=round(min(0.95, x), 3), stage="matting")
        alpha, raw_alpha, _, extra = clean_alpha(frames, a, device, p1)
    else:
        say(note="engine matanyone2 = reference/benchmark only (non-commercial licence, see docs/MODEL_DECISION_v0_82.md)")
        start = a.start_frame if a.start_frame >= 0 else L.pick_start_frame(frames)
        say(stage="first-mask", frames=n, start=start)
        if a.first_mask:
            mask = cv2.imread(a.first_mask, 0)
            mask = cv2.resize(mask, (frames[0].shape[1], frames[0].shape[0]), interpolation=cv2.INTER_NEAREST)
        else:
            mask = first_mask(frames[start], a.mask_model, device)
        ok, frac = L.mask_is_plausible(mask)
        if not ok:
            raise SystemExit(f"first-frame mask covers {frac:.0%} of the picture: no clear person found (try --start-frame or --first-mask)")
        fwd_idx, back_idx = L.split_plan(n, start)
        total = len(fwd_idx) + (len(back_idx) - 1)
        done = [0]

        def prog(stage_part):
            def f(p):
                say(progress=round(min(1.0, (done[0] + p * stage_part) / total), 3), stage="matting")
            return f

        fwd = matte([frames[i] for i in fwd_idx], mask, device, a.warmup, a.erode, a.dilate, prog(len(fwd_idx)))
        done[0] = len(fwd_idx)
        back = [fwd[0]]
        if len(back_idx) > 1:
            back = matte([frames[i] for i in back_idx], mask, device, a.warmup, a.erode, a.dilate, prog(len(back_idx) - 1))
        alpha = L.merge_alpha(n, start, fwd, back)
    say(stage="encoding", progress=0.97)
    h, w = frames[0].shape[:2]
    if a.out_mode == "alpha":
        out_frames = [np.repeat((np.clip(x, 0, 1) * 255 + 0.5).astype(np.uint8)[..., None], 3, -1) for x in alpha]
    else:
        bg = cv2.cvtColor(cv2.imread(a.background), cv2.COLOR_BGR2RGB) if a.background else np.full((h, w, 3), (0, 177, 64), np.uint8)
        bg = L.fit_background(bg, w, h)
        if a.look == "scene":
            side = SI.light_side(bg)                           # one reading per scene so the shadow does not wander
            rng = np.random.default_rng(7)
            out_frames = [SI.integrate(f, np.clip(x, 0, 1), bg, a.harmonise, a.wrap, a.shadow, a.grain, side=side, rng=rng)
                          for f, x in zip(frames, alpha)]
        else:
            out_frames = [L.composite(f, np.clip(x, 0, 1), bg) for f, x in zip(frames, alpha)]
    tmp = a.output + ".tmp.mp4"
    write_video(tmp, out_frames, fps)
    if not mux_audio(a.input, tmp, a.output):
        os.replace(tmp, a.output)
    else:
        os.remove(tmp)
    res = dict(stage="done", progress=1.0, seconds=round(time.time() - t0, 1), flicker=round(L.temporal_flicker(alpha), 4), frames=n, out=a.output, engine=a.engine)
    if raw_alpha is not None:
        res["flicker_before_fusion"] = round(L.temporal_flicker(raw_alpha), 4)
    res.update(extra)
    say(**res)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("-i", "--input", required=True)
    p.add_argument("-o", "--output", required=True)
    p.add_argument("--engine", choices=["clean", "matanyone2"], default="clean", help="clean = BiRefNet + temporal fusion (commercial-safe); matanyone2 = reference only")
    p.add_argument("--background", help="scene picture to place the person on (default: green)")
    p.add_argument("--out-mode", choices=["composite", "alpha"], default="composite")
    p.add_argument("--look", choices=["scene", "plain"], default="scene", help="scene = make the person part of the picture (default)")
    p.add_argument("--harmonise", type=float, default=0.30, help="0..1 colour cast match")
    p.add_argument("--wrap", type=float, default=0.35, help="0..1 light wrap from the scene")
    p.add_argument("--shadow", type=float, default=0.30, help="0..1 cast shadow on the scene")
    p.add_argument("--grain", type=float, default=0.8, help="0..1.5 grain match for the scene")
    p.add_argument("--mask-model", choices=list(WEIGHTS), default="matting", help="BiRefNet weights (matting = soft alpha; portrait/general = sharper binary-ish masks)")
    p.add_argument("--birefnet-onnx", help="use this BiRefNet .onnx (onnxruntime) instead of the .pth weights")
    p.add_argument("--size", type=int, default=1024, help="BiRefNet input size")
    p.add_argument("--no-temporal", action="store_true", help="skip temporal fusion (to measure its effect)")
    p.add_argument("--causal", action="store_true", help="forward-only temporal fusion (a live-ish preview; the default also runs backward and averages)")
    p.add_argument("--first-mask", help="matanyone2 engine: use this PNG as the first-frame mask instead of BiRefNet")
    p.add_argument("--start-frame", type=int, default=-1, help="matanyone2 engine: frame to start from (default: sharpest of the first 40)")
    p.add_argument("--max-size", type=int, default=1080, help="shorter side in px for processing (0 = original)")
    p.add_argument("--warmup", type=int, default=10)
    p.add_argument("--erode", type=int, default=10)
    p.add_argument("--dilate", type=int, default=10)
    p.add_argument("--hands", choices=["auto", "on", "off"], default="auto", help="re-run BiRefNet on a crop around each hand (MediaPipe Hands) for finger detail; auto = on when mediapipe is installed")
    p.add_argument("--hands-mode", choices=["union", "replace"], default="union", help="union = crop can only ADD alpha (safest); replace = crop alpha wins inside the box (sharper, opens finger gaps)")
    p.add_argument("--hands-pad", type=float, default=1.8, help="crop size as a multiple of the hand's landmark box")
    p.add_argument("--hands-max", type=int, default=2, help="refine at most this many hands per frame (largest first)")
    p.add_argument("--tta", action="store_true", help="flip test-time augmentation for BiRefNet (2x slower, cleaner edges; used for student training labels)")
    p.add_argument("--tracker", choices=["off", "auto", "on"], default="off", help="SAM 2.1 tracker gate: removes stray alpha away from the tracked person (single-subject clips). auto = skip quietly if SAM 2 is missing")
    p.add_argument("--sam2-checkpoint", help="path to sam2.1_hiera_tiny.pt (default weights/sam2.1_hiera_tiny.pt)")
    main(p.parse_args())
