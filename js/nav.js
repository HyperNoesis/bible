(function () {
  // Register the service worker once per page load, on every screen that
  // loads nav.js. Feature-detected, so browsers/contexts without SW
  // support (or plain http:// during local dev) just skip it silently.
  //
  // updateViaCache: 'none' is load-bearing, not decorative — without it,
  // the browser's own HTTP cache can decide whether to even check for a
  // new sw.js, so bumping SHELL_CACHE in sw.js is not guaranteed to reach
  // an existing visitor on its own. This forces every registration check
  // to fetch sw.js fresh over the network.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch((err) => {
        console.warn('Genesis: service worker registration failed', err);
      });
    });

    // Once a new service worker takes over (after skipWaiting +
    // clients.claim in sw.js), reload once so every open tab actually
    // gets the new shell instead of continuing to run old cached JS
    // against a page that already updated underneath it.
    let refreshedOnce = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshedOnce) return;
      refreshedOnce = true;
      window.location.reload();
    });
  }

  // Pages are still dark-only until they are migrated; keep the shell on the dark tokens so nothing is half-themed.
  document.documentElement.setAttribute('data-theme', 'dark');

  const LINKS = [
    { id: 'home', href: 'home.html', label: 'Home', icon: 'home' },
    { id: 'studio', href: 'studio.html', label: 'Studio', icon: 'studio', group: 'Create' },
    { id: 'call', href: 'call.html', label: 'Live Call', icon: 'users', group: 'Create' },
    { id: 'environments', href: 'environments.html', label: 'Environments', icon: 'environments', group: 'Library' },
    { id: 'projects', href: 'projects.html', label: 'Projects', icon: 'projects', group: 'Library' },
    { id: 'editor', href: 'editor.html', label: 'Editor', icon: 'layers', group: 'Craft' },
    { id: 'audio', href: 'audio.html', label: 'Audio', icon: 'audio', group: 'Craft' },
    { id: 'settings', href: 'settings.html', label: 'Settings', icon: 'settings', group: 'Account' },
  ];

  const CMDK_ACTIONS = [
    { label: 'Open Studio', icon: 'studio', href: 'studio.html' },
    { label: 'Start camera in Studio', icon: 'video', href: 'studio.html?action=start' },
    { label: 'Start a live call', icon: 'users', href: 'call.html' },
    { label: 'Choose an environment', icon: 'environments', href: 'environments.html' },
    { label: 'Open Editor', icon: 'layers', href: 'editor.html' },
    { label: 'Open Audio Studio', icon: 'audio', href: 'audio.html' },
    { label: 'Open Projects', icon: 'projects', href: 'projects.html' },
    { label: 'Open Settings', icon: 'settings', href: 'settings.html' },
    { label: 'Enter Focus mode', icon: 'maximize', href: 'studio.html?action=focus' },
    { label: 'Go home', icon: 'home', href: 'home.html' },
  ];

  const initial = (user) => String((user && user.name) || '?').charAt(0).toUpperCase();
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pageLabel = (id) => (LINKS.find(l => l.id === id) || { label: 'Genesis' }).label;

  // Profile menu shared by desktop top bar and mobile top bar. Settings, account and sign-out live here.
  function buildProfileMenu(user, suffix) {
    const ic = window.VS.icon;
    const guest = !!user.guest;
    return `
      <div class="g-profile">
        <button type="button" class="g-avatar-btn" id="profileBtn${suffix}" aria-label="Account menu for ${esc(user.name)}" aria-haspopup="menu" aria-expanded="false" aria-controls="profileMenu${suffix}">${esc(initial(user))}</button>
        <div class="g-pmenu" id="profileMenu${suffix}" role="menu" aria-label="Account" hidden>
          <div class="g-pmenu-head"><b>${esc(user.name)}</b><small>${guest ? 'Saved on this device only' : esc(user.email || '')}</small></div>
          <button role="menuitem" type="button" data-appearance>${ic('palette', 16)}<span>Appearance</span></button>
          <a role="menuitem" href="settings.html">${ic('settings', 16)}<span>Settings</span></a>
          ${guest ? `<a role="menuitem" href="auth.html?next=${encodeURIComponent((location.pathname.split('/').pop() || 'home.html'))}">${ic('user', 16)}<span>Create an account</span></a>` : ''}
          <button role="menuitem" type="button" data-signout>${ic('logout', 16)}<span>${guest ? 'Leave guest mode' : 'Sign out'}</span></button>
        </div>
      </div>`;
  }

  function buildSidebar(user, activePage) {
    const ic = window.VS.icon;
    const items = LINKS.filter(l => l.id !== 'settings');
    return `
      <div class="sidebar">
        <div class="sidebar-logo">
          <img src="assets/logo-mark.png" alt="" class="brand-mark">
          <div class="brand-text">
            <div class="brand-name">Genesis</div>
            <div class="brand-sub">by Rejuvini</div>
          </div>
        </div>
        <a class="sidebar-create" href="studio.html" aria-label="New recording in Studio"><span class="create-mark">${ic('plus', 16)}</span><span class="create-text"><b>New recording</b><small>Open the Studio</small></span></a>
        <nav aria-label="Primary">
          ${items.map((l, i) => `${l.group && l.group !== (items[i - 1] || {}).group ? `<div class="nav-group-label" aria-hidden="true">${l.group}</div>` : ''}
            <a class="nav-link ${l.id === activePage ? 'active' : ''}" href="${l.href}" data-label="${l.label}" ${l.id === activePage ? 'aria-current="page"' : ''}>
              ${ic(l.icon, 18)}<span class="nav-text">${l.label}</span>
            </a>`).join('')}
        </nav>
        <button type="button" class="sidebar-cmdk" id="openCmdk" aria-label="Open quick actions (Command K)">
          <span class="nav-text">Quick actions</span><span class="kbd nav-text">Ctrl K</span>
        </button>
        <button type="button" class="rail-toggle" id="railToggle" aria-pressed="false" aria-label="Collapse navigation">
          ${ic('minimize', 16)}<span class="nav-text">Collapse</span>
        </button>
      </div>
    `;
  }

  function buildTopbar(user, activePage) {
    const ic = window.VS.icon;
    return `
      <header class="g-topbar" id="gTopbar">
        <div class="g-topbar-title"><span>${esc(pageLabel(activePage))}</span></div>
        <div class="g-topbar-actions">
          <button type="button" class="g-topbtn" id="openCmdkTop" aria-label="Open quick actions (Command K)">${ic('search', 16)}<span>Search and actions</span><span class="kbd">Ctrl K</span></button>
          ${buildProfileMenu(user, 'D')}
        </div>
      </header>`;
  }

  function buildMobileTopbar(user) {
    const ic = window.VS.icon;
    return `
      <div class="mobile-topbar">
        <div class="brand-mini">
          <img src="assets/logo-mark.png" alt="">
          <span>Genesis</span>
        </div>
        <div class="g-topbar-actions">
          <button class="g-iconbtn-sm" id="openCmdkMobile" aria-label="Open quick actions">${ic('search', 18)}</button>
          ${buildProfileMenu(user, 'M')}
        </div>
      </div>
    `;
  }

  function buildBottomTabbar(activePage) {
    const ic = window.VS.icon;
    const tab = (id) => LINKS.find(l => l.id === id);
    const item = (l) => `<a class="${l.id === activePage ? 'active' : ''}" href="${l.href}" ${l.id === activePage ? 'aria-current="page"' : ''}>${ic(l.icon, 22)}<span>${l.label}</span></a>`;
    const moreIds = ['call', 'editor', 'audio', 'settings'];
    const moreActive = moreIds.includes(activePage);
    return `
      <nav class="bottom-tabbar" aria-label="Primary">
        ${item(tab('home'))}${item(tab('environments'))}
        <a class="tab-create ${activePage === 'studio' ? 'active' : ''}" href="studio.html" aria-label="Open Studio" ${activePage === 'studio' ? 'aria-current="page"' : ''}><span class="tc-orb">${ic('studio', 24)}</span><span class="tc-label">Studio</span></a>
        ${item(tab('projects'))}
        <button type="button" class="tab-more ${moreActive ? 'active' : ''}" id="openMore" aria-haspopup="dialog" aria-label="More: Live Call, Editor, Audio, Settings">${ic('more', 22)}<span>More</span></button>
      </nav>
      <div class="more-sheet" id="moreSheet" role="dialog" aria-modal="true" aria-label="More">
        <div class="ms-box">
          <div class="ms-grip"></div>
          <div class="ms-title">More</div>
          <div class="ms-list">${moreIds.map(id => { const l = tab(id); return `<a href="${l.href}" class="${l.id === activePage ? 'active' : ''}">${ic(l.icon, 20)}<span>${l.label}</span></a>`; }).join('')}</div>
          <button type="button" class="btn ghost ms-signout" id="moreSignOut">Sign out</button>
        </div>
      </div>
    `;
  }

  function buildCmdk() {
    const ic = window.VS.icon;
    return `
      <div class="cmdk-overlay" id="cmdkOverlay" role="dialog" aria-modal="true" aria-label="Quick actions">
        <div class="cmdk-box">
          <div class="cmdk-input-row">
            ${ic('search', 17)}
            <input type="text" id="cmdkInput" placeholder="Jump to a screen or action..." aria-label="Jump to a screen or action" role="combobox" aria-expanded="true" aria-controls="cmdkList">
          </div>
          <div class="cmdk-list" id="cmdkList" role="listbox"></div>
        </div>
      </div>
    `;
  }

  function wireCmdk(user) {
    const overlay = document.getElementById('cmdkOverlay');
    const input = document.getElementById('cmdkInput');
    const list = document.getElementById('cmdkList');
    if (!overlay) return;

    function renderList(query) {
      const q = (query || '').toLowerCase();
      const items = CMDK_ACTIONS.filter(a => a.label.toLowerCase().includes(q));
      if (items.length === 0) {
        list.innerHTML = `<div class="cmdk-empty">No matches. Try "studio" or "settings".</div>`;
        return;
      }
      list.innerHTML = items.map((a, i) => `
        <div class="cmdk-item ${i === 0 ? 'active' : ''}" data-href="${a.href}">
          ${window.VS.icon(a.icon, 16)}<span>${a.label}</span>
        </div>
      `).join('');
      list.querySelectorAll('.cmdk-item').forEach(el => {
        el.addEventListener('click', () => { window.location.href = el.dataset.href; });
        el.addEventListener('mouseenter', () => {
          list.querySelectorAll('.cmdk-item').forEach(x => x.classList.remove('active'));
          el.classList.add('active');
        });
      });
    }

    function open() {
      overlay.classList.add('open');
      input.value = '';
      renderList('');
      setTimeout(() => input.focus(), 30);
    }
    function close() { overlay.classList.remove('open'); }

    ['openCmdk', 'openCmdkTop', 'openCmdkMobile'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', open);
        btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      }
    });

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    input.addEventListener('input', () => renderList(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') {
        const active = list.querySelector('.cmdk-item.active') || list.querySelector('.cmdk-item');
        if (active) window.location.href = active.dataset.href;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = Array.from(list.querySelectorAll('.cmdk-item'));
        if (!items.length) return;
        let idx = items.findIndex(i => i.classList.contains('active'));
        items[idx]?.classList.remove('active');
        idx = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
        items[idx].classList.add('active');
      }
    });

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        overlay.classList.contains('open') ? close() : open();
      }
    });

  }

  function wireRail(shell) {
    const btn = document.getElementById('railToggle');
    if (!shell || !btn) return;
    const apply = (collapsed) => {
      shell.classList.toggle('rail', collapsed);
      btn.setAttribute('aria-pressed', String(collapsed));
      btn.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
    };
    let saved = false;
    try { saved = localStorage.getItem('g_rail') === '1'; } catch (e) {}
    apply(saved);
    btn.addEventListener('click', () => {
      const next = !shell.classList.contains('rail');
      apply(next);
      try { localStorage.setItem('g_rail', next ? '1' : '0'); } catch (e) {}
    });
  }

  function wireProfileMenus() {
    ['D', 'M'].forEach((sfx) => {
      const btn = document.getElementById('profileBtn' + sfx);
      const pop = document.getElementById('profileMenu' + sfx);
      if (!btn || !pop) return;
      const items = () => Array.from(pop.querySelectorAll('[role="menuitem"]'));
      const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
      const open = () => { pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); const f = items()[0]; if (f) f.focus(); };
      btn.addEventListener('click', () => (pop.hidden ? open() : close()));
      pop.addEventListener('keydown', (e) => {
        const list = items(), i = list.indexOf(document.activeElement);
        if (e.key === 'Escape') { close(); btn.focus(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
        else if (e.key === 'Tab') close();
      });
      document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) close(); });
      const ap = pop.querySelector('[data-appearance]');
      if (ap) ap.addEventListener('click', () => { close(); if (window.VS.openAppearance) window.VS.openAppearance(); });
      const so = pop.querySelector('[data-signout]');
      if (so) so.addEventListener('click', async () => { await window.VS.auth.signOut(); window.location.href = 'auth.html'; });
    });
  }

  /**
   * Renders the sidebar/mobile nav AND gates the page: awaits the current
   * user, redirects to auth.html if there isn't one, and returns the
   * resolved user so the calling page can use it without a second check.
   */
  async function renderNav(activePage) {
    const user = await window.VS.auth.requireAuth();
    if (!user) return null;

    const root = document.getElementById('nav-root');
    root.innerHTML =
      buildMobileTopbar(user) +
      buildSidebar(user, activePage) +
      buildBottomTabbar(activePage) +
      buildCmdk();

    // Desktop top bar becomes a direct child of the app shell so it sits above the page content.
    const shell = root.closest('.app-shell');
    const main = document.getElementById('mainContent');
    if (shell && main) {
      shell.classList.add('has-g-shell');
      main.insertAdjacentHTML('beforebegin', buildTopbar(user, activePage));
    }
    wireRail(shell);
    wireProfileMenus();

    wireCmdk(user);

    const sheet = document.getElementById('moreSheet');
    const openMore = document.getElementById('openMore');
    if (sheet && openMore) {
      const closeSheet = () => { sheet.classList.remove('open'); openMore.focus(); };
      openMore.addEventListener('click', () => { sheet.classList.add('open'); const f = sheet.querySelector('a'); if (f) f.focus(); });
      sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.classList.contains('open')) closeSheet(); });
      const so = document.getElementById('moreSignOut');
      if (so) so.addEventListener('click', async () => { await window.VS.auth.signOut(); window.location.href = 'auth.html'; });
    }
    return user;
  }

  window.VS = window.VS || {};
  window.VS.renderNav = renderNav;
})();
