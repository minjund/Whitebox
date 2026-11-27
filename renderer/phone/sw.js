// Whitebox phone app: keeps the page's frame on the phone so the installed app
// opens at once, even when the computer cannot be reached. Conversations and
// every /api/ call always go to the computer and are never stored here.
// It also shows the computer's notifications (finished work, a question) and
// opens that chat when one is tapped.
const CACHE = 'whitebox-phone';
const SHELL = ['/', '/phone.css', '/phone.js', '/chat.css', '/chat-render.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icon.png'];
// A computer that is off does not answer at all over Tailscale; past this the stored frame is shown.
const WAIT_MS = 2500;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const key = request.mode === 'navigate' || url.pathname === '/index.html' ? '/' : url.pathname;
  if (!SHELL.includes(key)) return;
  event.respondWith(fresh(request, key));
});

// The computer's copy first, so an updated Whitebox shows its new page; the stored one when it does not answer in time.
async function fresh(request, key) {
  const cache = await caches.open(CACHE);
  // A navigation request cannot be re-sent with options, so ask for the same path anew.
  const network = fetch(key === '/' ? '/' : request.url, { cache: 'no-store' }).then(response => {
    if (response.ok) cache.put(key, response.clone()).catch(() => {});
    return response;
  });
  const stored = new Promise(resolve => setTimeout(() => resolve(cache.match(key)), WAIT_MS));
  try {
    const first = await Promise.race([network.catch(() => null), stored]);
    if (first) return first;
  } catch {}
  return (await cache.match(key)) || network;
}

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(self.registration.showNotification(String(data.title || 'Whitebox'), {
    body: String(data.body || ''), tag: String(data.tag || 'whitebox'), renotify: true, icon: '/icon-192.png',
    data: { surfaceId: String(data.surfaceId || '') }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const surfaceId = event.notification.data?.surfaceId || '';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      open.postMessage({ type: 'open', surfaceId });
      return;
    }
    await self.clients.openWindow(surfaceId ? `/?open=${encodeURIComponent(surfaceId)}` : '/');
  })());
});
