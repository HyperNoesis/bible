// CI GATE H (v0.64): in real Chromium, draws a person whose head touches the top of the camera frame and checks the top edge is a soft fade, not a hard cut;
// and that a head with clear headroom is drawn untouched. Run: node tools/e2e/t47_headroom_fade_gate.js
const fs = require('fs'), path = require('path'); const { chromium } = require(process.env.PW_LIB || 'playwright');
(async () => {
  const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
  const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox'] }); const page = await b.newPage();
  await page.setContent('<canvas id=c width=800 height=450></canvas>');
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'providers', 'scene-engine.js'), 'utf8') });
  const r = await page.evaluate(() => {
    const SE = window.VS.SceneEngine, cw = 800, ch = 450; const out = {};
    const mkPerson = () => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; const x = c.getContext('2d'); x.fillStyle = '#c08060'; x.fillRect(200, 0, 400, ch); return c; };   // opaque block from the very top
    for (const [name, bounds] of [['touching', { minX: 200, maxX: 600, minY: 0, maxY: ch }], ['clear', { minX: 200, maxX: 600, minY: 80, maxY: ch }]]) {
      const eng = new SE(); eng.setState({ personScale: 0.7, personX: 0, personY: 0, lightStrength: 0, deskOn: false });
      const c = document.getElementById('c'), x = c.getContext('2d'); x.clearRect(0, 0, cw, ch);
      eng.drawPerson(x, mkPerson(), cw, ch, 'none', bounds, {});
      const rect = eng.personRect(cw, ch), colX = Math.round(cw / 2), topY = Math.round(rect.dy);
      const px = (y) => x.getImageData(colX, Math.min(ch - 1, y), 1, 1).data[3];
      out[name] = { dy: rect.dy, a0: px(topY + 1), a1: px(topY + 8), a2: px(topY + 20), deep: px(topY + 120) };
    }
    return out;
  });
  console.log(JSON.stringify(r)); let bad = 0; const ok = (n, c) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
  ok('head touching frame top: very top row is nearly transparent (soft)', r.touching.a0 < 60);
  ok('head touching frame top: alpha ramps up (top < 8px below < 20px below <= deep)', r.touching.a0 < r.touching.a1 && r.touching.a1 < r.touching.a2 + 1 && r.touching.a2 <= r.touching.deep);
  ok('head touching frame top: well inside the body is fully opaque', r.touching.deep >= 250);
  ok('head with headroom: top edge unchanged (opaque from the first row)', r.clear.a0 >= 250);
  await b.close(); process.exit(bad ? 1 : 0);
})();
