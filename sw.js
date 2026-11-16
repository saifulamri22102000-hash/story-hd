// Service worker with one job: receive a photo or video shared from another
// app (CapCut, gallery, ...) through the Android share sheet and hand it to
// the page. Nothing else is intercepted, so the site always loads fresh.

const SHARE_CACHE = 'shared-media';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const file = form.get('media');
      if (file && file.size) {
        const cache = await caches.open(SHARE_CACHE);
        await cache.put('shared-file', new Response(file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name || 'media'),
          },
        }));
      }
    } catch (err) {
      console.error('share-target', err);
    }
    return Response.redirect('./?shared=1', 303);
  })());
});
