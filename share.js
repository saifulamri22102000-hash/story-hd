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
  navigator.serviceWorker.register('sw.js').catch((err) => console.error(err));
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
