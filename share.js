'use strict';
// Install prompt and "share to Story HD" intake (see sw.js).

const SHARE_CACHE = 'shared-media';

function toast(text) {
  const note = $('toast');
  note.textContent = text;
  note.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { note.hidden = true; }, 4500);
}

async function takeSharedMedia() {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared')) return;
  history.replaceState(null, '', location.pathname);
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const res = await cache.match('shared-file');
    if (!res) {
      toast('Tidak ada file yang diterima. Coba bagikan lagi.');
      return;
    }
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('X-File-Name') || 'media');
    await cache.delete('shared-file');
    const type = blob.type || res.headers.get('Content-Type') || '';
    setMedia(new File([blob], name, { type }));
    if (state.media) {
      toast('Video diterima. Efek Jernih HD sudah aktif, tinggal ketuk Proses.');
      $('settings').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    console.error(err);
    toast('File yang dibagikan gagal dibuka. Pilih manual lewat langkah 1.');
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => {
    // The very first visit is not yet served through the worker, so it lacks
    // the isolation headers. Reload once to pick up the fast engine.
    navigator.serviceWorker.ready.then(() => {
      let tried = false;
      try { tried = sessionStorage.getItem('coi-reload') === '1'; } catch (_) { /* storage blocked */ }
      if (window.crossOriginIsolated || tried || state.media) return;
      try { sessionStorage.setItem('coi-reload', '1'); } catch (_) { return; }
      location.reload();
    });
  }).catch((err) => console.error(err));
  // An updated worker taking over mid-visit: reload so its headers apply.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!window.crossOriginIsolated && !state.media && !state.busy) location.reload();
  });
}
takeSharedMedia();

/* ---- install ---- */

let installEvent = null;
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function syncInstallUi() {
  $('installBtn').hidden = !installEvent || standalone;
  $('installDone').hidden = !standalone;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  syncInstallUi();
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  $('installBtn').hidden = true;
  toast('Terpasang. Sekarang Story HD muncul di menu Bagikan.');
});
$('installBtn').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => {});
  installEvent = null;
  syncInstallUi();
});
syncInstallUi();
