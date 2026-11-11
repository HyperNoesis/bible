// Unit: a multi-thread worker start that fails must fall back to 1 thread (threads can never make a phone worse); single-thread failure must still throw.
const fs = require('fs'), path = require('path'); const R = path.resolve(__dirname, '..', '..');
let inits = [], failAbove = 1;
global.document = { baseURI: 'http://x/app/', createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) };
global.self = { crossOriginIsolated: true };
Object.defineProperty(global, 'navigator', { value: { hardwareConcurrency: 8 }, configurable: true, writable: true });
global.localStorage = { _m: {}, getItem(k) { return this._m[k] == null ? null : this._m[k]; }, setItem(k, v) { this._m[k] = String(v); } };
global.Worker = class { constructor(u) { this.u = u; this.terminated = false; }
  postMessage(m) { setTimeout(() => { inits.push(m.threads); if (m.type === 'init' && m.threads > failAbove) this.onmessage({ data: { id: m.id, type: 'error', message: 'threads unsupported' } }); else this.onmessage({ data: { id: m.id, type: 'ready', gpu: false } }); }, 0); }
  terminate() { this.terminated = true; } };
global.SharedArrayBuffer = function () {};
global.window = { VS: {} };
const src = fs.readFileSync(path.join(R, 'js/providers/modnet-provider.js'), 'utf8');
(0, eval)(src.replace(/\bconst (MODNET_\w+)/g, 'var $1').replace(/\bclass (MODNet\w+)/g, 'var $1 = class $1'));
let bad = 0; const t = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
(async () => {
  const P = window.VS.MODNetWorkerProvider;
  t('8 cores + isolated -> 4 threads cap (cores-1 capped at 4)', P.threadsFor() === 4, P.threadsFor());
  navigator.hardwareConcurrency = 2; t('2 cores -> 1 thread', P.threadsFor() === 1);
  navigator.hardwareConcurrency = 8; self.crossOriginIsolated = false; t('not isolated -> 1 thread', P.threadsFor() === 1); self.crossOriginIsolated = true;
  localStorage.setItem('vs_threads', '1'); t('vs_threads=1 kill switch -> 1 thread', P.threadsFor() === 1); localStorage.setItem('vs_threads', '0');
  const p = new P(); failAbove = 1; inits = [];
  await p._boot('x.js', () => ({}), 3);
  t('multi-thread start that fails retries with 1 thread', JSON.stringify(inits) === '[3,1]' && p.threads === 1, inits);
  const q = new P(); failAbove = 8; inits = [];
  await q._boot('x.js', () => ({}), 3);
  t('multi-thread start that works keeps 3 threads', JSON.stringify(inits) === '[3]' && q.threads === 3, inits);
  const z = new P(); failAbove = 0; inits = []; let threw = false;
  try { await z._boot('x.js', () => ({}), 1); } catch (e) { threw = /unsupported/.test(e.message); }
  t('single-thread failure still reports the error', threw && JSON.stringify(inits) === '[1]', inits);
  process.exit(bad ? 1 : 0);
})();
