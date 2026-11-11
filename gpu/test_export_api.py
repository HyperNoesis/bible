"""Tests for export_api.py with an in-memory fake store (no Modal, no GPU). Run: python gpu/test_export_api.py"""
import os, sys, tempfile, time, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fastapi.testclient import TestClient
import export_api

FAILS = []
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra) if extra else ""))
    if not cond: FAILS.append(name)

class FakeStore:
    def __init__(self):
        self.jobs_dir = tempfile.mkdtemp(prefix="gx-"); self.d = {}; self.spawned = []; self.cancelled = []; self.commits = 0
    def reload(self): pass
    def commit(self): self.commits += 1
    def get(self, k): return self.d.get(k)
    def put(self, k, v): self.d[k] = v
    def delete(self, k): self.d.pop(k, None)
    def spawn(self, job_id, opts): self.spawned.append((job_id, opts)); return "fc-" + job_id
    def cancel(self, c): self.cancelled.append(c)

def make(**over):
    cfg = dict(token="secret-token", allow_origin="https://site.example", max_mb=1, daily_cap=3, default_scene="interview-studio", allow_reference=False, ttl_min=120)
    cfg.update(over); st = FakeStore(); return TestClient(export_api.build_app(cfg, st)), st

H = {"Authorization": "Bearer secret-token"}
CLIP = b"\x00\x00\x00\x18ftypmp42" + b"x" * 5000

c, st = make()
check("health works without auth", c.get("/health").json()["ok"] is True)
check("health shows reference engine is off", c.get("/health").json()["reference_engine_enabled"] is False)
check("no token header -> 401", c.post("/render/jobs", content=CLIP).status_code == 401)
check("wrong token -> 401", c.post("/render/jobs", content=CLIP, headers={"Authorization": "Bearer nope"}).status_code == 401)
c0, _ = make(token="")
check("no token configured -> 503 (never an open endpoint)", c0.post("/render/jobs", content=CLIP, headers=H).status_code == 503)

r = c.post("/render/jobs?prompt=x&resolution=720p&duration=6", content=CLIP, headers={**H, "Content-Type": "video/mp4"})
check("create -> 202 + jobId", r.status_code == 202 and len(r.json().get("jobId", "")) == 16, r.text)
jid = r.json()["jobId"]
check("job spawned once with default options", len(st.spawned) == 1 and st.spawned[0][1] == {"engine": "clean", "out_mode": "composite", "look": "scene", "scene": "interview-studio", "max_size": 1080}, st.spawned)
check("input was stored for the worker", os.path.exists(os.path.join(st.jobs_dir, jid, "in.mp4")))
check("volume committed after upload", st.commits >= 1)
s = c.get("/render/jobs/" + jid, headers=H).json()
check("status queued", s == {"status": "queued"}, s)
st.put(jid, {"status": "running", "call": "x"}); check("status running", c.get("/render/jobs/" + jid, headers=H).json()["status"] == "running")
check("result before done -> 409", c.get("/render/jobs/" + jid + "/result", headers=H).status_code == 409)
open(os.path.join(st.jobs_dir, jid, "out.mp4"), "wb").write(b"MP4DATA" * 100)
st.put(jid, {"status": "done", "call": "x"})
s = c.get("/render/jobs/" + jid, headers={**H, "host": "gx.modal.run"}).json()
check("done carries an https resultUrl on our own host (the app only sends the token to our URL)", s.get("status") == "done" and s["resultUrl"] == "https://gx.modal.run/render/jobs/%s/result" % jid, s)
res = c.get("/render/jobs/" + jid + "/result", headers=H)
check("result streams the mp4", res.status_code == 200 and res.headers["content-type"] == "video/mp4" and res.content.startswith(b"MP4DATA"))
check("result needs the token", c.get("/render/jobs/" + jid + "/result").status_code == 401)
st.put(jid, {"status": "error", "error": "boom"}); e = c.get("/render/jobs/" + jid, headers=H).json()
check("error status carries a message", e == {"status": "error", "error": "boom"}, e)
check("unknown job -> 404", c.get("/render/jobs/" + "a" * 16, headers=H).status_code == 404)
check("malformed job id -> 404 (no path tricks)", c.get("/render/jobs/..%2F..%2Fetc", headers=H).status_code in (404, 422))

