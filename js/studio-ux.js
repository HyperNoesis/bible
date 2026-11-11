/* Studio UX layer (v0.59). Presentation + honest readouts only. It never touches camera, rendering, segmentation or recording logic.
 * - groups the 17 tool tabs (moves existing buttons, keeps ids/data-targets/listeners)
 * - first-run guide strip (Pick scene > Start camera > Record), driven by real state, gone after the first saved take
 * - ready check chips: Light (LightMeter), Mic (audio chain peak), Camera (decoded frames/s). Nothing is invented: a chip stays "--" until measured
 * - post-recording card (thumbnail, length, Download / Trim / Open in Projects) from the vs:recording-saved event fired in app.js
 * - tab title "Recording" while recording
 * Every step is wrapped: if anything is missing the studio simply behaves as before. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LS = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const frame = $('previewFrame'); if (!frame) return;
  const icon = (n, s) => (window.VS && window.VS.icon ? window.VS.icon(n, s || 16) : '');
  const baseTitle = document.title;
  const themeMeta = document.querySelector('meta[name="theme-color"]'); const baseTheme = themeMeta && themeMeta.content;
  const setTheme = (c) => { if (themeMeta) themeMeta.content = c || baseTheme; };
  let recording = false, card = null;

  /* ---------- 1. grouped tabs (presentational) ---------- */
  (function groupTabs() {
    try {
      const rail = $('toolRail'); if (!rail) return;
      const GROUPS = [
        ['Set', ['panel-env', 'panel-looks', 'panel-composition', 'panel-realism', 'panel-refine']],
        ['Perform', ['panel-camera', 'panel-audio', 'panel-prompter', 'panel-captions']],
        ['On screen', ['panel-show', 'panel-graphics', 'panel-content', 'panel-templates']],
        ['Output', ['panel-quality', 'panel-recordings', 'panel-live']],
        ['Advanced', ['panel-advanced']],
      ];
      const by = {}; rail.querySelectorAll('.tool-tab').forEach((t) => { by[t.dataset.target] = t; });
      const frag = document.createDocumentFragment(); const used = new Set();
      GROUPS.forEach(([name, ids]) => {
        const tabs = ids.map((i) => by[i]).filter(Boolean); if (!tabs.length) return;
        const l = document.createElement('span'); l.className = 'tool-group-label'; l.setAttribute('aria-hidden', 'true'); l.textContent = name; frag.appendChild(l);
        tabs.forEach((t) => { frag.appendChild(t); used.add(t); });
      });
      Object.keys(by).forEach((k) => { if (!used.has(by[k])) frag.appendChild(by[k]); });   // anything new stays reachable
      rail.appendChild(frag);
      rail.classList.add('is-grouped');
      /* progressive disclosure: six core tools first, everything else under "More tools" */
      const CORE = ['panel-env', 'panel-looks', 'panel-camera', 'panel-audio', 'panel-graphics', 'panel-live'];
      rail.querySelectorAll('.tool-tab').forEach((t) => { if (CORE.indexOf(t.dataset.target) < 0) t.classList.add('tool-more'); });
      const more = document.createElement('button'); more.type = 'button'; more.className = 'rail-more'; more.id = 'railMoreBtn';
      const setMore = (open, remember) => {
        rail.classList.toggle('is-collapsed', !open); more.setAttribute('aria-expanded', String(open));
        more.innerHTML = '<span class="rail-more-ico" aria-hidden="true">' + (open ? '\u2212' : '+') + '</span><span class="tab-label">' + (open ? 'Fewer' : 'More') + '</span>';
        more.title = open ? 'Show fewer tools' : 'Show all tools';
        if (remember) LS.set('vs_ux_rail_more', open ? '1' : '0');
      };
      more.addEventListener('click', (e) => { e.stopPropagation(); setMore(rail.classList.contains('is-collapsed'), true); });
      rail.appendChild(more);
      setMore(LS.get('vs_ux_rail_more') !== '0', false);
      const ensureVisible = () => { const a = rail.querySelector('.tool-tab.active'); if (a && a.classList.contains('tool-more') && rail.classList.contains('is-collapsed')) setMore(true, false); };
      new MutationObserver(ensureVisible).observe(rail, { subtree: true, attributes: true, attributeFilter: ['class'] }); ensureVisible();
      const act = rail.querySelector('.tool-tab.active'); if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (e) { /* keep the original rail */ }
  })();

  /* ---------- scene preview behind the empty stage ---------- */
  (function sceneBehindStart() {
    const ov = $('previewOverlay'), grid = $('envMiniGrid'); if (!ov || !grid) return;
    const sync = () => { const t = grid.querySelector('.env-card.selected .env-thumb'); const bg = t && t.style.backgroundImage; const m = bg && bg.match(/url\(["']?([^"')]+)["']?\)/); if (m) ov.style.setProperty('--scene', 'url("' + new URL(m[1], document.baseURI).href + '")'); };
    new MutationObserver(sync).observe(grid, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] }); sync(); setTimeout(sync, 800);
  })();

  /* ---------- real state readers ---------- */
  const cameraOn = () => { const s = $('transportStatus'); return !!s && /previewing|recording/i.test(s.textContent || ''); };
  const scenePicked = () => LS.get('vs_ux_scene_picked') === '1';
  const firstTakeDone = () => LS.get('vs_ux_first_take') === '1';
  const markScene = () => { LS.set('vs_ux_scene_picked', '1'); refreshGuide(); };
  try { const q = new URLSearchParams(location.search); if (q.get('env')) LS.set('vs_ux_scene_picked', '1'); } catch (e) {}
  const envSel = $('envSelect'); if (envSel) envSel.addEventListener('change', markScene);
  const miniGrid = $('envMiniGrid'); if (miniGrid) miniGrid.addEventListener('click', () => setTimeout(markScene, 0));
  const wiz = $('sceneWizardBtn'); if (wiz) wiz.addEventListener('click', () => { /* opening the wizard is not picking a scene */ });

  /* ---------- 2. first-run guide ---------- */
  let guide = null;
  function buildGuide() {
    if (firstTakeDone() || LS.get('vs_ux_guide_off') === '1') return;
    guide = document.createElement('div'); guide.className = 'ux-guide'; guide.setAttribute('role', 'group'); guide.setAttribute('aria-label', 'Getting started');
    guide.innerHTML =
      '<ol class="ux-steps">' +
      '<li data-step="scene"><span class="ux-num" aria-hidden="true">1</span><span class="ux-step-t">Pick a scene</span></li>' +
      '<li data-step="camera"><span class="ux-num" aria-hidden="true">2</span><span class="ux-step-t">Start camera</span></li>' +
      '<li data-step="record"><span class="ux-num" aria-hidden="true">3</span><span class="ux-step-t">Record</span></li>' +
      '</ol><button type="button" class="ux-x" aria-label="Hide getting started guide">' + icon('close', 14) + '<span class="ux-x-t">Hide</span></button>';
    guide.querySelector('.ux-x').addEventListener('click', () => { LS.set('vs_ux_guide_off', '1'); guide.remove(); guide = null; });
    frame.appendChild(guide);
    refreshGuide();
  }
  function refreshGuide() {
    if (!guide) return;
    const st = { scene: scenePicked(), camera: cameraOn() || recording, record: recording };
    let current = null; ['scene', 'camera', 'record'].forEach((k) => { if (!st[k] && !current) current = k; });
    guide.querySelectorAll('li').forEach((li) => {
      const k = li.dataset.step; li.classList.toggle('done', !!st[k]); li.classList.toggle('now', k === current);
      li.setAttribute('aria-current', k === current ? 'step' : 'false');
      const n = li.querySelector('.ux-num'); n.innerHTML = st[k] ? icon('check', 13) || '&#10003;' : (k === 'scene' ? '1' : k === 'camera' ? '2' : '3');
    });
    guide.classList.toggle('compact', cameraOn());
  }

  /* ---------- 3. ready check (real readouts only) ---------- */
  const ready = document.createElement('div'); ready.className = 'ux-ready'; ready.hidden = true; ready.setAttribute('role', 'status'); ready.setAttribute('aria-live', 'polite');
  ready.innerHTML =
    '<div class="ux-chips">' +
    '<span class="ux-chip" data-k="light"><i class="ux-dot" aria-hidden="true"></i><b>Light</b><em>--</em></span>' +
    '<span class="ux-chip" data-k="mic"><i class="ux-dot" aria-hidden="true"></i><b>Mic</b><em>--</em></span>' +
    '<span class="ux-chip" data-k="cam"><i class="ux-dot" aria-hidden="true"></i><b>Camera</b><em>--</em></span>' +
    '</div><p class="ux-advice"></p>';
  frame.appendChild(ready);
  const chip = (k) => ready.querySelector('[data-k="' + k + '"]');
  function setChip(k, tone, text) { const c = chip(k); if (!c) return; c.dataset.tone = tone; c.querySelector('em').textContent = text; }
  let lastDecoded = 0, lastT = 0, fps = null, quietSince = 0, heardVoice = false;
  function tickReady() {
    const on = cameraOn();
    ready.hidden = !on || recording || !!card;
    if (!on) { lastT = 0; fps = null; heardVoice = false; quietSince = 0; return; }
    if (recording) return;
    const VS = window.VS || {}; const advice = [];
    // Light: real luma from the existing light meter (1.5 s cadence)
    const lm = VS.LightMeter && VS.LightMeter.state ? VS.LightMeter.state() : null;
    if (lm && lm.level === 'ok') setChip('light', 'good', 'Good');
    else if (lm && lm.level === 'dim') { setChip('light', 'warn', 'Dim'); advice.push('Move toward a window or lamp so it lights your face.'); }
    else if (lm && lm.level === 'bright') { setChip('light', 'warn', 'Very bright'); advice.push('Turn away from the strongest light, or move back a little.'); }
    else setChip('light', 'idle', 'Measuring');
    // Mic: peak of the real audio chain (only exists when the mic is on)
    const ac = VS.audioChain; const peak = ac && isFinite(ac.peakDb) ? ac.peakDb : null;
    if (!ac) setChip('mic', 'idle', 'Off');
    else if (peak != null && peak > -3) { setChip('mic', 'warn', 'Too loud'); advice.push('Your voice is peaking. Move back from the mic or speak a little softer.'); heardVoice = true; }
    else if (peak != null && peak > -45) { setChip('mic', 'good', peak > -30 ? 'Good' : 'Quiet'); heardVoice = true; quietSince = 0; if (peak <= -30) advice.push('Your mic is a little quiet. Move closer.'); }
    else { if (!quietSince) quietSince = Date.now(); setChip('mic', 'idle', heardVoice ? 'Quiet' : 'Say hi'); if (!heardVoice && Date.now() - quietSince > 4000) advice.push('Say a few words to check your mic.'); }
    // Camera: real decoded frames per second
    const v = $('video'); const q = v && v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null; const now = performance.now();
    if (q && lastT && now - lastT > 900) { fps = Math.round((q.totalVideoFrames - lastDecoded) * 1000 / (now - lastT)); lastDecoded = q.totalVideoFrames; lastT = now; }
    else if (q && !lastT) { lastDecoded = q.totalVideoFrames; lastT = now; }
    if (fps == null) setChip('cam', 'idle', 'Measuring');
    else if (fps >= 24) setChip('cam', 'good', fps + ' fps');
    else if (fps >= 15) setChip('cam', 'warn', fps + ' fps');
    else { setChip('cam', 'warn', fps + ' fps'); advice.push('The camera is running slowly. Better light usually helps, or try Fast quality.'); }
    const p = ready.querySelector('.ux-advice');
    const allGood = !advice.length && lm && lm.level === 'ok' && fps != null && fps >= 24;
    p.textContent = advice[0] || (allGood ? 'Looking good. Press Record when you are ready.' : '');
    p.hidden = !p.textContent;
  }
  setInterval(() => { try { tickReady(); refreshGuide(); } catch (e) {} }, 1000);
  const ts = $('transportStatus'); if (ts && window.MutationObserver) new MutationObserver(() => { try { tickReady(); refreshGuide(); } catch (e) {} }).observe(ts, { childList: true, characterData: true, subtree: true });

  /* ---------- 4. recording title + start/stop ---------- */
  window.addEventListener('vs:recording-started', () => {
    recording = true; document.title = '\u25CF Recording \u00b7 Genesis'; setTheme('#2a1210');
    LS.set('vs_ux_guide_seen_record', '1'); tickReady(); refreshGuide(); hideCard();
  });

  /* ---------- 5. post-recording card ---------- */
  function hideCard() { if (card) { card.remove(); card = null; tickReady(); } }
  function fmt(ms) { const s = Math.max(0, Math.round(ms / 1000)); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); }
  window.addEventListener('vs:recording-saved', (ev) => {
    recording = false; document.title = baseTitle; setTheme(); tickReady();
    LS.set('vs_ux_first_take', '1'); if (guide) { guide.remove(); guide = null; }
    const d = (ev && ev.detail) || {}; hideCard();
    card = document.createElement('div'); card.className = 'ux-done'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Recording saved');
    const thumb = d.thumb ? '<img class="ux-done-thumb" alt="Thumbnail of your recording" src="' + d.thumb + '">' : '<div class="ux-done-thumb ux-done-thumb--empty" aria-hidden="true">' + icon('video', 26) + '</div>';
    card.innerHTML = thumb +
      '<div class="ux-done-body"><h3>Saved on this device</h3><p class="ux-done-meta">' + fmt(d.durationMs || 0) + ' \u00b7 ' + (d.mb ? d.mb + ' MB' : 'ready') + '</p>' +
      '<div class="ux-done-actions"><button type="button" class="btn primary sm" data-a="dl">' + icon('download', 15) + '<span>Download</span></button>' +
      '<button type="button" class="btn sm" data-a="trim">' + icon('crop', 15) + '<span>Trim</span></button>' +
      '<a class="btn ghost sm" href="projects.html">' + icon('projects', 15) + '<span>Open in Projects</span></a></div></div>' +
      '<button type="button" class="ux-done-x" aria-label="Close">' + icon('close', 16) + '</button>';
    frame.appendChild(card);
    const dl = card.querySelector('[data-a="dl"]'); dl.focus({ preventScroll: true });
    dl.addEventListener('click', () => { if (d.link) d.link.click(); });
    card.querySelector('[data-a="trim"]').addEventListener('click', () => {
      const tab = document.querySelector('.tool-tab[data-target="panel-recordings"]'); if (tab) tab.click();
      hideCard(); const tb = d.item && d.item.querySelector('.trim-btn'); if (tb) { setTimeout(() => { tb.scrollIntoView({ block: 'center' }); tb.click(); }, 60); }
    });
    card.querySelector('.ux-done-x').addEventListener('click', () => { hideCard(); const rb = $('recordBtn'); if (rb) rb.focus({ preventScroll: true }); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideCard(); const rb = $('recordBtn'); if (rb) rb.focus({ preventScroll: true }); } });
  });

  buildGuide();
  tickReady();
})();
