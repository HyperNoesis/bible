/* Genesis design-system helpers (Phase 1): theme, toast, accessible menu, dialog opener. Presentation only. */
(function () {
  'use strict';
  const KEY = 'g_theme';
  function applyTheme(t) { const r = document.documentElement; if (t === 'light' || t === 'dark') r.setAttribute('data-theme', t); else r.setAttribute('data-theme', 'dark'); /* v0.70: dark is the only complete theme; never fall through to a half-themed light screen */ }
  function getTheme() { try { return localStorage.getItem(KEY) || 'system'; } catch (e) { return 'system'; } }
  function setTheme(t) { try { if (t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch (e) {} applyTheme(t); }
  applyTheme(getTheme());
  function toast(msg, ms) {
    let box = document.querySelector('.g-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'g-toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'g-toast'; t.textContent = msg; box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.remove(), ms || 5000);
  }
  /* Menu: trigger button + [hidden] .g-pop. Escape and outside click close; focus returns to trigger. */
  function menu(trigger, pop) {
    const items = () => [...pop.querySelectorAll('[role="menuitem"]')];
    const close = () => { pop.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
    const open = () => { pop.hidden = false; trigger.setAttribute('aria-expanded', 'true'); const f = items()[0]; if (f) f.focus(); };
    trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('click', () => (pop.hidden ? open() : close()));
    pop.addEventListener('keydown', (e) => {
      const list = items(), i = list.indexOf(document.activeElement);
      if (e.key === 'Escape') { close(); trigger.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
      else if (e.key === 'Tab') close();
    });
    document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== trigger && !trigger.contains(e.target)) close(); });
  }
  /* Dialog: native <dialog> gives focus trap + Escape; we restore focus to the opener. */
  function dialog(opener, dlg) {
    opener.addEventListener('click', () => dlg.showModal());
    dlg.addEventListener('close', () => opener.focus());
    dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dlg.close(b.dataset.close)));
  }
  window.VS = window.VS || {};
  window.VS.ds = { getTheme, setTheme, toast, menu, dialog };
})();
