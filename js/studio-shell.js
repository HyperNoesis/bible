/* Studio shell behaviour (Phase 5+): Setup / Live / Edit modes, responsive inspector,
   honest camera control and accessible tablet/phone sheets. Presentation only:
   this file never starts the camera or changes rendering/segmentation/recording logic. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const shell = $('studioShell'); if (!shell) return;
  const ic = (n, s) => (window.VS && window.VS.icon ? window.VS.icon(n, s || 16) : '');
  const phone = window.matchMedia('(max-width: 700px)');
  const tablet = window.matchMedia('(min-width: 701px) and (max-width: 1050px)');
  const LS = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const backIcon = $('backHomeIcon'); const setBack = () => { if (backIcon) backIcon.innerHTML = ic('arrowLeft', 16); }; setBack(); window.addEventListener('load', () => { setBack(); setTimeout(setBack, 300); });
  const rail = $('toolRail'), panel = document.querySelector('.control-panel'), frame = $('previewFrame');
  const topbar = document.querySelector('.studio-topbar'), cluster = document.querySelector('.status-cluster');

  /* ---- explicit workspace modes ---- */
  const labels = { setup: 'Setup', live: 'Live', edit: 'Edit' };
  const chip = document.createElement('span'); chip.className = 'studio-mode'; chip.id = 'modeChip'; chip.setAttribute('role', 'status');
  const session = document.querySelector('.studio-session');
  if (session) session.appendChild(chip);
  const modeBar = document.createElement('div'); modeBar.className = 'studio-mode-switch';
  modeBar.setAttribute('role', 'group'); modeBar.setAttribute('aria-label', 'Studio workspace mode');
  modeBar.innerHTML = '<button type="button" data-studio-mode="setup" aria-pressed="true">Setup</button><button type="button" data-studio-mode="live" aria-pressed="false">Live</button><button type="button" data-studio-mode="edit" aria-pressed="false">Edit</button>';
  const modeButtons = Array.from(modeBar.querySelectorAll('[data-studio-mode]'));
  if (session) session.insertBefore(modeBar, chip);

  /* ---- inspector controls ---- */
  const inspectorButton = document.createElement('button');
  inspectorButton.type = 'button'; inspectorButton.id = 'inspToggle'; inspectorButton.className = 'studio-inspector-icon';
  inspectorButton.setAttribute('aria-label', 'Show or hide the tool inspector'); inspectorButton.title = 'Tool inspector'; inspectorButton.innerHTML = ic('layers', 18);
  if (cluster) cluster.insertBefore(inspectorButton, cluster.firstChild);
  const toolsButton = document.createElement('button');
  toolsButton.type = 'button'; toolsButton.id = 'studioToolsToggle'; toolsButton.className = 'studio-top-action studio-tools-toggle';
  toolsButton.textContent = 'Tools'; toolsButton.setAttribute('aria-expanded', 'false');
  if (topbar) topbar.appendChild(toolsButton);

  /* ---- account access: guests can reach Sign up, signed-in users get their initial ---- */
  (function () {
    if (!cluster) return;
    const a = document.createElement('a'); a.className = 'studio-account'; a.id = 'studioAccount'; a.href = 'auth.html?next=studio.html'; a.hidden = true;
    cluster.insertBefore(a, cluster.querySelector('#settingsIconLink') || null);
    const auth = window.VS && window.VS.auth; if (!auth || !auth.getCurrentUser) return;
    auth.getCurrentUser().then((u) => {
      if (!u) return;
      if (u.guest) { a.classList.add('is-guest'); a.innerHTML = ic('user', 16) + '<span class="acct-label">Sign up</span>'; a.title = 'Create an account to keep your work on any device'; a.setAttribute('aria-label', 'Create an account'); }
      else { a.classList.add('is-user'); a.href = 'settings.html'; a.textContent = (u.name || u.email || '?').trim().charAt(0).toUpperCase(); a.title = u.email || u.name || 'Account'; a.setAttribute('aria-label', 'Account and settings'); }
      a.hidden = false;
    }).catch(() => {});
  })();

  const panelHead = document.createElement('div'); panelHead.className = 'insp-head';
  panelHead.innerHTML = '<b id="inspTitle">Scene</b><button type="button" id="inspClose" aria-label="Close tool inspector">' + ic('close', 18) + '</button>';
  if (panel) panel.insertBefore(panelHead, panel.firstChild);
  const scrim = document.createElement('div'); scrim.className = 'studio-scrim'; scrim.hidden = true; document.body.appendChild(scrim);
  let lastTab = null;
  let mode = 'setup';
  let inspectorWasOpenBeforeLive = false;
  let editCardOpen = false;

  function activeTab() { return rail && (rail.querySelector('.tool-tab.active') || rail.querySelector('.tool-tab')); }
  function titleOf(tab) { const label = tab && tab.querySelector('.tab-label'); return label ? label.textContent.trim() : 'Tools'; }
  function syncInspector() {
    const open = phone.matches ? shell.classList.contains('sheet-open') : !shell.classList.contains('insp-closed');
    inspectorButton.setAttribute('aria-pressed', String(open));
    toolsButton.setAttribute('aria-expanded', String(open));
  }
  function setPanelSemantics(tab) {
    if (!panel) return;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', titleOf(tab));
    const title = $('inspTitle'); if (title) title.textContent = titleOf(tab);
  }
  function clearPanelSemantics() {
    if (!panel) return;
    panel.removeAttribute('role'); panel.removeAttribute('aria-modal'); panel.removeAttribute('aria-label');
  }
  function openPhoneSheet(tab) {
    lastTab = tab || lastTab || activeTab();
    shell.classList.add('sheet-open'); scrim.hidden = false; setPanelSemantics(lastTab); syncInspector();
    const close = $('inspClose'); if (close) close.focus({ preventScroll: true });
  }
  function closePhoneSheet() {
    shell.classList.remove('sheet-open'); scrim.hidden = true; clearPanelSemantics(); syncInspector();
    if (lastTab) lastTab.focus({ preventScroll: true });
  }
  function openTabletDrawer(tab) {
    lastTab = tab || lastTab || activeTab();
    shell.classList.remove('insp-closed'); scrim.hidden = false; setPanelSemantics(lastTab); LS.set('g_studio_insp', 'open'); syncInspector();
    const close = $('inspClose'); if (close) close.focus({ preventScroll: true });
  }
  function closeTabletDrawer() {
    shell.classList.add('insp-closed'); scrim.hidden = true; clearPanelSemantics(); syncInspector();
    if (lastTab) lastTab.focus({ preventScroll: true });
    LS.set('g_studio_insp', 'closed');
  }
  function selectTool(target) {
    const tab = rail && rail.querySelector('.tool-tab[data-target="' + target + '"]');
    if (tab) tab.click();
  }

  /* ---- mode transitions ---- */
  function setMode(next) {
    if (!labels[next]) return;
    if (next === mode) { if (next === 'edit') selectTool('panel-recordings'); return; }
    const previous = mode;
    mode = next; shell.dataset.mode = next; chip.textContent = labels[next];
    modeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.studioMode === next)));

    if (next === 'live') {
      inspectorWasOpenBeforeLive = !shell.classList.contains('insp-closed');
      selectTool('panel-camera');
      if (phone.matches && shell.classList.contains('sheet-open')) closePhoneSheet();
      else if (tablet.matches && !shell.classList.contains('insp-closed')) closeTabletDrawer();
      else if (!phone.matches) { shell.classList.add('insp-closed'); scrim.hidden = true; clearPanelSemantics(); LS.set('g_studio_insp', 'closed'); syncInspector(); }
    } else if (previous === 'live' && inspectorWasOpenBeforeLive && !phone.matches) {
      if (tablet.matches) openTabletDrawer(activeTab());
      else { shell.classList.remove('insp-closed'); LS.set('g_studio_insp', 'open'); syncInspector(); }
    }

    if (next === 'setup') selectTool('panel-env');
    if (next === 'edit') selectTool('panel-recordings');
  }
  shell.dataset.mode = 'setup'; chip.textContent = labels.setup;
  modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.studioMode)));
  window.addEventListener('vs:recording-started', () => setMode('live'));
  window.addEventListener('vs:recording-saved', () => { editCardOpen = true; setMode('edit'); });
  if (frame && window.MutationObserver) new MutationObserver(() => {
    if (mode === 'edit' && editCardOpen && !frame.querySelector('.ux-done')) { editCardOpen = false; setMode('setup'); }
  }).observe(frame, { childList: true });

  /* ---- restore desktop preference without overriding the phone/tablet layout ---- */
  const savedInspector = LS.get('g_studio_insp');
  if (!phone.matches && savedInspector === 'closed') shell.classList.add('insp-closed');
  if (tablet.matches && savedInspector !== 'open') shell.classList.add('insp-closed');
  if (tablet.matches && !shell.classList.contains('insp-closed')) openTabletDrawer(activeTab());
  syncInspector();
  inspectorButton.addEventListener('click', () => {
    shell.classList.toggle('insp-closed');
    LS.set('g_studio_insp', shell.classList.contains('insp-closed') ? 'closed' : 'open');
    syncInspector();
  });

  if (rail) rail.addEventListener('click', (event) => {
    const tab = event.target.closest('.tool-tab'); if (!tab) return;
    lastTab = tab;
    if (phone.matches) openPhoneSheet(tab);
    else if (tablet.matches) openTabletDrawer(tab);
    else if (shell.classList.contains('insp-closed')) { shell.classList.remove('insp-closed'); LS.set('g_studio_insp', 'open'); syncInspector(); }
  });
  toolsButton.addEventListener('click', () => {
    const tab = activeTab();
    if (phone.matches) {
      if (shell.classList.contains('sheet-open')) closePhoneSheet(); else openPhoneSheet(tab);
    } else if (tablet.matches) {
      if (shell.classList.contains('insp-closed')) openTabletDrawer(tab); else closeTabletDrawer();
    } else {
      shell.classList.toggle('insp-closed');
      LS.set('g_studio_insp', shell.classList.contains('insp-closed') ? 'closed' : 'open');
      syncInspector();
    }
  });
  $('inspClose').addEventListener('click', () => { if (phone.matches) closePhoneSheet(); else if (tablet.matches) closeTabletDrawer(); });
  scrim.addEventListener('click', () => { if (phone.matches) closePhoneSheet(); else if (tablet.matches) closeTabletDrawer(); });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (phone.matches && shell.classList.contains('sheet-open')) { event.stopPropagation(); closePhoneSheet(); }
    else if (tablet.matches && !shell.classList.contains('insp-closed')) { event.stopPropagation(); closeTabletDrawer(); }
  }, true);
  const onBreakpointChange = () => {
    shell.classList.remove('sheet-open'); scrim.hidden = true; clearPanelSemantics(); syncInspector();
  };
  if (phone.addEventListener) phone.addEventListener('change', onBreakpointChange);
  if (tablet.addEventListener) tablet.addEventListener('change', onBreakpointChange);

  /* ---- honest camera control: no disabled Stop Camera while camera is off ---- */
  const left = document.querySelector('.transport-left'), stopButton = $('stopBtn'), startButton = $('startBtn');
  const dockStart = document.createElement('button'); dockStart.type = 'button'; dockStart.id = 'dockStart'; dockStart.className = 'btn ghost sm';
  dockStart.innerHTML = '<span>' + ic('video', 15) + '</span><span class="btn-label">Start camera</span>';
  if (left) left.insertBefore(dockStart, left.firstChild);
  dockStart.setAttribute('aria-label', 'Start camera');
  [['transportLiveBtn', 'Go live'], ['focusModeBtn', 'Focus mode']].forEach(([id, text]) => { const button = $(id); if (button && !button.getAttribute('aria-label')) button.setAttribute('aria-label', text); });
  dockStart.addEventListener('click', () => { if (startButton) startButton.click(); });
  const status = $('transportStatus');
  function cameraState() { const text = status ? status.textContent || '' : ''; return /previewing|recording/i.test(text) ? 'on' : /starting|loading|connect/i.test(text) ? 'busy' : 'off'; }
  function syncCamera() { const state = cameraState(); shell.dataset.cam = state; dockStart.disabled = state === 'busy'; }
  if (status && window.MutationObserver) new MutationObserver(syncCamera).observe(status, { childList: true, characterData: true, subtree: true });
  setInterval(syncCamera, 1500); syncCamera();
})();
