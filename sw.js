/* local cache-reset service worker
 * 목적: 과거 빌드에서 남아있는 서비스워커 캐시를 즉시 비우고 스스로 해제.
 */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (_) {}
    try {
      await self.registration.unregister();
    } catch (_) {}
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach((c) => c.navigate(c.url));
    } catch (_) {}
  })());
});
