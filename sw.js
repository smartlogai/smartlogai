const CACHE_NAME = 'smartlog-mobile-approval-v2';
const STATIC_ASSETS = [
  './',
  './main.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/approval.js',
  './js/mobile-approval.js',
  './js/main.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : Promise.resolve())))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/rest/v1/') || url.pathname.includes('/storage/v1/')) return;

  const isStatic = /\.(css|js|html|ico|png|jpg|jpeg|svg|webp)$/i.test(url.pathname) || url.pathname === '/' || url.pathname.endsWith('/main.html');
  if (!isStatic) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (!res || res.status !== 200) return res;
        const cloned = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, cloned)).catch(() => {});
        return res;
      });
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const title = String(payload.title || 'Smart Log AI');
  const body = String(payload.body || '새 알림이 도착했습니다.');
  const url = String(payload.url || './main.html');
  const tag = String(payload.tag || 'smartlog-notification');
  const options = {
    body,
    tag,
    icon: './favicon.ico',
    badge: './favicon.ico',
    data: {
      url,
      target_menu: String(payload.target_menu || ''),
      entry_id: String(payload.entry_id || ''),
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification && event.notification.data && event.notification.data.url)
    ? String(event.notification.data.url)
    : './main.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({
            type: 'smartlog-notification-click',
            target_menu: event.notification?.data?.target_menu || '',
            entry_id: event.notification?.data?.entry_id || '',
          });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
      return Promise.resolve();
    })
  );
});
