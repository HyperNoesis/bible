/**
 * Picks the real auth backend based on js/config.js. This is the only file
 * that decides local-vs-cloud — every page just calls window.VS.auth.*
 * the same way regardless of which one is active.
 */
(function () {
  const cfg = window.VS && window.VS.config;
  const useSupabase = cfg && cfg.supabaseUrl && cfg.supabaseAnonKey;

  const provider = useSupabase
    ? new window.VS.SupabaseAuthProvider(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : new window.VS.LocalAuthProvider();

  // Guest mode (v0.65): lets someone use Studio with no account. Nothing is sent anywhere;
  // work stays on this device. Entered only by an explicit action or the landing page's ?guest=1 link.
  const GUEST_KEY = 'vs_guest';
  const isGuestFlag = () => { try { return localStorage.getItem(GUEST_KEY) === '1'; } catch (e) { return false; } };
  async function getCurrentUser() {
    const u = await provider.getCurrentUser();
    if (u) return u;
    return isGuestFlag() ? { name: 'Guest', email: '', guest: true } : null;
  }
  function continueAsGuest() { try { localStorage.setItem(GUEST_KEY, '1'); } catch (e) {} }
  async function requireAuth(redirectTo = 'auth.html') {
    if (!isGuestFlag() && /[?&]guest=1\b/.test(location.search) && !(await provider.getCurrentUser())) continueAsGuest();
    const user = await getCurrentUser();
    if (!user) {
      window.location.href = redirectTo;
      return null;
    }
    return user;
  }

  window.VS = window.VS || {};
  window.VS.auth = {
    signUp: async (...a) => { const r = await provider.signUp(...a); try { localStorage.removeItem(GUEST_KEY); } catch (e) {} return r; },
    signIn: async (...a) => { const r = await provider.signIn(...a); try { localStorage.removeItem(GUEST_KEY); } catch (e) {} return r; },
    signOut: async (...a) => { try { localStorage.removeItem(GUEST_KEY); } catch (e) {} return provider.signOut(...a); },
    getCurrentUser,
    continueAsGuest,
    isGuest: isGuestFlag,
    updateProfile: (...a) => provider.updateProfile(...a),
    updatePassword: (...a) => provider.updatePassword(...a),
    resetPassword: (...a) => provider.resetPassword(...a),
    deleteAccount: (...a) => provider.deleteAccount(...a),
    requireAuth,
    mode: useSupabase ? 'supabase' : 'local'
  };
})();
