/* Projects page (Phase 4): recordings + custom environments. Behaviour kept from v0.64 (undoable delete, rename, duplicate,
   transcribe, SRT/VTT); presentation moved to the Genesis design system. */
(async () => {
  'use strict';
  const VS = window.VS, $ = (id) => document.getElementById(id), ic = (n, s) => VS.icon(n, s);
  const user = await VS.renderNav('projects');
  if (!user) return;
  const toast = VS.ds.toast;

  const envProvider = new VS.StaticEnvironmentProvider();
  await envProvider.hydrateFromStorage();

  // Honest storage note
  $('syncNote').innerHTML = ic('folder', 18) + (VS.storage.mode === 'supabase'
    ? '<span><strong>Synced to your account.</strong> Recordings are stored in the cloud and available on any device you sign in on.</span>'
    : '<span><strong>Saved on this device only.</strong> Clearing this browser\u2019s site data, or switching devices, removes them. Download anything you want to keep.</span>');

  const VIEW_KEY = 'g_proj_view';
  let view = 'cards', activeTab = 'recordings', recordings = [], pendingDel = null, urls = [], loadError = false, loading = true;
  try { view = localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards'; } catch (e) {}

  const recList = $('recList'), envGrid = $('envGrid'), search = $('searchInput'), sort = $('sortSelect'), count = $('libCount');
  const fmtDate = (ts) => { try { return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };
  const fmtDur = (s) => (!isFinite(s) || s <= 0) ? '' : Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
  const titleOf = (r) => r.meta.title || r.meta.environment || 'Recording';
  const subOf = (r) => [r.meta.quality ? String(r.meta.quality) : '', r.meta.aspect || '', r.meta.fps ? r.meta.fps + ' fps' : '', (r.createdAt ? fmtDate(r.createdAt) : r.meta.createdAt)].filter(Boolean).join(' \u00b7 ');
  function revokeUrls() { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; }
  function mkUrl(blob) { const u = URL.createObjectURL(blob); urls.push(u); return u; }
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function applySearchSort(items, nameFn, dateFn) {
    const q = search.value.trim().toLowerCase();
    const list = q ? items.filter(i => nameFn(i).toLowerCase().includes(q)) : items.slice();
    if (sort.value === 'newest') list.sort((a, b) => dateFn(b) - dateFn(a));
    else if (sort.value === 'oldest') list.sort((a, b) => dateFn(a) - dateFn(b));
    else list.sort((a, b) => nameFn(a).localeCompare(nameFn(b)));
    return list;
  }

  async function loadRecordings() {
    loadError = false;
    try { recordings = (await VS.storage.listRecordings()).filter(r => !(pendingDel && pendingDel.rec.id === r.id)); }
    catch (e) { loadError = true; recordings = []; }
    loading = false;
  }

  // ---- forgiving delete: leaves the list now, file removed after 7 s so Undo is real; closing the page keeps the file ----
  function commitPending() {
    if (!pendingDel) return; const p = pendingDel; pendingDel = null; clearTimeout(p.timer); p.toast.remove();
    VS.storage.deleteRecording(p.rec.id).catch(() => {});
  }
  function softDelete(id) {
    commitPending();
    const idx = recordings.findIndex(r => r.id === id); if (idx < 0) return;
    const rec = recordings.splice(idx, 1)[0]; renderRecordings();
    const t = el('div', 'p-undo', '<span>Recording deleted</span><button type="button" class="g-btn g-btn--secondary" style="min-height:40px">Undo</button>');
    t.setAttribute('role', 'status'); t.id = 'undoToast'; document.body.appendChild(t);
    const p = pendingDel = { rec, idx, toast: t, timer: setTimeout(commitPending, 7000) };
    t.querySelector('button').addEventListener('click', () => {
      if (pendingDel !== p) return; pendingDel = null; clearTimeout(p.timer); t.remove();
      recordings.splice(Math.min(p.idx, recordings.length), 0, p.rec); renderRecordings();
    });
    t.querySelector('button').focus({ preventScroll: true });
  }

  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

  function startRename(card, rec) {
    const h = card.querySelector('.p-title'); const input = el('input', 'g-input p-rename'); input.value = titleOf(rec); input.setAttribute('aria-label', 'Recording name');
    h.replaceWith(input); input.focus(); input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return; done = true;
      const v = input.value.trim() || 'Recording';
      if (save && v !== titleOf(rec)) { try { await VS.storage.updateRecordingMeta(rec.id, { title: v }); rec.meta.title = v; toast('Renamed'); } catch (e) { toast('Could not rename. Try again.'); } }
      renderRecordings();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  }

  async function transcribe(rec, item) {
    if (!VS.GroqTranscriptionProvider.hasApiKey) { toast('Transcription is not available right now.'); return; }
    toast('Transcribing. This can take a minute.');
    try {
      const cues = await VS.GroqTranscriptionProvider.transcribe(rec.blob, () => {});
      await VS.storage.updateRecordingMeta(rec.id, { captions: cues }); await loadRecordings(); renderRecordings(); toast('Captions ready');
    } catch (err) { toast(err.message || 'Transcription failed. Your recording has not changed.'); }
  }

  function menuFor(rec, card) {
    const wrap = el('div', 'p-menuwrap');
    const btn = el('button', 'g-iconbtn', ic('more', 18)); btn.type = 'button'; btn.style.cssText = 'width:40px;height:40px'; btn.setAttribute('aria-label', 'More actions for ' + titleOf(rec));
    const hasCaps = rec.meta.captions && rec.meta.captions.length, canTx = VS.GroqTranscriptionProvider && VS.GroqTranscriptionProvider.hasApiKey;
    const pop = el('div', 'g-menu'); pop.setAttribute('role', 'menu'); pop.hidden = true;
    const add = (label, fn, opts = {}) => { const b = el('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = label; if (opts.danger) b.setAttribute('data-danger', ''); if (opts.disabled) { b.setAttribute('aria-disabled', 'true'); b.title = opts.disabled; } else b.addEventListener('click', () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); fn(); }); pop.appendChild(b); };
    add('Rename', () => startRename(card, rec));
    add('Download', () => download(rec.blob, 'genesis-' + rec.id + '.webm'));
    add('Duplicate', async () => { await VS.storage.duplicateRecording(rec.id); await loadRecordings(); renderRecordings(); toast('Duplicated'); });
    add(hasCaps ? 'Re-transcribe' : 'Transcribe', () => transcribe(rec), canTx ? {} : { disabled: 'Transcription is not set up yet' });
    if (hasCaps) { add('Download captions (SRT)', () => download(new Blob([VS.CaptionsProvider.toSRT(rec.meta.captions)], { type: 'text/plain' }), 'genesis-' + rec.id + '.srt')); add('Download captions (VTT)', () => download(new Blob([VS.CaptionsProvider.toVTT(rec.meta.captions)], { type: 'text/vtt' }), 'genesis-' + rec.id + '.vtt')); }
    add('Delete\u2026', () => softDelete(rec.id), { danger: true });
    wrap.append(btn, pop); VS.ds.menu(btn, pop); return wrap;
  }

  // ---- playback dialog (main click on a card) ----
  const dlg = $('playDlg'), pv = $('playVideo'); let lastOpener = null;
  function openPlayer(rec, opener) {
    lastOpener = opener || null; const u = mkUrl(rec.blob);
    pv.src = u; $('playTitle').textContent = titleOf(rec); $('playSub').textContent = subOf(rec);
    const d = $('playDownload'); d.href = u; d.download = 'genesis-' + rec.id + '.webm';
    dlg.showModal(); history.replaceState(null, '', '#rec-' + rec.id);
  }
  dlg.addEventListener('close', () => { pv.pause(); pv.removeAttribute('src'); pv.load(); history.replaceState(null, '', location.pathname); if (lastOpener) lastOpener.focus(); });
  $('playClose').addEventListener('click', () => dlg.close());

  function renderRecordings() {
    revokeUrls(); recList.className = 'p-grid' + (view === 'list' ? ' is-list' : ''); recList.innerHTML = '';
    if (loading) { count.textContent = 'Loading'; for (let i = 0; i < 6; i++) recList.appendChild(el('div', 'g-skel p-skel')); return; }
    if (loadError) {
      count.textContent = '';
      recList.innerHTML = '<div class="g-errorstate p-state" role="alert" style="grid-column:1/-1"><h3>Genesis could not load your recordings</h3><p class="g-text-2">Nothing has been changed or deleted. Try again, and if it keeps happening, reload the page.</p><button type="button" class="g-btn g-btn--secondary" id="retryBtn">Try again</button></div>';
      $('retryBtn').addEventListener('click', async () => { loading = true; renderRecordings(); await loadRecordings(); renderRecordings(); });
      return;
    }
    const items = applySearchSort(recordings, titleOf, r => r.createdAt);
    count.textContent = items.length + (items.length === 1 ? ' recording' : ' recordings');
    if (!recordings.length) { count.textContent = ''; recList.innerHTML = '<div class="g-empty p-state" style="grid-column:1/-1"><h3>No recordings yet</h3><p class="g-text-2">Everything you record in Studio lands here, ready to play, rename and download.</p><a class="g-btn g-btn--primary" href="studio.html?action=start">Start your first recording</a></div>'; return; }
    if (!items.length) { const q = search.value.trim(); recList.innerHTML = '<div class="g-empty p-state" style="grid-column:1/-1"><h3></h3><p class="g-text-2">Try a different search or clear it.</p><button type="button" class="g-btn g-btn--secondary" id="clearSearch">Clear search</button></div>'; recList.querySelector('h3').textContent = 'No recordings match \u201c' + q + '\u201d'; $('clearSearch').addEventListener('click', () => { search.value = ''; renderRecordings(); search.focus(); }); return; }
    items.forEach(rec => {
      const card = el('article', 'p-card'); card.id = 'rec-' + rec.id;
      const thumb = el('button', 'p-thumb'); thumb.type = 'button'; thumb.setAttribute('aria-label', 'Play ' + titleOf(rec));
      const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.setAttribute('playsinline', ''); v.src = mkUrl(rec.blob);
      // show a real frame as the thumbnail: nudge the playhead once data is ready (recorder files often lack seek info)
      v.addEventListener('loadeddata', () => { v.play().then(() => setTimeout(() => { v.pause(); try { v.currentTime = 0; } catch (e) {} }, 140)).catch(() => {}); }, { once: true });
      const dur = el('span', 'p-dur'); dur.hidden = true;
      v.addEventListener('loadedmetadata', () => { const t = fmtDur(v.duration); if (t) { dur.textContent = t; dur.hidden = false; } });
      v.addEventListener('error', () => { v.remove(); thumb.insertBefore(el('span', 'p-ph', ic('video', 28)), thumb.firstChild); });
      thumb.append(v, el('span', 'p-play', ic('play', 18)), dur); thumb.addEventListener('click', () => openPlayer(rec, thumb));
      const body = el('div', 'p-body'), row = el('div', 'p-row'), h = el('h3', 'p-title'); h.textContent = titleOf(rec); h.title = titleOf(rec);
      row.append(h, menuFor(rec, card)); const sub = el('p', 'p-sub'); sub.textContent = subOf(rec);
      body.append(row, sub); card.append(thumb, body); recList.appendChild(card);
    });
    if (location.hash.startsWith('#rec-')) { const id = location.hash.slice(5), r = recordings.find(x => x.id === id); const c = document.getElementById('rec-' + id); if (r && c && !dlg.open) { c.scrollIntoView({ block: 'center' }); openPlayer(r, c.querySelector('.p-thumb')); } }
  }

  // ---- environments ----
  let envToDelete = null;
  function renderEnvironments() {
    envGrid.className = 'p-grid' + (view === 'list' ? ' is-list' : ''); envGrid.innerHTML = '';
    const all = envProvider.list().filter(e => e.category === 'Custom' && e.type === 'image');
    const items = applySearchSort(all, e => e.name, () => 0);
    count.textContent = items.length + (items.length === 1 ? ' custom environment' : ' custom environments');
    if (!all.length) { count.textContent = ''; envGrid.innerHTML = '<div class="g-empty p-state" style="grid-column:1/-1"><h3>No custom environments yet</h3><p class="g-text-2">Upload a background image in Studio and it will appear here.</p><a class="g-btn g-btn--primary" href="studio.html">Open Studio</a></div>'; return; }
    if (!items.length) { envGrid.innerHTML = '<div class="g-empty p-state" style="grid-column:1/-1"><h3></h3><p class="g-text-2">Try a different search or clear it.</p><button type="button" class="g-btn g-btn--secondary" id="clearSearchE">Clear search</button></div>'; envGrid.querySelector('h3').textContent = 'No environments match \u201c' + search.value.trim() + '\u201d'; $('clearSearchE').addEventListener('click', () => { search.value = ''; renderEnvironments(); search.focus(); }); return; }
    items.forEach(env => {
      const card = el('article', 'p-card'); const link = el('a', 'p-thumb'); link.href = 'studio.html?env=' + encodeURIComponent(env.id); link.setAttribute('aria-label', 'Use ' + env.name + ' in Studio'); link.style.cssText = envProvider.getPreviewStyle(env.id) + ';background-size:cover;background-position:center';
      const body = el('div', 'p-body'), row = el('div', 'p-row'), h = el('h3', 'p-title'); h.textContent = env.name;
      const wrap = el('div', 'p-menuwrap'), btn = el('button', 'g-iconbtn', ic('more', 18)); btn.type = 'button'; btn.style.cssText = 'width:40px;height:40px'; btn.setAttribute('aria-label', 'More actions for ' + env.name);
      const pop = el('div', 'g-menu'); pop.setAttribute('role', 'menu'); pop.hidden = true;
      const add = (label, fn, danger) => { const b = el('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = label; if (danger) b.setAttribute('data-danger', ''); b.addEventListener('click', () => { pop.hidden = true; fn(); }); pop.appendChild(b); };
      add('Use in Studio', () => { location.href = link.href; });
      add('Rename', () => { const input = el('input', 'g-input p-rename'); input.value = env.name; input.setAttribute('aria-label', 'Environment name'); h.replaceWith(input); input.focus(); input.select(); let d = false; const fin = (s) => { if (d) return; d = true; if (s) envProvider.renameCustomImage(env.id, input.value.trim() || env.id); renderEnvironments(); }; input.addEventListener('keydown', e => { if (e.key === 'Enter') fin(true); else if (e.key === 'Escape') fin(false); }); input.addEventListener('blur', () => fin(true)); });
      add('Delete\u2026', () => { envToDelete = env; $('envDlg').showModal(); }, true);
      wrap.append(btn, pop); VS.ds.menu(btn, pop);
      row.append(h, wrap); const sub = el('p', 'p-sub'); sub.textContent = 'Custom image';
      body.append(row, sub); card.append(link, body); envGrid.appendChild(card);
    });
  }
  $('envKeep').addEventListener('click', () => $('envDlg').close());
  $('envConfirm').addEventListener('click', () => { if (envToDelete) { envProvider.removeCustomImage(envToDelete.id); toast('Environment deleted'); } envToDelete = null; $('envDlg').close(); renderEnvironments(); });

  // ---- tabs, view, search ----
  function renderActive() { if (activeTab === 'recordings') renderRecordings(); else renderEnvironments(); }
  function setTab(t) {
    activeTab = t; $('tabRecordings').setAttribute('aria-selected', String(t === 'recordings')); $('tabEnvironments').setAttribute('aria-selected', String(t === 'environments'));
    $('panelRecordings').hidden = t !== 'recordings'; $('panelEnvironments').hidden = t === 'recordings'; search.value = ''; renderActive();
  }
  function setView(v) { view = v; try { localStorage.setItem(VIEW_KEY, v); } catch (e) {} $('viewCards').setAttribute('aria-pressed', String(v === 'cards')); $('viewList').setAttribute('aria-pressed', String(v === 'list')); renderActive(); }
  $('tabRecordings').addEventListener('click', () => setTab('recordings'));
  $('tabEnvironments').addEventListener('click', () => setTab('environments'));
  $('viewCards').addEventListener('click', () => setView('cards')); $('viewList').addEventListener('click', () => setView('list'));
  search.addEventListener('input', renderActive); sort.addEventListener('change', renderActive);
  window.addEventListener('beforeunload', revokeUrls);

  $('viewCards').setAttribute('aria-pressed', String(view === 'cards')); $('viewList').setAttribute('aria-pressed', String(view === 'list'));
  renderRecordings();            // skeleton while the library loads
  await loadRecordings();
  renderActive();
})();
