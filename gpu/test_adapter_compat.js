// Drives the app's REAL js/providers/render-provider.js (createRelayAdapter + runRenderJob) against the Python API. Run: node gpu/test_adapter_compat.js
const { spawn } = require('child_process'); const path = require('path');
const RP = require(path.join(__dirname, '..', 'js', 'providers', 'render-provider.js'));
const PORT = 8799; let fails = 0;
const check = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' ' + x : '')); if (!c) fails++; };
const srv = spawn('python3', [path.join(__dirname, 'protocol_server_for_test.py')], { env: { ...process.env, PORT }, stdio: 'inherit' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok) break; } catch (_) {} await wait(200); }
  const base = `http://127.0.0.1:${PORT}`;
  const clip = new Blob([Buffer.alloc(4096, 1)], { type: 'video/mp4' });
  const states = [];
  const r = await RP.runRenderJob({ adapter: RP.createRelayAdapter({ baseUrl: base, token: 'tok123' }), clip, prompt: RP.LEVEL3_PROMPT, options: { resolution: '720p', duration: 6 }, pollMs: 300, onState: (s) => states.push(s) }).promise;
  check('real adapter + runRenderJob finish ok against the Python API', r.ok === true && r.state === 'done', JSON.stringify({ ok: r.ok, state: r.state, err: r.error }));
  check('states went uploading -> queued -> ... -> done', states[0] === 'uploading' && states.includes('queued') && states[states.length - 1] === 'done', states.join(','));
  check('the result blob was downloaded WITH the token (resultUrl is on our own base)', r.result && r.result.blob && (await r.result.blob.text()).startsWith('FAKE-MP4-RESULT-'));
  const bad = await RP.runRenderJob({ adapter: RP.createRelayAdapter({ baseUrl: base, token: 'WRONG' }), clip, prompt: 'x', pollMs: 100, retries: 0 }).promise;
  check('wrong token is reported as a failure, not a hang', bad.ok === false, bad.error);
  srv.kill(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(2); });