c, st = make()
r1 = c.post("/render/jobs", content=CLIP, headers=H); r2 = c.post("/render/jobs", content=CLIP, headers=H); r3 = c.post("/render/jobs", content=CLIP, headers=H)
r4 = c.post("/render/jobs", content=CLIP, headers=H)
check("daily cap lets 3 through then answers 429", [r.status_code for r in (r1, r2, r3, r4)] == [202, 202, 202, 429], [r.status_code for r in (r1, r2, r3, r4)])
check("capped request did not spawn a GPU job", len(st.spawned) == 3)
c, st = make()
big = c.post("/render/jobs", content=b"x" * (2 * 1048576), headers=H)
check("oversize clip -> 413 and nothing queued", big.status_code == 413 and not st.spawned)
check("tiny body -> 400", c.post("/render/jobs", content=b"abc", headers=H).status_code == 400)
check("reference engine refused while switched off (licence)", c.post("/render/jobs?engine=matanyone2", content=CLIP, headers=H).status_code == 403)
cr, str_ = make(allow_reference=True)
check("reference engine allowed once switched on", cr.post("/render/jobs?engine=matanyone2", content=CLIP, headers=H).status_code == 202)
check("bad engine -> 400", c.post("/render/jobs?engine=evil", content=CLIP, headers=H).status_code == 400)
check("scene name with path chars -> 400", c.post("/render/jobs?scene=../../etc/passwd", content=CLIP, headers=H).status_code == 400)
ok = c.post("/render/jobs?scene=newsroom&out_mode=alpha&max_size=720", content=CLIP, headers=H)
check("scene/out_mode/max_size are passed to the worker", ok.status_code == 202 and st.spawned[-1][1]["scene"] == "newsroom" and st.spawned[-1][1]["out_mode"] == "alpha" and st.spawned[-1][1]["max_size"] == 720, st.spawned[-1:])
check("max_size is clamped", (c.post("/render/jobs?max_size=99999", content=CLIP, headers=H), st.spawned[-1][1]["max_size"])[1] == 2160)

pre = c.options("/render/jobs", headers={"Origin": "https://site.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"})
check("CORS preflight allowed for the site origin", pre.status_code == 200 and pre.headers.get("access-control-allow-origin") == "https://site.example", dict(pre.headers))
pre2 = c.options("/render/jobs", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
check("CORS preflight refused for another origin", "access-control-allow-origin" not in pre2.headers)

c, st = make()
jid = c.post("/render/jobs", content=CLIP, headers=H).json()["jobId"]
d = c.delete("/render/jobs/" + jid, headers=H)
check("DELETE cancels the GPU call and removes the clip", d.status_code == 200 and st.cancelled == ["fc-" + jid] and not os.path.exists(os.path.join(st.jobs_dir, jid)) and st.get(jid) is None, (d.text, st.cancelled))

c, st = make(ttl_min=0.001)
old = os.path.join(st.jobs_dir, "deadbeefdeadbeef"); os.makedirs(old); st.put("deadbeefdeadbeef", {"status": "done"})
os.utime(old, (time.time() - 3600, time.time() - 3600))
c.post("/render/jobs", content=CLIP, headers=H)
check("old job folders are swept (clips never linger)", not os.path.exists(old) and st.get("deadbeefdeadbeef") is None)

shutil.rmtree(st.jobs_dir, ignore_errors=True)
print("\n%d failed" % len(FAILS)); sys.exit(1 if FAILS else 0)
