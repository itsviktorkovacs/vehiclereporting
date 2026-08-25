// pwa-install.js — registers the service worker and drives the "install
// this app" UI on both platforms, since they behave completely differently:
//
// - Android/Chrome fires a `beforeinstallprompt` event we can hook a real
//   button up to (calling .prompt() opens the native install dialog).
// - iOS Safari never fires that event at all — there is no programmatic
//   "install" action available. The only way to install a PWA on iOS is the
//   user manually tapping Share → "Add to Home Screen", so the best we can
//   do is show a clear, dismissible instruction banner instead of a button.

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {
      // Not fatal — the app still works fully online without a service
      // worker, it just won't be installable/offline-capable.
    });
  });
}

function hoIsStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function hoIsIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
}

// ---- Android/Chrome: native install prompt ----
let hoDeferredInstallEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  hoDeferredInstallEvent = e;
  const btn = document.getElementById('pwaInstallBtn');
  if (btn && !hoIsStandalone()) btn.disabled = false;
});

document.addEventListener('DOMContentLoaded', () => {
  const installBtn = document.getElementById('pwaInstallBtn');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!hoDeferredInstallEvent) return;
      hoDeferredInstallEvent.prompt();
      await hoDeferredInstallEvent.userChoice;
      hoDeferredInstallEvent = null;
      installBtn.disabled = true;
    });
  }

  // ---- iOS Safari: show manual instructions (once per browser, dismissible) ----
  const banner = document.getElementById('iosInstallBanner');
  const closeBtn = document.getElementById('iosInstallBannerClose');
  if (banner && hoIsIos() && !hoIsStandalone() && localStorage.getItem('hoIosInstallBannerDismissed') !== '1') {
    banner.style.display = 'flex';
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      banner.style.display = 'none';
      localStorage.setItem('hoIosInstallBannerDismissed', '1');
    });
  }
});

window.addEventListener('appinstalled', () => {
  const btn = document.getElementById('pwaInstallBtn');
  if (btn) btn.disabled = true;
});
