"""HTTP API for Genesis Studio Export. Speaks the SAME contract as server/render-relay.js, so js/providers/render-provider.js
(createRelayAdapter) works unchanged:
    POST   /render/jobs?prompt=..&resolution=..&duration=..   body = the clip          -> {"jobId": "..."}
    GET    /render/jobs/{id}                                                           -> {"status": queued|running|done|error, "resultUrl": "...", "error": "..."}
    GET    /render/jobs/{id}/result                                                    -> video/mp4
    DELETE /render/jobs/{id}                                                           -> {"ok": true}
    GET    /health                                                                     -> config summary (no secrets, no auth)
Extra optional query fields for Studio Export: engine (clean | matanyone2), out_mode (composite | alpha), look (scene | plain), scene, max_size.
Kept free of any Modal import so it can be unit-tested anywhere (see test_export_api.py). modal_app.py wires it to real storage + GPU."""
import hmac, os, re, shutil, time, uuid, datetime

SCENE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


def _today():
    return datetime.datetime.utcnow().strftime("%Y-%m-%d")


def build_app(cfg, store):
    """cfg: dict(token, allow_origin, max_mb, daily_cap, default_scene, allow_reference, max_size_default, ttl_min)
    store: object with jobs_dir, reload(), commit(), get(key), put(key, val), delete(key), spawn(job_id, opts)->call_id, cancel(call_id)."""
    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse, FileResponse
    from starlette.concurrency import run_in_threadpool

    token = cfg.get("token") or ""
    max_bytes = int(float(cfg.get("max_mb", 60)) * 1048576)
    daily_cap = int(cfg.get("daily_cap", 30))
    ttl = float(cfg.get("ttl_min", 120)) * 60
    origins = [o.strip() for o in str(cfg.get("allow_origin") or "*").split(",") if o.strip()]

    app = FastAPI(title="Genesis Studio Export", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
                       allow_headers=["Authorization", "Content-Type"], max_age=600)

    def err(code, msg):
        return JSONResponse({"error": msg}, status_code=code)

    def authed(req):
        if not token:
            return err(503, "the export service has no access token configured")
        got = req.headers.get("authorization", "")
        if not hmac.compare_digest(got.encode(), ("Bearer " + token).encode()):
            return err(401, "unauthorised")
        return None

    def base_url(req):
        return "https://" + (req.headers.get("x-forwarded-host") or req.headers.get("host") or "localhost") if not cfg.get("plain_http") else \
            "http://" + (req.headers.get("host") or "localhost")

    def jdir(job_id):
        return os.path.join(store.jobs_dir, job_id)

    def sweep():
        """Delete job folders older than the TTL so clips never linger."""
        try:
            for name in os.listdir(store.jobs_dir):
                p = os.path.join(store.jobs_dir, name)
                if os.path.isdir(p) and time.time() - os.path.getmtime(p) > ttl:
                    shutil.rmtree(p, ignore_errors=True)
                    store.delete(name)
        except FileNotFoundError:
            pass

    @app.get("/health")
    async def health():
        return {"ok": True, "service": "genesis-studio-export", "token_configured": bool(token), "daily_cap": daily_cap,
                "max_mb": max_bytes / 1048576, "reference_engine_enabled": bool(cfg.get("allow_reference"))}

    @app.post("/render/jobs")
    async def create(req: Request):
        bad = authed(req)
        if bad:
            return bad
        q = req.query_params
        engine = q.get("engine", "clean")
        if engine not in ("clean", "matanyone2"):
            return err(400, "engine must be clean or matanyone2")
        if engine == "matanyone2" and not cfg.get("allow_reference"):
            return err(403, "the MatAnyone 2 reference engine is switched off on this service (non-commercial licence)")
        out_mode = q.get("out_mode", "composite")
        look = q.get("look", "scene")
        if out_mode not in ("composite", "alpha") or look not in ("scene", "plain"):
            return err(400, "bad out_mode or look")
        scene = q.get("scene") or cfg.get("default_scene") or ""
        if scene and not SCENE_RE.match(scene):
            return err(400, "bad scene name")
        try:
            max_size = int(q.get("max_size", cfg.get("max_size_default", 1080)))
        except ValueError:
            return err(400, "bad max_size")
        max_size = max(240, min(2160, max_size))
        declared = req.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > max_bytes:
            return err(413, "clip too large (max %d MB)" % (max_bytes // 1048576))
        chunks, n = [], 0
        async for c in req.stream():
            n += len(c)
            if n > max_bytes:
                return err(413, "clip too large (max %d MB)" % (max_bytes // 1048576))
            chunks.append(c)
        if n < 1024:
            return err(400, "empty or too small clip")
        day = "cap:" + _today()
        used = await run_in_threadpool(store.get, day) or 0
        if used >= daily_cap:
            return err(429, "daily render limit reached")
        await run_in_threadpool(store.reload)
        await run_in_threadpool(sweep)
        job_id = uuid.uuid4().hex[:16]
        os.makedirs(jdir(job_id), exist_ok=True)
        with open(os.path.join(jdir(job_id), "in.mp4"), "wb") as f:
            for c in chunks:
                f.write(c)
        await run_in_threadpool(store.put, day, used + 1)
        await run_in_threadpool(store.put, job_id, {"status": "queued", "t": time.time()})
        await run_in_threadpool(store.commit)
        opts = {"engine": engine, "out_mode": out_mode, "look": look, "scene": scene, "max_size": max_size}
        call_id = await run_in_threadpool(store.spawn, job_id, opts)
        await run_in_threadpool(store.put, job_id, {"status": "queued", "t": time.time(), "call": call_id})
        return JSONResponse({"jobId": job_id}, status_code=202)

    @app.get("/render/jobs/{job_id}")
    async def status(job_id: str, req: Request):
        bad = authed(req)
        if bad:
            return bad
        rec = await run_in_threadpool(store.get, job_id) if re.fullmatch(r"[0-9a-f]{16}", job_id) else None
        if not rec:
            return err(404, "unknown job")
        st = rec.get("status", "queued")
        out = {"status": st if st in ("queued", "running", "done", "error") else "error"}
        if st == "done":
            out["resultUrl"] = base_url(req) + "/render/jobs/" + job_id + "/result"
        if st == "error":
            out["error"] = rec.get("error") or "the export failed"
        return out

    @app.get("/render/jobs/{job_id}/result")
    async def result(job_id: str, req: Request):
        bad = authed(req)
        if bad:
            return bad
        rec = await run_in_threadpool(store.get, job_id) if re.fullmatch(r"[0-9a-f]{16}", job_id) else None
        if not rec or rec.get("status") != "done":
            return err(404 if not rec else 409, "unknown job" if not rec else "not ready")
        await run_in_threadpool(store.reload)
        p = os.path.join(jdir(job_id), "out.mp4")
        if not os.path.exists(p):
            return err(410, "the result has expired")
        return FileResponse(p, media_type="video/mp4", filename="genesis-export.mp4")

    @app.delete("/render/jobs/{job_id}")
    async def cancel(job_id: str, req: Request):
        bad = authed(req)
        if bad:
            return bad
        rec = await run_in_threadpool(store.get, job_id) if re.fullmatch(r"[0-9a-f]{16}", job_id) else None
        if not rec:
            return err(404, "unknown job")
        if rec.get("call") and rec.get("status") in ("queued", "running"):
            await run_in_threadpool(store.cancel, rec["call"])
        await run_in_threadpool(store.reload)
        shutil.rmtree(jdir(job_id), ignore_errors=True)
        await run_in_threadpool(store.delete, job_id)
        await run_in_threadpool(store.commit)
        return {"ok": True}

    return app
