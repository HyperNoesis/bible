/* Developer pages are hidden from customers. Open any of them once with ?dev=1 (turn off with ?dev=0). */
(function () {
  try {
    if (/[?&]dev=0\b/.test(location.search)) localStorage.removeItem('g_dev');
    if (/[?&]dev=1\b/.test(location.search)) localStorage.setItem('g_dev', '1');
    if (localStorage.getItem('g_dev') === '1') return;
  } catch (e) {}
  location.replace('home.html');
})();
