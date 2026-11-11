"""Starts export_api with a fake store whose "GPU" finishes a job 1.5 s after it is spawned. Used only by test_adapter_compat.js."""
import os, sys, threading, time, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import uvicorn, export_api

class Store:
    jobs_dir = tempfile.mkdtemp(prefix="gxe2e-")
    def __init__(self): self.d = {}
    def reload(self): pass
    def commit(self): pass
    def get(self, k): return self.d.get(k)
    def put(self, k, v): self.d[k] = v
    def delete(self, k): self.d.pop(k, None)
    def cancel(self, c): pass
    def spawn(self, job_id, opts):
        def work():
            time.sleep(0.4); self.d[job_id] = {**self.d.get(job_id, {}), "status": "running"}
            time.sleep(1.1)
            open(os.path.join(self.jobs_dir, job_id, "out.mp4"), "wb").write(b"FAKE-MP4-RESULT-" + repr(opts).encode())
            self.d[job_id] = {**self.d.get(job_id, {}), "status": "done"}
        threading.Thread(target=work, daemon=True).start(); return "fc"
app = export_api.build_app(dict(token="tok123", allow_origin="*", max_mb=5, daily_cap=5, default_scene="interview-studio", plain_http=True), Store())
uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8799")), log_level="warning")
