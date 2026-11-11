/* First-run welcome on Home (Constitution journey A). Shows once, until "Explore first" or "Set up my studio" is chosen. */
(function () {
  'use strict';
  const KEY = 'g_onboarded';
  try { if (localStorage.getItem(KEY) === '1') return; } catch (e) {}
  function mount() {
    const main = document.getElementById('mainContent');
    if (!main || document.getElementById('welcomeCard')) return;
    const card = document.createElement('section');
    card.id = 'welcomeCard'; card.className = 'g-welcome'; card.setAttribute('role', 'note'); card.setAttribute('aria-label', 'Privacy note');
    card.innerHTML = '<p><b>Private by default.</b> Camera and mic start only when you press Start camera. Nothing is uploaded unless you go live.</p>' +
      '<button type="button" class="g-btn g-btn--secondary" id="frExplore">Got it</button>';
    main.insertBefore(card, main.firstChild);
    const done = () => { try { localStorage.setItem(KEY, '1'); } catch (e) {} };
    card.querySelector('#frExplore').addEventListener('click', () => { done(); card.remove(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
