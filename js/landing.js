/** Landing page glue: before/after slider (only if real pictures exist), scene thumbnails, pilot request (mailto / WhatsApp, no server), optional pay link. */
(function () {
  const $ = (id) => document.getElementById(id), cfg = () => (window.VS && window.VS.config) || {}, biz = () => cfg().business || {};
  /** Build the pilot message and the contact link. Pure: returns {text, href|null, how}. */
  function pilotMessage(f, b) {
    const clean = (s, n) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);
    const text = 'Genesis pilot request\nName: ' + clean(f.name, 80) + '\nUse: ' + clean(f.use, 60) + '\nPhone: ' + clean(f.phone, 60) + '\nNote: ' + clean(f.note, 400);
    const email = clean(b && b.email, 120), wa = String((b && b.whatsapp) || '').replace(/[^\d]/g, '');
    if (wa.length >= 8) return { text, href: 'https://wa.me/' + wa + '?text=' + encodeURIComponent(text), how: 'WhatsApp' };
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { text, href: 'mailto:' + email + '?subject=' + encodeURIComponent('Genesis pilot request') + '&body=' + encodeURIComponent(text), how: 'email' };
    return { text, href: null, how: '' };
  }
  window.VS = window.VS || {}; window.VS.Landing = { pilotMessage };
  /** Curated rooms: real shipped scene files only. id matches studio.html?env=. */
  const ROOMS = [
    { id: 'scene-premium-podcast', file: 'podcast', name: 'Premium Podcast', use: 'A warm set for interviews and podcasts.' },
    { id: 'scene-premium-talkshow', file: 'talkshow', name: 'Talk Show Set', use: 'A lively desk for conversations and shows.' },
    { id: 'scene-premium-classroom', file: 'classroom', name: 'Modern Classroom', use: 'A bright room for lessons and training.' },
    { id: 'scene-premium-library', file: 'library', name: 'Luxury Library', use: 'A calm, book-lined space for talks and reviews.' },
    { id: 'scene-premium-tech', file: 'tech', name: 'Tech Review Studio', use: 'A cool-toned desk for product and tech videos.' },
    { id: 'scene-premium-terrace', file: 'terrace', name: 'Outdoor Terrace', use: 'An open-air setting for relaxed updates.' }
  ];
  const img = (r) => 'assets/environments/scene-premium-' + r.file + '.jpg';
  const studioHref = (r) => 'studio.html?guest=1' + (r ? '&env=' + encodeURIComponent(r.id) : '');
  function init() {
    // header border once scrolled
    const top = $('lpTop'); if (top) { const f = () => top.classList.toggle('is-scrolled', window.scrollY > 8); f(); addEventListener('scroll', f, { passive: true }); }
    // hero stage: preview a room (no auto-rotation; the visitor chooses)
    const stage = $('lpStageImg'), picks = $('lpPicks'); let sel = 0, tok = 0;
    const opens = Array.from(document.querySelectorAll('[data-open-studio]'));
    function show(i, userInitiated) {
      sel = i; const r = ROOMS[i];
      Array.from(picks.children).forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
      $('lpSceneName').textContent = r.name; $('lpSceneUse').textContent = r.use;
      stage.setAttribute('aria-label', r.name + ', ' + r.use.charAt(0).toLowerCase() + r.use.slice(1));
      const my = ++tok, im = new Image();
      im.onload = () => { if (my !== tok) return; stage.classList.add('is-swap'); setTimeout(() => { if (my !== tok) return; stage.style.backgroundImage = 'url(' + im.src + ')'; stage.classList.remove('is-swap'); }, 120); };
      im.onerror = () => {}; im.src = img(r);
      if (userInitiated) { const h = $('heroOpen'); if (h) { h.href = studioHref(r); h.textContent = 'Open Studio with ' + r.name; } }
    }
    if (picks) ROOMS.forEach((r, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'lp-pick'; b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
      b.setAttribute('aria-label', 'Preview ' + r.name); b.title = r.name; b.innerHTML = '<i style="background-image:url(' + img(r) + ')"></i>';
      b.addEventListener('click', () => show(i, true)); picks.appendChild(b);
    });
    // rooms gallery
    const grid = $('lpRooms');
    if (grid) ROOMS.forEach((r) => {
      const li = document.createElement('li'); li.className = 'lp-room';
      li.innerHTML = '<a href="' + studioHref(r) + '"><span class="im"><img loading="lazy" decoding="async" width="640" height="400" alt="' + r.name + '" src="' + img(r) + '"></span><span><b>' + r.name + '</b><span class="u">' + r.use + '</span><span class="go">Open Studio with this room</span></span></a>';
      grid.appendChild(li);
    });
    const probe = pilotMessage({}, biz()), form = $('pilotForm');
    if (probe.href) { form.hidden = false; $('pHow').textContent = 'This opens ' + probe.how + ' with your message ready to send. Nothing is stored by this page.'; } else $('pilotOff').hidden = false;
    form.addEventListener('submit', (e) => { e.preventDefault(); const m = pilotMessage({ name: $('pName').value, use: $('pUse').value, phone: $('pPhone').value, note: $('pNote').value }, biz()); if (m.href) location.href = m.href; });
    const pay = (cfg().payLinks || {}).pro; if (pay && /^https:\/\//.test(pay)) { const p = $('payBtn'); p.href = pay; p.hidden = false; p.rel = 'noopener'; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
