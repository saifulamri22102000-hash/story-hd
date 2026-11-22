// Service worker with two jobs:
//  1. Receive a photo or video shared from another app (CapCut, gallery, ...)
//     through the Android share sheet and hand it to the page.
//  2. Add cross-origin isolation headers to this site's own files. GitHub Pages
//     cannot send them, and they unlock SharedArrayBuffer, which the
//     multi-threaded video engine needs (several times faster export).
//     "credentialless" keeps third-party covers, previews and models working.

const SHARE_CACHE = 'shared-media';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function isolate(response) {
  // Opaque or redirected responses cannot be rebuilt; pass them through.
  if (!response || response.status === 0 || response.type === 'opaqueredirect') return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      try {
        const form = await req.formData();
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
    return;
  }

  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  event.respondWith(fetch(req).then(isolate));
});
