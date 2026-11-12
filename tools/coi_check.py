# Checks that the built site becomes cross-origin isolated through the service worker alone (no server headers). Needs: pip install playwright + a Chromium. Serves www/ copies on localhost. Usage: edit the two paths at the bottom.
import asyncio, threading, http.server, socketserver, functools
from playwright.async_api import async_playwright
def serve(root, port):
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self,*a): pass
    s = socketserver.ThreadingTCPServer(("127.0.0.1", port), functools.partial(Q, directory=root)); s.daemon_threads=True
    threading.Thread(target=s.serve_forever, daemon=True).start()
async def run(name, root, port):
    serve(root, port)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args=["--no-sandbox"])
        pg = await (await b.new_context()).new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
        await pg.goto(f"http://127.0.0.1:{port}/index.html"); await pg.wait_for_timeout(4000)      # first visit: SW installs + claims
        first = await pg.evaluate("() => ({iso: self.crossOriginIsolated, ctrl: !!navigator.serviceWorker.controller})")
        await pg.goto(f"http://127.0.0.1:{port}/settings.html"); await pg.wait_for_timeout(3000)   # next page: now under the SW
        second = await pg.evaluate("() => ({url: location.pathname, iso: self.crossOriginIsolated, sab: typeof SharedArrayBuffer, ctrl: !!navigator.serviceWorker.controller})")
        w = await pg.evaluate("() => new Promise(res => { const w = new Worker('js/threadcheck.js'); w.onmessage = e => res(e.data); w.onerror = () => res('worker error'); setTimeout(() => res('timeout'), 4000); })")
        sab = await pg.evaluate("""() => { try { const m = new WebAssembly.Memory({initial:1, maximum:2, shared:true}); return m.buffer instanceof SharedArrayBuffer; } catch (e) { return 'no: ' + e.message.slice(0,60); } }""")
        print(f"{name}\n  first page : {first}\n  next page  : {second}\n  worker isolated: {w} | shared WASM memory possible: {sab} | page errors: {errs[:2]}")
        await b.close()
async def main():
    await run("PATCHED service worker", "/tmp/wwwA", 8831)
    await run("CONTROL (old service worker)", "/tmp/wwwB", 8832)
asyncio.run(main())
