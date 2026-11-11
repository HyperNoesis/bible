"""Genesis Studio Export on Modal (serverless GPU, scales to zero, per-second billing).

Deploy (from the repo root):   modal deploy gpu/modal_app.py        (the GitHub workflow .github/workflows/modal-deploy.yml does this for you)
One-time secret (the workflow creates it):   modal secret create genesis-export GENESIS_EXPORT_TOKEN=<random> [ALLOW_ORIGIN=https://your-site] [DAILY_CAP=30] [ALLOW_REFERENCE=0]
Then put the printed URL and the same token in js/config.js as renderRelayUrl / renderRelayToken.

Two functions:
  render : GPU worker. BiRefNet-matting on every frame -> optical-flow temporal fusion -> scene integration (server/studio-export).
  api    : small CPU web app (gpu/export_api.py) that takes the upload, queues a render, and serves the result.
Weights and model code are baked into the image at build time by server/studio-export/fetch_models.sh (GitHub, pinned, SHA256-checked), so a
cold start never downloads anything.
"""
import os
import json
import subprocess
import time

import modal

APP_NAME = "genesis-export"
GPU = os.environ.get("GENESIS_GPU", "L4")                      # L4 (24 GB) is plenty for BiRefNet 1024 fp16; set GENESIS_GPU=L40S for longer clips
MAX_GPUS = int(os.environ.get("GENESIS_MAX_GPUS", "2"))        # hard cap on parallel GPU workers = hard cap on spend rate
INCLUDE_REFERENCE = os.environ.get("GENESIS_INCLUDE_REFERENCE", "1") == "1"   # 0 = leave MatAnyone 2 (non-commercial) out of the image entirely
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STUDIO_SRC = os.path.join(ROOT, "server", "studio-export")
SCENES_SRC = os.path.join(ROOT, "assets", "environments")

app = modal.App(APP_NAME)
jobs_vol = modal.Volume.from_name("genesis-export-jobs", create_if_missing=True)
meta = modal.Dict.from_name("genesis-export-meta", create_if_missing=True)
secret = modal.Secret.from_name("genesis-export")

gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "curl", "libgl1", "libglib2.0-0")
    .pip_install("torch==2.5.1", "torchvision==0.20.1")
    .pip_install("numpy<2", "opencv-python-headless", "timm", "scipy", "scikit-image", "kornia", "einops", "tqdm",
                 "imageio==2.25.0", "imageio-ffmpeg", "huggingface_hub==0.36.2", "safetensors", "onnxruntime", "pillow")
    # MatAnyone 2 reference engine only (off unless ALLOW_REFERENCE=1). Best effort: its full dependency list was not exercised here.
    .pip_install("hydra-core>=1.3.2", "omegaconf", "cython", "gitpython", "easydict", "av", "hickle", "pycocotools")
    .add_local_dir(STUDIO_SRC, "/opt/studio", copy=True,
                   ignore=["weights/*.pth", "weights/*.onnx", "vendor", "**/__pycache__", "*.mp4"])
    .add_local_dir(SCENES_SRC, "/opt/scenes", copy=True)
    .run_commands("cd /opt/studio && SKIP_REFERENCE=%s sh fetch_models.sh" % ("0" if INCLUDE_REFERENCE else "1"))     # clones BiRefNet + MatAnyone2 at pinned commits, downloads 4 weight files, verifies SHA256
)

web_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("fastapi[standard]")
    .add_local_file(os.path.join(HERE, "export_api.py"), "/root/export_api.py")
)

MAX_SECONDS = float(os.environ.get("GENESIS_MAX_SECONDS", "30"))


def _set(job_id, **kw):
    rec = dict(meta.get(job_id) or {})
    rec.update(kw)
    meta.put(job_id, rec)


@app.function(image=gpu_image, gpu=GPU, cpu=4, memory=32768, timeout=1800, max_containers=MAX_GPUS,
              scaledown_window=60, volumes={"/jobs": jobs_vol}, secrets=[secret])
def render(job_id: str, opts: dict):
    import cv2
    jobs_vol.reload()
    d = "/jobs/" + job_id
    inp, out = d + "/in.mp4", d + "/out.mp4"
    _set(job_id, status="running")
    try:
        cap = cv2.VideoCapture(inp)
        n, fps = cap.get(cv2.CAP_PROP_FRAME_COUNT), cap.get(cv2.CAP_PROP_FPS) or 30.0
        cap.release()
        if not n:
            raise RuntimeError("the clip could not be read")
        if n / fps > MAX_SECONDS:
            raise RuntimeError("clip is longer than %d s (this service's limit)" % MAX_SECONDS)
        cmd = ["python", "/opt/studio/studio_export.py", "-i", inp, "-o", out, "--engine", opts["engine"],
               "--out-mode", opts["out_mode"], "--look", opts["look"], "--max-size", str(opts["max_size"])]
        scene = "/opt/scenes/%s.jpg" % opts["scene"] if opts.get("scene") else ""
        if scene and os.path.exists(scene) and opts["out_mode"] == "composite":
            cmd += ["--background", scene]
        p = subprocess.run(cmd, cwd="/opt/studio", capture_output=True, text=True, timeout=1700)
        last = {}
        for line in reversed(p.stdout.strip().splitlines()):
            try:
                last = json.loads(line)
                break
            except ValueError:
                continue
        if p.returncode != 0 or not os.path.exists(out):
            tail = (p.stderr or p.stdout or "").strip().splitlines()[-1:] or ["unknown error"]
            raise RuntimeError("export failed: " + tail[0][:200])
        _set(job_id, status="done", flicker=last.get("flicker"), seconds=last.get("seconds"))
    except Exception as e:                                      # noqa: BLE001  (report, never crash silently)
        _set(job_id, status="error", error=str(e)[:300])
    finally:
        try:
            os.remove(inp)                                      # privacy: the original upload is deleted as soon as the render ends
        except OSError:
            pass
        jobs_vol.commit()


class _Store:
    jobs_dir = "/jobs"

    def reload(self): jobs_vol.reload()
    def commit(self): jobs_vol.commit()

    def get(self, k):
        try:
            return meta.get(k)
        except KeyError:
            return None

    def put(self, k, v): meta.put(k, v)

    def delete(self, k):
        try:
            meta.pop(k)
        except KeyError:
            pass

    def spawn(self, job_id, opts): return render.spawn(job_id, opts).object_id
    def cancel(self, call_id):
        try:
            modal.FunctionCall.from_id(call_id).cancel()
        except Exception:                                       # noqa: BLE001
            pass


@app.function(image=web_image, volumes={"/jobs": jobs_vol}, secrets=[secret], scaledown_window=120, max_containers=1)
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def api():
    import export_api
    e = os.environ
    return export_api.build_app({
        "token": e.get("GENESIS_EXPORT_TOKEN", ""),
        "allow_origin": e.get("ALLOW_ORIGIN", "*"),
        "max_mb": float(e.get("MAX_MB", "60")),
        "daily_cap": int(e.get("DAILY_CAP", "30")),
        "default_scene": e.get("DEFAULT_SCENE", "interview-studio"),
        "allow_reference": e.get("ALLOW_REFERENCE", "0") == "1",
        "max_size_default": int(e.get("MAX_SIZE_DEFAULT", "1080")),
        "ttl_min": float(e.get("TTL_MIN", "120")),
    }, _Store())
