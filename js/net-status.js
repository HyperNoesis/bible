/** App-wide connection status (constitution 12.15). Calm, persistent, honest: Genesis works on this device; only cloud-backed
 *  features (live calls, going live, AI scenes, cloud accounts) need a connection. Appears only while offline; never blocks the page. */
(function () {
  'use strict';
  let bar;
  function ensure() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'g-offline'; bar.setAttribute('role', 'status'); bar.hidden = true;
    bar.innerHTML = '<b>You are offline.</b> <span>Studio and your recordings still work on this device. Going live, calls and AI scenes wait until you are back online.</span>';
    const st = document.createElement('style');
    st.textContent = '.g-offline{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:900;max-width:min(560px,calc(100vw - 24px));padding:10px 16px;border-radius:12px;background:#1D2A3A;color:#F5F7FB;border:1px solid #F4C06A;font:400 13px/1.45 ui-sans-serif,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)}.g-offline b{color:#F4C06A;font-weight:600}.g-offline[hidden]{display:none}';
    document.head.appendChild(st); document.body.appendChild(bar); return bar;
  }
  function sync() { ensure().hidden = navigator.onLine !== false; }
  window.addEventListener('online', sync); window.addEventListener('offline', sync);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();
  window.VS = window.VS || {}; window.VS.netStatus = { isOnline: () => navigator.onLine !== false };
})();
